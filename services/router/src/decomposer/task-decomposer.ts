import type { Specialization } from '@dmr-x/core';
import type { UnifiedRequest } from '@dmr-x/core';

/**
 * A sub-task extracted from a complex prompt
 */
export interface SubTask {
  id: string;
  description: string;
  specializations: Specialization[];
  priority: number;        // 1-10, higher = more important
  estimatedTokens: number;  // rough token estimate
  dependsOn?: string[];     // IDs of sub-tasks this depends on
  canParallel: boolean;     // can run in parallel with other sub-tasks
  modality: string;
}

/**
 * Decomposed task result
 */
export interface DecomposedTask {
  id: string;
  originalPrompt: string;
  subTasks: SubTask[];
  executionPlan: ExecutionPlan;
  requiresOrchestration: boolean;
}

/**
 * Conversation context for improving decomposition
 */
export interface ConversationContext {
  /** Previous user messages in the conversation */
  previousMessages?: string[];
  /** Previous decomposition decisions */
  previousDecompositions?: string[];
  /** Detected conversation flow (e.g., "backend-first", "frontend-focused") */
  conversationFlow?: string;
}

/**
 * Execution plan - defines parallel and sequential groups
 */
export interface ExecutionPlan {
  groups: ExecutionGroup[];
  totalEstimatedTokens: number;
  estimatedDurationMs: number;
}

