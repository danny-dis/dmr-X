/**
 * Verified free/promo inference offers observed during the October 2026
 * resource-fleet research pass.
 *
 * This is deliberately separate from provider templates: an offer can be a
 * recurring token quota, a short-lived trial, a credit balance, a keyless
 * public endpoint, or a device-local resource. DMR-X must not flatten those
 * into one "free=true" bit.
 */
import type { ProviderTemplate } from './index.js';

export type FreeOfferKind =
  | 'recurring_free'
  | 'free_with_limits'
  | 'trial'
  | 'promo_credits'
  | 'startup_credits'
  | 'device_local'
  | 'keyless_public'
  | 'subscription_entitlement';

export type FreeOfferScope =
  | 'account'
  | 'organization'
  | 'project'
  | 'credential'
  | 'model'
  | 'endpoint'
  | 'ip'
  | 'device';

export type FreeOfferUnit =
  | 'tokens'
  | 'requests'
  | 'credits'
  | 'minutes'
  | 'characters'
  | 'neurons'
  | 'jobs'
  | 'gpu_seconds'
  | 'gpu_hours';

export interface VerifiedFreeOffer {
  providerId: string;
  modelId?: string;
  endpointId?: string;
  kind: FreeOfferKind;
  unit: FreeOfferUnit;
  amount?: number;
  period?: 'minute' | 'hour' | 'day' | 'month' | 'rolling_24h' | 'trial' | 'one_time';
  scope: FreeOfferScope;
  resetAt?: 'provider_defined' | 'utc_midnight' | 'rolling_window' | 'monthly' | 'none';
  requiresPaymentMethod?: boolean;
  expiresAfterDays?: number;
  dataPolicy?: 'unknown' | 'may_be_used_for_training' | 'not_used_for_training';
  productionAllowed?: boolean;
  sourceUrls: string[];
  verifiedAt: string;
  confidence: number;
  notes?: string;
}

/**
 * New provider surface discovered in the current research pass.
 *
 * Z.ai's coding endpoint is intentionally a separate provider identity from
 * the general Zhipu endpoint because the endpoint and entitlement are
 * different. The documented new-user coding trial is 8M tokens/day for five
 * days, split between GLM-5.3 and GLM-5.3-Flash.
 */
