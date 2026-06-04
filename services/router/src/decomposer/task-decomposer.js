/**
 * Task Decomposer - breaks complex prompts into sub-tasks
 *
 * Uses keyword analysis and pattern matching to identify
 * different types of work in a single prompt.
 */
export class TaskDecomposer {
    /**
     * Decompose a prompt into sub-tasks
     */
    decompose(request) {
        const prompt = this.extractPrompt(request);
        if (!prompt || prompt.length < 50) {
            // Short prompts don't need decomposition
            return this.createSingleTask(request, prompt);
        }
        const subTasks = this.extractSubTasks(prompt);
        const executionPlan = this.buildExecutionPlan(subTasks);
        const requiresOrchestrator = subTasks.length > 1;
        return {
            id: `decomp_${Date.now()}`,
            originalPrompt: prompt,
            subTasks,
            executionPlan,
            requiresOrchestration: requiresOrchestrator,
        };
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
    createSingleTask(request, prompt) {
        const specializations = this.detectSpecializations(prompt);
        const subTask = {
            id: 'task_1',
            description: prompt,
            specializations,
            priority: 5,
            estimatedTokens: this.estimateTokens(prompt),
            canParallel: false,
            modality: request.modality,
        };
        return {
            id: `decomp_${Date.now()}`,
            originalPrompt: prompt,
            subTasks: [subTask],
            executionPlan: {
                groups: [{ id: 'group_1', type: 'sequential', subTaskIds: ['task_1'] }],
                totalEstimatedTokens: subTask.estimatedTokens,
                estimatedDurationMs: 5000,
            },
            requiresOrchestration: false,
        };
    }
    /**
     * Extract sub-tasks from a complex prompt
     */
    extractSubTasks(prompt) {
        const subTasks = [];
        const lowerPrompt = prompt.toLowerCase();
        // Pattern: "build/create X with Y and Z"
        // Pattern: "frontend ... backend ... database"
        // Pattern: "UI ... API ... DB"
        // Detect UI/Frontend work
        if (this.containsKeywords(lowerPrompt, [
            'ui', 'frontend', 'react', 'vue', 'angular', 'css', 'tailwind',
            'component', 'layout', 'responsive', 'design', '界面', '前端'
        ])) {
            subTasks.push({
                id: 'task_ui',
                description: this.extractRelevantSection(prompt, ['ui', 'frontend', 'react', 'vue', 'component', 'layout']),
                specializations: ['ui_design', 'ui_component', 'frontend_logic'],
                priority: 7,
                estimatedTokens: 2000,
                canParallel: true,
                modality: 'llm',
            });
        }
        // Detect Backend work
        if (this.containsKeywords(lowerPrompt, [
            'backend', 'api', 'server', 'endpoint', 'rest', 'graphql',
            'express', 'fastify', 'node', 'python', 'go', 'rust',
            '后端', '接口'
        ])) {
            subTasks.push({
                id: 'task_backend',
                description: this.extractRelevantSection(prompt, ['backend', 'api', 'server', 'endpoint']),
                specializations: ['backend_api', 'backend_logic', 'authentication'],
                priority: 7,
                estimatedTokens: 2000,
                canParallel: true,
                modality: 'llm',
            });
        }
        // Detect Database work
        if (this.containsKeywords(lowerPrompt, [
            'database', 'db', 'sql', 'postgres', 'mysql', 'mongo', 'redis',
            'schema', 'migration', 'model', 'table', 'query',
            '数据库', '数据模型'
        ])) {
            subTasks.push({
                id: 'task_database',
                description: this.extractRelevantSection(prompt, ['database', 'schema', 'migration', 'model']),
                specializations: ['database_schema', 'database_query', 'data_modeling', 'orm'],
                priority: 6,
                estimatedTokens: 1500,
                canParallel: true,
                modality: 'llm',
            });
        }
        // Detect Testing work
        if (this.containsKeywords(lowerPrompt, [
            'test', 'testing', 'unit test', 'integration test', 'e2e',
            'jest', 'vitest', 'playwright', 'cypress', '测试'
        ])) {
            subTasks.push({
                id: 'task_testing',
                description: this.extractRelevantSection(prompt, ['test', 'testing']),
                specializations: ['testing'],
                priority: 5,
                estimatedTokens: 1500,
                dependsOn: subTasks.map((t) => t.id), // Tests depend on implementation
                canParallel: false,
                modality: 'llm',
            });
        }
        // Detect DevOps work
        if (this.containsKeywords(lowerPrompt, [
            'deploy', 'docker', 'kubernetes', 'k8s', 'ci/cd', 'pipeline',
            'aws', 'gcp', 'azure', 'vercel', 'netlify', '部署'
        ])) {
            subTasks.push({
                id: 'task_devops',
                description: this.extractRelevantSection(prompt, ['deploy', 'docker', 'ci/cd']),
                specializations: ['devops', 'cloud'],
                priority: 4,
                estimatedTokens: 1000,
                dependsOn: subTasks.map((t) => t.id), // Deploy depends on everything
                canParallel: false,
                modality: 'llm',
            });
        }
        // Detect Documentation work
        if (this.containsKeywords(lowerPrompt, [
            'document', 'readme', 'docs', 'documentation', 'comment',
            '文档', '说明'
        ])) {
            subTasks.push({
                id: 'task_docs',
                description: this.extractRelevantSection(prompt, ['document', 'readme', 'docs']),
                specializations: ['documentation'],
                priority: 3,
                estimatedTokens: 1000,
                dependsOn: subTasks.map((t) => t.id), // Docs depend on implementation
                canParallel: false,
                modality: 'llm',
            });
        }
        // Detect Bulk/Boilerplate work
        if (this.containsKeywords(lowerPrompt, [
            'scaffold', 'boilerplate', 'template', 'generate all', 'bulk',
            'every', 'all the', '批量', '模板'
        ])) {
            subTasks.push({
                id: 'task_bulk',
                description: this.extractRelevantSection(prompt, ['scaffold', 'boilerplate', 'template']),
                specializations: ['bulk_generation'],
                priority: 6,
                estimatedTokens: 3000,
                canParallel: true,
                modality: 'llm',
            });
        }
        // If no specific tasks detected, create a general task
        if (subTasks.length === 0) {
            subTasks.push({
                id: 'task_general',
                description: prompt,
                specializations: ['general'],
                priority: 5,
                estimatedTokens: this.estimateTokens(prompt),
                canParallel: false,
                modality: 'llm',
            });
        }
        return subTasks;
    }
    /**
     * Build execution plan from sub-tasks
     */
    buildExecutionPlan(subTasks) {
        const groups = [];
        // Group 1: Parallel independent tasks
        const parallelTasks = subTasks.filter((t) => t.canParallel && !t.dependsOn);
        if (parallelTasks.length > 0) {
            groups.push({
                id: 'group_parallel',
                type: 'parallel',
                subTaskIds: parallelTasks.map((t) => t.id),
            });
        }
        // Group 2+: Sequential dependent tasks
        const sequentialTasks = subTasks.filter((t) => !t.canParallel || t.dependsOn);
        for (const task of sequentialTasks) {
            groups.push({
                id: `group_${task.id}`,
                type: 'sequential',
                subTaskIds: [task.id],
                dependsOn: task.dependsOn
                    ? groups.filter((g) => g.subTaskIds.some((id) => task.dependsOn.includes(id))).map((g) => g.id)
                    : undefined,
            });
        }
        const totalTokens = subTasks.reduce((sum, t) => sum + t.estimatedTokens, 0);
        const parallelGroups = groups.filter((g) => g.type === 'parallel');
        const sequentialGroups = groups.filter((g) => g.type === 'sequential');
        // Estimate: parallel groups take longest single task time, sequential groups stack
        const estimatedDuration = parallelGroups.length * 5000 + // 5s per parallel group
            sequentialGroups.length * 8000; // 8s per sequential group
        return {
            groups,
            totalEstimatedTokens: totalTokens,
            estimatedDurationMs: estimatedDuration,
        };
    }
    /**
     * Detect specializations from prompt text
     */
    detectSpecializations(prompt) {
        const lower = prompt.toLowerCase();
        const specs = [];
        const keywordMap = {
            ui_design: ['ui', 'frontend', 'react', 'vue', 'css', 'design'],
            ui_component: ['component', 'button', 'form', 'modal', 'tailwind'],
            frontend_logic: ['state', 'hook', 'context', 'redux', 'zustand'],
            backend_api: ['api', 'endpoint', 'rest', 'graphql', 'route'],
            backend_logic: ['backend', 'server', 'service', 'middleware'],
            authentication: ['auth', 'login', 'jwt', 'oauth', 'session'],
            database_schema: ['schema', 'table', 'model', 'migration'],
            database_query: ['query', 'sql', 'select', 'join', 'index'],
            data_modeling: ['data', 'relationship', 'normalize'],
            orm: ['prisma', 'drizzle', 'typeorm', 'sequelize'],
            devops: ['docker', 'deploy', 'ci/cd', 'pipeline'],
            cloud: ['aws', 'gcp', 'azure', 'vercel'],
            monitoring: ['log', 'metric', 'alert', 'observability'],
            testing: ['test', 'jest', 'vitest', 'playwright'],
            refactoring: ['refactor', 'cleanup', 'improve'],
            debugging: ['bug', 'error', 'fix', 'debug'],
            bulk_generation: ['scaffold', 'boilerplate', 'generate', 'bulk'],
            documentation: ['readme', 'docs', 'comment'],
            translation: ['i18n', 'localization', 'translate'],
            code_review: ['review', 'pr', 'pull request'],
            architecture: ['architecture', 'design', 'pattern'],
            orchestration: ['orchestrate', 'coordinate', 'multi-agent'],
            reasoning: ['logic', 'algorithm', 'math', 'reasoning'],
            creative: ['creative', 'copy', 'name', 'ux writing'],
            vision: ['image', 'picture', 'visual'],
            audio: ['audio', 'speech', 'voice'],
            video: ['video', 'animation'],
            embedding: ['embedding', 'similarity', 'search'],
            general: [],
            fast: ['fast', 'quick', 'immediate'],
            cheap: ['cheap', 'budget', 'cost-effective'],
        };
        for (const [spec, keywords] of Object.entries(keywordMap)) {
            if (keywords.some((kw) => lower.includes(kw))) {
                specs.push(spec);
            }
        }
        return specs.length > 0 ? specs : ['general'];
    }
    containsKeywords(text, keywords) {
        return keywords.some((kw) => text.includes(kw));
    }
    extractRelevantSection(prompt, keywords) {
        // Extract sentences that contain the keywords
        const sentences = prompt.split(/[.!?;]+/).filter((s) => {
            const lower = s.toLowerCase();
            return keywords.some((kw) => lower.includes(kw));
        });
        if (sentences.length > 0) {
            return sentences.join('. ').trim();
        }
        // Fallback: return first 200 chars
        return prompt.slice(0, 200);
    }
    estimateTokens(text) {
        // Rough: 1 token per 4 characters
        return Math.ceil(text.length / 4);
    }
}
//# sourceMappingURL=task-decomposer.js.map