import { classifyTask } from './classifier/task-classifier.js';
import { runPipeline } from './pipeline/pipeline.js';
import { executeWithFallback } from './fallback/fallback-executor.js';
import { hashConversation, getStickyProvider, setStickyProvider } from './sticky/sticky-session.js';
import { TaskDecomposer } from './decomposer/task-decomposer.js';
import { SpecialistRouter } from './decomposer/specialist-router.js';
import { CompositeExecutor } from './decomposer/composite-executor.js';
import { logger } from '@dmr-x/utils';
export class Router {
    config;
    candidates = [];
    adapterExecutor = null;
    taskDecomposer;
    specialistRouter;
    compositeExecutor = null;
    constructor(config = {}) {
        this.config = config;
        this.taskDecomposer = new TaskDecomposer();
        this.specialistRouter = new SpecialistRouter();
    }
    setCandidates(candidates) {
        this.candidates = candidates;
    }
    setAdapterExecutor(executor) {
        this.adapterExecutor = executor;
        this.compositeExecutor = new CompositeExecutor(this.specialistRouter, executor);
    }
    /**
     * Route a request - handles both simple and composite tasks
     */
    async route(request, options) {
        // Check if decomposition is enabled and the prompt is complex enough
        const shouldDecompose = this.config.enableDecomposition !== false &&
            this.isComplexPrompt(request) &&
            this.compositeExecutor;
        if (shouldDecompose) {
            return this.routeComposite(request, options);
        }
        return this.routeSimple(request, options);
    }
    /**
     * Route a simple (non-decomposed) request
     */
    async routeSimple(request, options) {
        // Step 0: Check for sticky session
        const messages = request.messages || [];
        const conversationHash = hashConversation(messages);
        if (conversationHash) {
            const sticky = await getStickyProvider(conversationHash);
            if (sticky) {
                // Check if sticky provider is still in candidates and healthy
                const stickyCandidate = this.candidates.find((c) => c.providerId === sticky.providerId && c.modelId === sticky.modelId && c.isHealthy);
                if (stickyCandidate) {
                    logger.info({ providerId: sticky.providerId, modelId: sticky.modelId }, 'Using sticky session');
                    if (!this.adapterExecutor) {
                        throw new Error('No adapter executor configured');
                    }
                    const plan = {
                        primary: { providerId: sticky.providerId, modelId: sticky.modelId, adapterType: 'sticky', score: 1 },
                        chain: [],
                        timeoutMs: request.modality === 'diffusion' ? 60000 : 30000,
                        maxRetries: 1,
                    };
                    const response = await executeWithFallback(plan, request, this.adapterExecutor, {
                        rateLimitService: this.config.rateLimitService,
                        quotaService: this.config.quotaService,
                        tenantId: request.metadata?.tenant?.id,
                    });
                    return { plan, response };
                }
            }
        }
        // Step 1: Classify the task
        const taskProfile = classifyTask(request, options);
        logger.debug({ taskProfile }, 'Task classified');
        // Step 2: Run the routing pipeline
        const tenantId = request.metadata?.tenant?.id;
        const freeTierStrategy = request.metadata?.freeTierStrategy || this.config.freeTierStrategy;
        const pipelineResult = await runPipeline({
            taskProfile,
            candidates: this.candidates,
            epsilon: this.config.epsilon ?? 0.05,
            rateLimitService: this.config.rateLimitService,
            quotaService: this.config.quotaService,
            tenantId,
            estimatedTokens: this.estimateTokens(request),
            freeTierStrategy,
        });
        const plan = {
            primary: pipelineResult.selected,
            chain: pipelineResult.chain,
            timeoutMs: request.modality === 'diffusion' ? 60000 : 30000,
            maxRetries: 3,
        };
        logger.info({ primary: plan.primary, fallbackCount: plan.chain.length }, 'Routing plan created');
        // Step 3: Execute with fallback
        if (!this.adapterExecutor) {
            throw new Error('No adapter executor configured');
        }
        const response = await executeWithFallback(plan, request, this.adapterExecutor, {
            rateLimitService: this.config.rateLimitService,
            quotaService: this.config.quotaService,
            tenantId,
        });
        // Step 4: Set sticky session for this conversation
        if (conversationHash) {
            await setStickyProvider(conversationHash, plan.primary.providerId, plan.primary.modelId);
        }
        return { plan, response };
    }
    /**
     * Route a composite (decomposed) request
     */
    async routeComposite(request, options) {
        logger.info('Decomposing complex prompt into sub-tasks');
        // Step 1: Decompose the prompt
        const decomposed = this.taskDecomposer.decompose(request);
        logger.info({ subTaskCount: decomposed.subTasks.length, requiresOrchestration: decomposed.requiresOrchestration }, 'Task decomposed');
        // Step 2: Execute via composite executor
        const result = await this.compositeExecutor.execute(decomposed, this.candidates, request, options.qualityTarget || this.config.defaultQualityTarget || 'balanced');
        // Log model assignments
        for (const [subTaskId, model] of result.modelAssignments) {
            logger.info({ subTaskId, model }, 'Sub-task assigned');
        }
        // Create a synthetic plan for the composite result
        const plan = {
            primary: {
                providerId: 'dmr-x-composite',
                modelId: 'multi-model',
                adapterType: 'composite',
                score: 1,
            },
            chain: [],
            timeoutMs: decomposed.executionPlan.estimatedDurationMs,
            maxRetries: 1,
        };
        return { plan, response: result.aggregatedResponse };
    }
    /**
     * Check if a prompt is complex enough to warrant decomposition
     */
    isComplexPrompt(request) {
        const prompt = this.extractPrompt(request);
        const threshold = this.config.decompositionThreshold || 100;
        if (prompt.length < threshold) {
            return false;
        }
        // Check for multiple task indicators
        const taskIndicators = [
            'frontend', 'backend', 'database', 'api', 'ui', 'server',
            'test', 'deploy', 'docker', 'component', 'schema',
            'react', 'vue', 'node', 'python', 'sql',
        ];
        const lowerPrompt = prompt.toLowerCase();
        const matchCount = taskIndicators.filter((ind) => lowerPrompt.includes(ind)).length;
        // If 2+ task types mentioned, it's a composite task
        return matchCount >= 2;
    }
    extractPrompt(request) {
        if (request.messages) {
            return request.messages
                .filter((m) => m.role === 'user')
                .map((m) => (typeof m.content === 'string' ? m.content : ''))
                .join('\n');
        }
        return request.prompt || '';
    }
    /**
     * Estimate token count for rate-limit checking.
     * Uses ~4 chars/token heuristic (same as FreeLLMAPI).
     */
    estimateTokens(request) {
        const prompt = this.extractPrompt(request);
        const maxTokens = request.max_tokens || 4096;
        return Math.ceil(prompt.length / 4) + maxTokens;
    }
}
//# sourceMappingURL=router.service.js.map