export interface ExecutionGroup {
  id: string;
  type: 'parallel' | 'sequential';
  subTaskIds: string[];
  dependsOn?: string[]; // Group IDs this depends on
}

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
  decompose(request: UnifiedRequest, context?: ConversationContext): DecomposedTask {
    const prompt = this.extractPrompt(request);

    if (!prompt || prompt.length < 50) {
      // Short prompts don't need decomposition
      return this.createSingleTask(request, prompt);
    }

    // Analyze conversation flow if context is provided
    const _detectedFlow = context ? this.analyzeConversationFlow(context) : undefined;

    const subTasks = this.extractSubTasks(prompt, _detectedFlow);
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

  /**
   * Analyze conversation flow from context to improve decomposition
   */
  private analyzeConversationFlow(context: ConversationContext): string | undefined {
    const allMessages = [
      ...(context.previousMessages || []),
      ...(context.previousDecompositions || []),
    ].join(' ').toLowerCase();

    // Detect sequential patterns
    if (allMessages.includes('backend') && allMessages.includes('frontend')) {
      return 'full-stack';
    }
    if (allMessages.includes('first') && allMessages.includes('then')) {
      return 'sequential';
    }
    if (allMessages.includes('now') || allMessages.includes('next') || allMessages.includes('also')) {
      return 'continuation';
    }

    return context.conversationFlow;
  }

  private extractPrompt(request: UnifiedRequest): string {
    if (request.messages) {
      return request.messages
        .filter((m) => m.role === 'user')
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join('\n');
    }
    return request.prompt || '';
  }

  private createSingleTask(request: UnifiedRequest, prompt: string): DecomposedTask {
    const specializations = this.detectSpecializations(prompt);

    const subTask: SubTask = {
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
  private extractSubTasks(prompt: string, _detectedFlow?: string): SubTask[] {
    const subTasks: SubTask[] = [];
    const lowerPrompt = prompt.toLowerCase();

    // Pattern: "build/create X with Y and Z"
    // Pattern: "frontend ... backend ... database"
    // Pattern: "UI ... API ... DB"

    // Detect UI/Frontend work
    if (this.containsKeywords(lowerPrompt, [
      'ui', 'frontend', 'react', 'vue', 'angular', 'css', 'tailwind',
      'component', 'layout', 'responsive', 'design', '界面', '前端',
      'svelte', 'solid', 'astro', 'next', 'nuxt', 'remix', 'shadcn',
      'storybook', 'headless', 'radix', 'button', 'form', 'modal', 'dialog',
      'page', 'screen', 'view', 'dashboard', 'table', 'list', 'grid'
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
      '后端', '接口', 'trpc', 'grpc', 'websocket', 'sse', 'cron',
      'queue', 'worker', 'job', 'microservice', 'lambda', 'function',
      'route', 'controller', 'service', 'repository', 'middleware'
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
      '数据库', '数据模型', 'sqlite', 'supabase', 'planetscale', 'neon',
      'turso', 'libsql', 'clickhouse', 'elasticsearch', 'meilisearch',
      'prisma', 'drizzle', 'typeorm', 'sequelize', 'knex', 'kysely',
      'entity', 'relation', 'foreign key', 'index', 'view', 'trigger'
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
      'jest', 'vitest', 'playwright', 'cypress', '测试',
      'spec', 'assert', 'mock', 'stub', 'fixture', 'snapshot',
      'coverage', 'testify', 'msw', 'supertest', 'testing library'
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
      'aws', 'gcp', 'azure', 'vercel', 'netlify', '部署',
      'terraform', 'pulumi', 'ansible', 'helm', 'nginx', 'caddy',
      'github actions', 'gitlab ci', 'circleci', 'jenkins',
      'container', 'pod', 'service mesh', 'ingress', 'load balancer'
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
      '文档', '说明', 'jsdoc', 'typedoc', 'swagger', 'openapi',
      'api reference', 'tutorial', 'guide', 'how to', 'example',
      'changelog', 'release notes', 'contributing'
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
      'every', 'all the', '批量', '模板', 'cli', 'codegen',
      'create all', 'setup', 'initialize', 'init', 'new project'
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

    // Detect Mobile work
    if (this.containsKeywords(lowerPrompt, [
      'ios', 'android', 'swift', 'kotlin', 'react native', 'flutter',
      'expo', 'capacitor', 'ionic', 'mobile', 'app store', 'play store'
    ])) {
      subTasks.push({
        id: 'task_mobile',
        description: this.extractRelevantSection(prompt, ['ios', 'android', 'mobile', 'app']),
        specializations: ['mobile', 'ui_component', 'frontend_logic'],
        priority: 7,
        estimatedTokens: 2000,
        canParallel: true,
        modality: 'llm',
      });
    }

    // Detect Machine Learning work
    if (this.containsKeywords(lowerPrompt, [
      'model', 'train', 'inference', 'dataset', 'pipeline', 'ml', 'ai',
      'neural', 'transformer', 'llm', 'fine-tune', 'embedding', 'vector'
    ])) {
      subTasks.push({
        id: 'task_ml',
        description: this.extractRelevantSection(prompt, ['model', 'train', 'ml', 'ai']),
        specializations: ['machine_learning', 'embedding'],
        priority: 7,
        estimatedTokens: 2500,
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
  private buildExecutionPlan(subTasks: SubTask[]): ExecutionPlan {
    const groups: ExecutionGroup[] = [];

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
          ? groups.filter((g) => g.subTaskIds.some((id) => task.dependsOn!.includes(id))).map((g) => g.id)
          : undefined,
      });
    }

    const totalTokens = subTasks.reduce((sum, t) => sum + t.estimatedTokens, 0);
    const parallelGroups = groups.filter((g) => g.type === 'parallel');
    const sequentialGroups = groups.filter((g) => g.type === 'sequential');

    // Estimate: parallel groups take longest single task time, sequential groups stack
    const estimatedDuration =
      parallelGroups.length * 5000 + // 5s per parallel group
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
  private detectSpecializations(prompt: string): Specialization[] {
    const lower = prompt.toLowerCase();
    const specs: Specialization[] = [];

    const keywordMap: Record<Specialization, string[]> = {
      ui_design: ['ui', 'frontend', 'react', 'vue', 'css', 'design', 'svelte', 'solid', 'astro', 'next', 'nuxt', 'remix'],
      ui_component: ['component', 'button', 'form', 'modal', 'tailwind', 'shadcn', 'radix', 'headless', 'storybook'],
      frontend_logic: ['state', 'hook', 'context', 'redux', 'zustand', 'jotai', 'recoil', 'pinia', 'mobx'],
      backend_api: ['api', 'endpoint', 'rest', 'graphql', 'route', 'trpc', 'grpc', 'websocket', 'sse'],
      backend_logic: ['backend', 'server', 'service', 'middleware', 'queue', 'worker', 'cron', 'job'],
      authentication: ['auth', 'login', 'jwt', 'oauth', 'session', 'sso', 'rbac', 'acl', 'passport', 'clerk', 'auth0', 'supabase auth'],
      database_schema: ['schema', 'table', 'model', 'migration', 'entity', 'relation'],
      database_query: ['query', 'sql', 'select', 'join', 'index', 'aggregate', 'cursor', 'pagination'],
      data_modeling: ['data', 'relationship', 'normalize', 'denormalize', 'olap', 'oltp', 'star schema'],
      orm: ['prisma', 'drizzle', 'typeorm', 'sequelize', 'knex', 'mikro-orm', 'kysely'],
      devops: ['docker', 'deploy', 'ci/cd', 'pipeline', 'terraform', 'pulumi', 'ansible', 'helm', 'nginx', 'caddy'],
      cloud: ['aws', 'gcp', 'azure', 'vercel', 'netlify', 'cloudflare', 'railway', 'render', 'fly.io', 'lambda', 'ecs', 'k8s'],
      monitoring: ['log', 'metric', 'alert', 'observability', 'prometheus', 'grafana', 'sentry', 'datadog', 'opentelemetry'],
      testing: ['test', 'jest', 'vitest', 'playwright', 'cypress', 'msw', 'supertest', 'coverage', 'snapshot', 'e2e', 'integration', 'unit'],
      refactoring: ['refactor', 'cleanup', 'improve', 'extract', 'split', 'consolidate', 'optimize'],
      debugging: ['bug', 'error', 'fix', 'debug', 'trace', 'stacktrace', 'regression', 'race condition'],
      bulk_generation: ['scaffold', 'boilerplate', 'template', 'generate', 'bulk', 'cli', 'codegen'],
      documentation: ['readme', 'docs', 'comment', 'jsdoc', 'typedoc', 'swagger', 'openapi'],
      translation: ['i18n', 'localization', 'translate', 'locale', 'intl', 'formatjs', 'next-intl'],
      code_review: ['review', 'pr', 'pull request', 'lint', 'eslint', 'prettier', 'stylelint'],
      architecture: ['architecture', 'design', 'pattern', 'ddd', 'clean', 'hexagonal', 'cqrs', 'event sourcing'],
      orchestration: ['orchestrate', 'coordinate', 'multi-agent', 'workflow', 'pipeline', 'dag'],
      reasoning: ['logic', 'algorithm', 'math', 'reasoning', 'proof', 'theorem', 'optimization'],
      creative: ['creative', 'copy', 'name', 'ux writing', 'content', 'blog', 'marketing'],
      vision: ['image', 'picture', 'visual', 'photo', 'screenshot', 'diagram', 'chart'],
      audio: ['audio', 'speech', 'voice', 'tts', 'stt', 'transcribe', 'podcast'],
      video: ['video', 'animation', 'gif', 'stream', 'recording'],
      embedding: ['embedding', 'similarity', 'search', 'vector', 'semantic', 'rag', 'retrieval'],
      mobile: ['ios', 'android', 'swift', 'kotlin', 'react native', 'flutter', 'expo', 'capacitor'],
      machine_learning: ['model', 'train', 'inference', 'dataset', 'pipeline', 'ml', 'ai', 'neural', 'transformer', 'llm'],
      security: ['security', 'vulnerability', 'xss', 'csrf', 'injection', 'encrypt', 'hash', 'sanitiz'],
      performance: ['performance', 'optimization', 'cache', 'lazy', 'eager', 'debounce', 'throttle', ' profiling'],
      general: [],
      fast: ['fast', 'quick', 'immediate', 'urgent', 'asap', 'priority'],
      cheap: ['cheap', 'budget', 'cost-effective', 'free', 'economy'],
    };

    for (const [spec, keywords] of Object.entries(keywordMap)) {
      if (keywords.some((kw) => lower.includes(kw))) {
        specs.push(spec as Specialization);
      }
    }

    return specs.length > 0 ? specs : ['general'];
  }

  private containsKeywords(text: string, keywords: string[]): boolean {
    return keywords.some((kw) => text.includes(kw));
  }

  private extractRelevantSection(prompt: string, keywords: string[]): string {
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

  private estimateTokens(text: string): number {
    // Rough: 1 token per 4 characters
    return Math.ceil(text.length / 4);
  }
}