export const VERIFIED_FREE_PROVIDERS: ProviderTemplate[] = [
  {
    id: 'inception',
    name: 'Inception Labs',
    category: 'cloud_llm',
    baseUrl: 'https://api.inceptionlabs.ai/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'reasoning'],
    models: [
      {
        id: 'mercury-2.5',
        modalities: ['llm'],
        contextWindow: 262144,
        capabilities: ['streaming', 'tool_use', 'json_mode', 'reasoning'],
        specializations: ['reasoning', 'coding', 'realtime'],
      },
      {
        id: 'mercury-2',
        modalities: ['llm'],
        contextWindow: 131072,
        capabilities: ['streaming', 'tool_use', 'json_mode', 'reasoning'],
        specializations: ['reasoning', 'coding', 'realtime'],
      },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'INCEPTION_API_KEY',
    description: 'OpenAI-compatible diffusion language models from Inception Labs.',
    region: 'global',
    signupUrl: 'https://www.inceptionlabs.ai/',
  },
  {
    id: 'alibaba-model-studio',
    name: 'Alibaba Cloud Model Studio',
    category: 'cloud_llm',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'embedding', 'vision', 'audio'],
    models: [
      {
        id: 'qwen3.7-plus',
        modalities: ['llm'],
        contextWindow: 1000000,
        inputCostPer1M: 0.4,
        outputCostPer1M: 1.6,
        capabilities: ['streaming', 'tool_use', 'reasoning'],
        specializations: ['general', 'reasoning'],
      },
      {
        id: 'qwen3-coder-plus',
        modalities: ['llm'],
        contextWindow: 1000000,
        inputCostPer1M: 1,
        outputCostPer1M: 5,
        capabilities: ['streaming', 'tool_use'],
        specializations: ['coding', 'agentic'],
      },
      {
        id: 'qwen3-vl-plus',
        modalities: ['vision', 'llm'],
        contextWindow: 256000,
        inputCostPer1M: 0.2,
        outputCostPer1M: 1.6,
        capabilities: ['streaming', 'vision', 'tool_use'],
        specializations: ['vision'],
      },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'DASHSCOPE_API_KEY',
    description: 'Alibaba Cloud Model Studio Singapore OpenAI-compatible endpoint; free new-user quotas are model-specific and time-limited.',
    region: 'sg',
    signupUrl: 'https://www.alibabacloud.com/help/en/model-studio/',
  },
  {
    id: 'baidu-qianfan',
    name: 'Baidu Qianfan',
    category: 'cloud_llm',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'vision', 'embedding', 'diffusion'],
    models: [
      {
        id: 'ernie-x1-turbo-32k',
        modalities: ['llm'],
        contextWindow: 32768,
        capabilities: ['streaming', 'tool_use', 'reasoning'],
        specializations: ['reasoning', 'general'],
      },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'QIANFAN_API_KEY',
    description: 'Baidu Qianfan v2 OpenAI-compatible inference endpoint.',
    region: 'cn',
    signupUrl: 'https://cloud.baidu.com/product/qianfan.html',
  },
  {
    id: 'nebius',
    name: 'Nebius Token Factory',
    category: 'cloud_llm',
    baseUrl: 'https://api.tokenfactory.nebius.com/',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm', 'vision', 'embedding'],
    models: [
      {
        id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-fast',
        modalities: ['llm'],
        contextWindow: 131072,
        inputCostPer1M: 0.02,
        outputCostPer1M: 0.02,
        capabilities: ['streaming', 'tool_use'],
        specializations: ['fast', 'general'],
      },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'NEBIUS_API_KEY',
    description: 'Nebius Token Factory OpenAI-compatible inference; free credits are account-level and must be observed from live entitlement.',
    region: 'global',
    signupUrl: 'https://nebius.com/services/token-factory/inference-service',
  },
  {
    id: 'zai-coding',
    name: 'Z.ai Coding',
    category: 'cloud_llm',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    authMethod: 'bearer',
    apiFormat: 'openai',
    modalities: ['llm'],
    models: [
      {
        id: 'glm-5.3',
        modalities: ['llm'],
        contextWindow: 131072,
        inputCostPer1M: 0,
        outputCostPer1M: 0,
        capabilities: ['tool_use', 'streaming', 'json_mode'],
        specializations: ['coding', 'agentic'],
        freeTier: {
          rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 3000000 },
          monthlyTokenBudget: 0,
          dailyTokenBudget: 3000000,
          intelligenceRank: 9,
          speedRank: 8,
          offerKind: 'trial',
          scope: 'account',
          trialDays: 5,
          requiresPaymentMethod: false,
        },
      },
      {
        id: 'glm-5.3-flash',
        modalities: ['llm'],
        contextWindow: 131072,
        inputCostPer1M: 0,
        outputCostPer1M: 0,
        capabilities: ['tool_use', 'streaming', 'json_mode'],
        specializations: ['coding', 'fast', 'agentic'],
        freeTier: {
          rateLimits: { rpm: 0, rpd: 0, tpm: 0, tpd: 5000000 },
          monthlyTokenBudget: 0,
          dailyTokenBudget: 5000000,
          intelligenceRank: 8,
          speedRank: 10,
          offerKind: 'trial',
          scope: 'account',
          trialDays: 5,
          requiresPaymentMethod: false,
        },
      },
    ],
    streaming: true,
    toolCalling: true,
    envKey: 'ZAI_API_KEY',
    description: 'Z.ai Coding endpoint. New-user 5-day trial quota: 8M tokens/day split across GLM-5.3 and GLM-5.3-Flash.',
    region: 'global',
    signupUrl: 'https://z.ai/',
  },
];

export const VERIFIED_FREE_OFFERS: VerifiedFreeOffer[] = [
  {
    providerId: 'zai-coding',
    modelId: 'glm-5.3',
    endpointId: 'coding',
    kind: 'trial',
    unit: 'tokens',
    amount: 3000000,
    period: 'day',
    scope: 'account',
    resetAt: 'provider_defined',
    requiresPaymentMethod: false,
    expiresAfterDays: 5,
    sourceUrls: ['https://docs.z.ai/guides/develop/coding-plan'],
    verifiedAt: '2026-10-03',
    confidence: 0.95,
  },
  {
    providerId: 'zai-coding',
    modelId: 'glm-5.3-flash',
    endpointId: 'coding',
    kind: 'trial',
    unit: 'tokens',
    amount: 5000000,
    period: 'day',
    scope: 'account',
    resetAt: 'provider_defined',
    requiresPaymentMethod: false,
    expiresAfterDays: 5,
    sourceUrls: ['https://docs.z.ai/guides/develop/coding-plan'],
    verifiedAt: '2026-10-03',
    confidence: 0.95,
  },
  {
    providerId: 'cerebras',
    modelId: 'gpt-oss-120b',
    kind: 'recurring_free',
    unit: 'tokens',
    amount: 64000,
    period: 'minute',
    scope: 'account',
    resetAt: 'provider_defined',
    requiresPaymentMethod: false,
    sourceUrls: ['https://inference-docs.cerebras.ai/support/rate-limits'],
    verifiedAt: '2026-10-03',
    confidence: 0.95,
    notes: 'Free tier also documents hourly and daily token/request dimensions.',
  },
  {
    providerId: 'fireworks',
    kind: 'startup_credits',
    unit: 'credits',
    period: 'one_time',
    scope: 'account',
    resetAt: 'none',
    requiresPaymentMethod: false,
    sourceUrls: ['https://fireworks.ai/'],
    verifiedAt: '2026-10-03',
    confidence: 0.80,
    notes: 'Do not hard-code a universal signup amount. Current public offers include eligibility-based startup/partner credits; live entitlement must be observed per account.',
  },
  {
    providerId: 'aws-bedrock',
    kind: 'promo_credits',
    unit: 'credits',
    amount: 200,
    period: 'one_time',
    scope: 'account',
    resetAt: 'none',
    requiresPaymentMethod: false,
    expiresAfterDays: 180,
    sourceUrls: ['https://aws.amazon.com/free/free-tier-faqs/'],
    verifiedAt: '2026-10-03',
    confidence: 0.88,
    notes: 'New AWS customers can receive up to $200 in Free Tier credits. Treat as account promo capacity, not recurring zero-price inference.',
  },
  {
    providerId: 'cloudflare-ai-search',
    endpointId: 'semantic-search',
    kind: 'recurring_free',
    unit: 'requests',
    amount: 1000,
    period: 'month',
    scope: 'account',
    resetAt: 'monthly',
    requiresPaymentMethod: false,
    sourceUrls: ['https://developers.cloudflare.com/ai-search/reference/pricing/'],
    verifiedAt: '2026-10-03',
    confidence: 0.95,
    notes: 'Semantic and full-text search have separate free monthly pools.',
  },
  {
    providerId: 'cloudflare-ai-search',
    endpointId: 'full-text-search',
    kind: 'recurring_free',
    unit: 'requests',
    amount: 1000,
    period: 'month',
    scope: 'account',
    resetAt: 'monthly',
    requiresPaymentMethod: false,
    sourceUrls: ['https://developers.cloudflare.com/ai-search/reference/pricing/'],
    verifiedAt: '2026-10-03',
    confidence: 0.95,
    notes: 'Keep semantic and full-text pools separate.',
  },
  {
    providerId: 'huggingface',
    kind: 'recurring_free',
    unit: 'credits',
    amount: 0.10,
    period: 'month',
    scope: 'account',
    resetAt: 'monthly',
    requiresPaymentMethod: false,
    sourceUrls: ['https://huggingface.co/docs/inference-providers/en/pricing'],
    verifiedAt: '2026-10-03',
    confidence: 0.94,
    notes: 'Free users receive a monthly Inference Providers credit allocation; model/provider routing can consume it at different rates.',
  },
  {
    providerId: 'openrouter-free',
    kind: 'free_with_limits',
    unit: 'requests',
    amount: 50,
    period: 'day',
    scope: 'account',
    resetAt: 'provider_defined',
    requiresPaymentMethod: false,
    sourceUrls: ['https://openrouter.ai/pricing'],
    verifiedAt: '2026-10-03',
    confidence: 0.93,
  },
  {
    providerId: 'groq',
    endpointId: 'tts',
    kind: 'free_with_limits',
    unit: 'requests',
    amount: 10,
    period: 'minute',
    scope: 'organization',
    resetAt: 'provider_defined',
    requiresPaymentMethod: false,
    sourceUrls: ['https://console.groq.com/docs/rate-limits'],
    verifiedAt: '2026-10-03',
    confidence: 0.92,
    notes: 'Orpheus TTS free-plan request limit.',
  },
  {
    providerId: 'elevenlabs',
    kind: 'free_with_limits',
    unit: 'credits',
    amount: 10000,
    period: 'month',
    scope: 'account',
    resetAt: 'monthly',
    requiresPaymentMethod: false,
    sourceUrls: ['https://elevenlabs.io/pricing/api'],
    verifiedAt: '2026-10-03',
    confidence: 0.92,
    notes: 'Shared credit pool spans eligible speech/audio features.',
  },
  {
    providerId: 'jina',
    kind: 'free_with_limits',
    unit: 'requests',
    amount: 100,
    period: 'minute',
    scope: 'credential',
    resetAt: 'provider_defined',
    requiresPaymentMethod: false,
    sourceUrls: ['https://jina.ai/pricing'],
    verifiedAt: '2026-10-03',
    confidence: 0.90,
    notes: 'Embeddings/reranking also expose token ceilings; model as multiple quota dimensions.',
  },
  {
    providerId: 'voyage',
    kind: 'recurring_free',
    unit: 'tokens',
    amount: 200000000,
    period: 'one_time',
    scope: 'account',
    resetAt: 'none',
    requiresPaymentMethod: false,
    sourceUrls: ['https://www.voyageai.com/pricing/'],
    verifiedAt: '2026-10-03',
    confidence: 0.91,
    notes: '200M-token promotional allocation applies to several current Voyage 4 family models; specialized models have smaller free allocations.',
  },
  {
    providerId: 'stability',
    kind: 'promo_credits',
    unit: 'credits',
    amount: 25,
    period: 'one_time',
    scope: 'account',
    resetAt: 'none',
    requiresPaymentMethod: false,
    sourceUrls: ['https://platform.stability.ai/pricing'],
    verifiedAt: '2026-10-03',
    confidence: 0.90,
  },
  {
    providerId: 'deepgram',
    kind: 'promo_credits',
    unit: 'credits',
    amount: 200,
    period: 'one_time',
    scope: 'account',
    resetAt: 'none',
    requiresPaymentMethod: false,
    sourceUrls: ['https://deepgram.com/pricing'],
    verifiedAt: '2026-10-03',
    confidence: 0.90,
    notes: 'Free credit is broader audio usage; time-limited model promotions are not treated as recurring free capacity.',
  },
  {
    providerId: 'assemblyai',
    kind: 'promo_credits',
    unit: 'credits',
    amount: 50,
    period: 'one_time',
    scope: 'account',
    resetAt: 'none',
    requiresPaymentMethod: false,
    sourceUrls: ['https://www.assemblyai.com/pricing'],
    verifiedAt: '2026-10-03',
    confidence: 0.90,
    notes: 'Free audio credit for transcription and speech understanding workloads.',
  },
  {
    providerId: 'google-cloud',
    endpointId: 'speech-to-text',
    kind: 'recurring_free',
    unit: 'minutes',
    amount: 60,
    period: 'month',
    scope: 'account',
    resetAt: 'monthly',
    requiresPaymentMethod: false,
    sourceUrls: ['https://cloud.google.com/free'],
    verifiedAt: '2026-10-03',
    confidence: 0.90,
  },
  {
    providerId: 'cloudflare-ai',
    endpointId: 'workers-ai',
    kind: 'free_with_limits',
    unit: 'neurons',
    amount: 10000,
    period: 'day',
    scope: 'account',
    resetAt: 'utc_midnight',
    requiresPaymentMethod: false,
    sourceUrls: ['https://developers.cloudflare.com/workers-ai/platform/pricing/'],
    verifiedAt: '2026-10-03',
    confidence: 0.95,
  },
  {
    providerId: 'inception',
    modelId: 'mercury-2.5',
    kind: 'promo_credits',
    unit: 'tokens',
    amount: 10000000,
    period: 'one_time',
    scope: 'credential',
    resetAt: 'none',
    requiresPaymentMethod: false,
    sourceUrls: ['https://www.inceptionlabs.ai/models', 'https://www.inceptionlabs.ai/blog/introducing-mercury-2-5'],
    verifiedAt: '2026-10-03',
    confidence: 0.82,
    notes: 'Current Inception pages are internally inconsistent: pricing says 100M free tokens, while the same page says new API keys come with 10M. DMR-X must treat live account usage as authoritative and keep this offer non-recurring.',
  },
  {
    providerId: 'alibaba-model-studio',
    modelId: 'qwen3.7-plus',
    kind: 'trial',
    unit: 'tokens',
    amount: 1000000,
    period: 'one_time',
    scope: 'account',
    resetAt: 'none',
    requiresPaymentMethod: false,
    expiresAfterDays: 90,
    sourceUrls: ['https://www.alibabacloud.com/help/en/model-studio/new-free-quota', 'https://www.alibabacloud.com/help/en/model-studio/model-pricing'],
    verifiedAt: '2026-10-03',
    confidence: 0.98,
    notes: 'Singapore region only; free quota is independent per model and shared by an Alibaba Cloud account and its RAM users.',
  },
  {
    providerId: 'alibaba-model-studio',
    modelId: 'qwen3-coder-plus',
    kind: 'trial',
    unit: 'tokens',
    amount: 1000000,
    period: 'one_time',
    scope: 'account',
    resetAt: 'none',
    requiresPaymentMethod: false,
    expiresAfterDays: 90,
    sourceUrls: ['https://www.alibabacloud.com/help/en/model-studio/model-pricing'],
    verifiedAt: '2026-10-03',
    confidence: 0.98,
    notes: 'Singapore region only; quota is model-specific.',
  },
  {
    providerId: 'baidu-qianfan',
    kind: 'trial',
    unit: 'tokens',
    amount: 1000000,
    period: 'one_time',
    scope: 'account',
    resetAt: 'none',
    requiresPaymentMethod: false,
    sourceUrls: ['https://cloud.baidu.com/product/qianfan.html'],
    verifiedAt: '2026-10-03',
    confidence: 0.86,
    notes: 'Current Baidu public product page advertises new-user free API token allowance of 1M+; exact per-model entitlement should be discovered live.',
  },
  {
    providerId: 'nebius',
    kind: 'promo_credits',
    unit: 'credits',
    period: 'one_time',
    scope: 'account',
    resetAt: 'none',
    requiresPaymentMethod: false,
    sourceUrls: ['https://nebius.com/services/token-factory/inference-service', 'https://nebius.com/blog/posts/introducing-the-nebius-ai-builder-program'],
    verifiedAt: '2026-10-03',
    confidence: 0.88,
    notes: 'Current Token Factory page advertises free credits; public page does not give a stable universal amount. Builder-program credits are eligibility-dependent and must be treated separately.',
  },
  {
    providerId: 'speechmatics',
    kind: 'promo_credits',
    unit: 'credits',
    amount: 100,
    period: 'one_time',
    scope: 'account',
    resetAt: 'none',
    requiresPaymentMethod: false,
    productionAllowed: false,
    sourceUrls: ['https://www.speechmatics.com/pricing'],
    verifiedAt: '2026-10-03',
    confidence: 0.98,
    notes: 'Speech API free start: $100 credit, no card; includes STT and TTS. When consumed, a card is required to continue.',
  },

];

export function getVerifiedFreeOffers(providerId?: string): VerifiedFreeOffer[] {
  return providerId
    ? VERIFIED_FREE_OFFERS.filter((offer) => offer.providerId === providerId)
    : [...VERIFIED_FREE_OFFERS];
}
