/**
 * Model specialization tags
 *
 * Each model can have multiple specializations.
 * The router uses these to match sub-tasks to the best specialist model.
 */

export type Specialization =
  // Frontend / UI
  | 'ui_design'        // React, Vue, CSS, layout, responsive design
  | 'ui_component'     // Component libraries, shadcn, Tailwind
  | 'frontend_logic'   // State management, hooks, client-side logic

  // Backend
  | 'backend_api'      // REST, GraphQL, API design
  | 'backend_logic'    // Business logic, services, middleware
  | 'authentication'   // Auth flows, JWT, OAuth, sessions

  // Data
  | 'database_schema'  // Schema design, migrations, relationships
  | 'database_query'   // SQL optimization, complex queries
  | 'data_modeling'    // Data architecture, normalization
  | 'orm'              // Prisma, Drizzle, TypeORM

  // Infrastructure
  | 'devops'           // Docker, CI/CD, deployment
  | 'cloud'            // AWS, GCP, Azure
  | 'monitoring'       // Logging, metrics, alerting

  // Code quality
  | 'testing'          // Unit tests, integration tests, e2e
  | 'refactoring'      // Code cleanup, patterns, architecture
  | 'debugging'        // Error analysis, root cause, fixes

  // Bulk / High-volume
  | 'bulk_generation'  // Boilerplate, scaffolding, repetitive code
  | 'documentation'    // README, API docs, comments
  | 'translation'      // i18n, localization

  // Specialized
  | 'code_review'      // PR review, code analysis
  | 'architecture'     // System design, patterns, decisions
  | 'orchestration'    // Multi-agent coordination, task planning
  | 'reasoning'        // Complex logic, math, algorithms
  | 'creative'         // Copy, naming, UX writing

  // Modality-specific
  | 'vision'           // Image understanding
  | 'audio'            // Audio processing
  | 'video'            // Video generation/analysis
  | 'embedding'        // Semantic search, similarity

  // General
  | 'general'          // Good at everything, specialist at nothing
  | 'fast'             // Low latency, quick responses
  | 'cheap';           // Cost-effective for bulk work

/**
 * Specialization profile for a model
 */
export interface SpecializationProfile {
  modelId: string;
  providerId: string;

  // What this model is good at (0-1 score per specialization)
  strengths: Partial<Record<Specialization, number>>;

  // Recommended use cases
  recommendedFor: Specialization[];

  // Cost tier
  costTier: 'free' | 'cheap' | 'standard' | 'premium' | 'frontier';

  // Speed tier
  speedTier: 'instant' | 'fast' | 'standard' | 'slow' | 'batch';
}

/**
 * Pre-configured specialization profiles for known models
 */
export const KNOWN_MODEL_SPECIALIZATIONS: Record<string, Partial<SpecializationProfile>> = {
  // Claude - UI, frontend, creative
  'claude-3-5-sonnet-20241022': {
    strengths: {
      ui_design: 0.95,
      ui_component: 0.9,
      frontend_logic: 0.85,
      code_review: 0.9,
      architecture: 0.85,
      creative: 0.9,
      reasoning: 0.85,
      general: 0.9,
    },
    recommendedFor: ['ui_design', 'ui_component', 'code_review', 'creative'],
    costTier: 'premium',
    speedTier: 'standard',
  },
  'claude-3-opus-20240229': {
    strengths: {
      architecture: 0.95,
      reasoning: 0.95,
      code_review: 0.95,
      debugging: 0.9,
      refactoring: 0.9,
      general: 0.95,
    },
    recommendedFor: ['architecture', 'reasoning', 'code_review'],
    costTier: 'frontier',
    speedTier: 'slow',
  },

  // GPT - Backend, API, general
  'gpt-4o': {
    strengths: {
      backend_api: 0.9,
      backend_logic: 0.9,
      authentication: 0.85,
      database_query: 0.85,
      testing: 0.85,
      general: 0.9,
    },
    recommendedFor: ['backend_api', 'backend_logic', 'testing'],
    costTier: 'premium',
    speedTier: 'standard',
  },
  'gpt-4o-mini': {
    strengths: {
      bulk_generation: 0.9,
      documentation: 0.85,
      translation: 0.8,
      fast: 0.9,
      cheap: 0.9,
      general: 0.7,
    },
    recommendedFor: ['bulk_generation', 'documentation', 'fast', 'cheap'],
    costTier: 'cheap',
    speedTier: 'fast',
  },

  // DeepSeek - Bulk, cheap, code
  'deepseek-coder': {
    strengths: {
      bulk_generation: 0.95,
      backend_logic: 0.8,
      database_schema: 0.8,
      refactoring: 0.8,
      cheap: 0.95,
      fast: 0.85,
    },
    recommendedFor: ['bulk_generation', 'cheap', 'backend_logic'],
    costTier: 'cheap',
    speedTier: 'fast',
  },
  'deepseek-chat': {
    strengths: {
      bulk_generation: 0.9,
      documentation: 0.85,
      translation: 0.8,
      cheap: 0.95,
    },
    recommendedFor: ['bulk_generation', 'cheap', 'documentation'],
    costTier: 'free',
    speedTier: 'fast',
  },

  // MiMo - Database, API, structured
  'mimo-v2': {
    strengths: {
      database_schema: 0.9,
      database_query: 0.9,
      data_modeling: 0.85,
      orm: 0.85,
      backend_api: 0.8,
      reasoning: 0.85,
    },
    recommendedFor: ['database_schema', 'database_query', 'data_modeling'],
    costTier: 'standard',
    speedTier: 'standard',
  },

  // Kimi - Orchestration, multi-agent
  'kimi-k2.6': {
    strengths: {
      orchestration: 0.95,
      architecture: 0.9,
      reasoning: 0.9,
      code_review: 0.85,
      general: 0.85,
    },
    recommendedFor: ['orchestration', 'architecture', 'reasoning'],
    costTier: 'standard',
    speedTier: 'standard',
  },

  // Ollama local models - Free, fast, bulk
  'llama3': {
    strengths: {
      bulk_generation: 0.7,
      documentation: 0.7,
      fast: 0.9,
      cheap: 1.0,
      general: 0.6,
    },
    recommendedFor: ['bulk_generation', 'cheap', 'fast'],
    costTier: 'free',
    speedTier: 'instant',
  },
};

/**
 * Get the cost multiplier for a cost tier
 */
export function getCostMultiplier(tier: SpecializationProfile['costTier']): number {
  switch (tier) {
    case 'free': return 0;
    case 'cheap': return 0.1;
    case 'standard': return 0.5;
    case 'premium': return 1.0;
    case 'frontier': return 2.0;
  }
}

/**
 * Get the latency weight for a speed tier
 */
export function getLatencyWeight(tier: SpecializationProfile['speedTier']): number {
  switch (tier) {
    case 'instant': return 1.0;
    case 'fast': return 0.8;
    case 'standard': return 0.5;
    case 'slow': return 0.2;
    case 'batch': return 0.1;
  }
}
