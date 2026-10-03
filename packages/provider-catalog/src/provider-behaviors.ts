/**
 * Provider behavior notes learned from FreeLLMAPI and live provider research.
 *
 * These are not routing entitlements. They describe protocol and operational
 * quirks that should affect probing, retrying, timeout, quota ownership and
 * capability filtering.
 */

export type ValidationStrategy =
  | 'none'
  | 'model_list'
  | 'key_validation'
  | 'usage_endpoint'
  | 'token_probe'
  | 'browser_probe';

export type ExecutionShape = 'sync' | 'queued_job' | 'streaming' | 'batch';

export interface ProviderBehavior {
  providerId: string;
  validation: ValidationStrategy;
  executionShape: ExecutionShape;
  keyless?: boolean;
  quotaOwner?: 'key' | 'account' | 'organization' | 'project' | 'ip' | 'device' | 'unknown';
  supportsStreaming?: boolean;
  supportsTools?: boolean;
  supportsImages?: boolean;
  supportsAudio?: boolean;
  clientRestriction?: 'none' | 'specific_client' | 'enrollment';
  specialTimeoutMs?: number;
  notes: string[];
  sourceUrls: string[];
  verifiedAt: string;
}

export const PROVIDER_BEHAVIORS: ProviderBehavior[] = [
  {
    providerId: 'inception',
    validation: 'model_list',
    executionShape: 'streaming',
    quotaOwner: 'credential',
    supportsStreaming: true,
    supportsTools: true,
    notes: [
      'OpenAI-compatible diffusion LLM endpoint.',
      'Free entitlement is token-credit based and should be reconciled from live account state.',
    ],
    sourceUrls: ['https://www.inceptionlabs.ai/models'],
    verifiedAt: '2026-10-03',
  },
  {
    providerId: 'alibaba-model-studio',
    validation: 'model_list',
    executionShape: 'streaming',
    quotaOwner: 'account',
    supportsStreaming: true,
    supportsTools: true,
    notes: [
      'New-user free quota is model-specific, account-shared and valid for 90 days in Singapore.',
      'Enable the provider-side Free Quota Only protection where possible to prevent paid spillover.',
    ],
    sourceUrls: ['https://www.alibabacloud.com/help/en/model-studio/new-free-quota'],
    verifiedAt: '2026-10-03',
  },
  {
    providerId: 'baidu-qianfan',
    validation: 'model_list',
    executionShape: 'streaming',
    quotaOwner: 'account',
    supportsStreaming: true,
    supportsTools: true,
    notes: [
      'Qianfan v2 supports OpenAI-compatible requests and API-key model listing.',
      'New-user free allowance amount is advertised at the product level; exact model allocation must be observed.',
    ],
    sourceUrls: ['https://cloud.baidu.com/doc/qianfan-api/s/Dmba8k71y'],
    verifiedAt: '2026-10-03',
  },
  {
    providerId: 'nebius',
    validation: 'model_list',
    executionShape: 'streaming',
    quotaOwner: 'account',
    supportsStreaming: true,
    supportsTools: true,
    notes: [
      'OpenAI-compatible Token Factory endpoint.',
      'Free credits are account-level; public pages do not expose a stable universal amount.',
    ],
    sourceUrls: ['https://nebius.com/services/token-factory/inference-service'],
    verifiedAt: '2026-10-03',
  },
  {
    providerId: 'speechmatics',
    validation: 'usage_endpoint',
    executionShape: 'queued_job',
    quotaOwner: 'account',
    supportsAudio: true,
    notes: [
      'Speech API supports batch jobs and a usage endpoint; model job identity must stay bound to the same region endpoint.',
      'Free start is a finite credit balance, not a recurring quota.',
    ],
    sourceUrls: ['https://asr.api.speechmatics.com/v2/', 'https://www.speechmatics.com/pricing'],
    verifiedAt: '2026-10-03',
  },
  {
    providerId: 'aihorde',
    validation: 'none',
    executionShape: 'queued_job',
    keyless: true,
    quotaOwner: 'account',
    supportsStreaming: false,
    supportsTools: false,
    specialTimeoutMs: 120000,
    notes: [
      'Queue-based generation; anonymous/keyless operation exists.',
      'Treat kudos/queue capacity as the economic resource instead of token quota.',
    ],
    sourceUrls: ['https://github.com/tashfeenahmed/freellmapi'],
    verifiedAt: '2026-10-03',
  },
  {
    providerId: 'kilo-gateway',
    validation: 'model_list',
    executionShape: 'streaming',
    quotaOwner: 'ip',
    clientRestriction: 'none',
    notes: [
      'Free :free routes have an IP-scoped hourly limit.',
      'Some free routes permit upstream logging/training; feed this to privacy policy.',
    ],
    sourceUrls: ['https://kilo.ai/docs/free-models', 'https://github.com/tashfeenahmed/freellmapi'],
    verifiedAt: '2026-10-03',
  },
  {
    providerId: 'opencode-zen',
    validation: 'model_list',
    executionShape: 'streaming',
    clientRestriction: 'specific_client',
    notes: [
      'Free promotional routes can be client-locked and return 403 to external clients.',
      'A free model row must be disabled when the observed client restriction is incompatible.',
    ],
    sourceUrls: ['https://opencode.ai/docs/zen/', 'https://github.com/tashfeenahmed/freellmapi'],
    verifiedAt: '2026-10-03',
  },
  {
    providerId: 'modelscope',
    validation: 'token_probe',
    executionShape: 'streaming',
    quotaOwner: 'account',
    notes: [
      'A models endpoint can return success for unusable credentials.',
      'Use a minimal one-token inference probe to validate real authorization.',
    ],
    sourceUrls: ['https://github.com/tashfeenahmed/freellmapi'],
    verifiedAt: '2026-10-03',
  },
  {
    providerId: 'pollinations',
    validation: 'key_validation',
    executionShape: 'sync',
    quotaOwner: 'account',
    keyless: true,
    supportsImages: true,
    supportsAudio: true,
    notes: [
      'Model/key list results can remain positive after a key is revoked.',
      'Validate account/key state separately and keep shared pollen capacity separate from credential count.',
    ],
    sourceUrls: ['https://github.com/tashfeenahmed/freellmapi'],
    verifiedAt: '2026-10-03',
  },
  {
    providerId: 'ollama-cloud',
    validation: 'usage_endpoint',
    executionShape: 'streaming',
    quotaOwner: 'account',
    notes: [
      'Free capacity is GPU-time/session/concurrency based rather than a simple monthly token bucket.',
      'Model as compute-time and concurrency resources.',
    ],
    sourceUrls: ['https://github.com/tashfeenahmed/freellmapi'],
    verifiedAt: '2026-10-03',
  },
  {
    providerId: 'ovhcloud',
    validation: 'none',
    executionShape: 'streaming',
    quotaOwner: 'ip',
    keyless: true,
    notes: [
      'Anonymous AI Endpoints have a low IP/model limit; authenticated project quotas are different.',
      'Never multiply the anonymous pool by adding fake credentials.',
    ],
    sourceUrls: ['https://www.ovhcloud.com/en/public-cloud/ai-endpoints/catalog/', 'https://github.com/tashfeenahmed/freellmapi'],
    verifiedAt: '2026-10-03',
  },
  {
    providerId: 'routeway',
    validation: 'browser_probe',
    executionShape: 'streaming',
    quotaOwner: 'ip',
    notes: [
      'Advertised and observed limits can differ.',
      'Treat live measurement as stronger evidence than a stale published limit.',
    ],
    sourceUrls: ['https://github.com/tashfeenahmed/freellmapi'],
    verifiedAt: '2026-10-03',
  },
  {
    providerId: 'unorouter',
    validation: 'usage_endpoint',
    executionShape: 'streaming',
    quotaOwner: 'account',
    notes: [
      'Free-model bursts can trigger account-wide 429s.',
      'Pool the allowance at the account/router level.',
    ],
    sourceUrls: ['https://github.com/tashfeenahmed/freellmapi'],
    verifiedAt: '2026-10-03',
  },
  {
    providerId: 'xkiro',
    validation: 'usage_endpoint',
    executionShape: 'streaming',
    quotaOwner: 'account',
    supportsImages: true,
    supportsAudio: true,
    notes: [
      'Usage endpoint is authoritative for daily free tokens and rolling media/search allowances.',
      'Search/fetch, speech concurrency and image jobs are separate resource pools.',
    ],
    sourceUrls: ['https://github.com/tashfeenahmed/freellmapi'],
    verifiedAt: '2026-10-03',
  },
  {
    providerId: 'nvidia',
    validation: 'model_list',
    executionShape: 'streaming',
    quotaOwner: 'account',
    supportsTools: false,
    specialTimeoutMs: 90000,
    notes: [
      'Some NIM models have tool-call quirks and slow cold starts.',
      'Do not use one global timeout for every model.',
    ],
    sourceUrls: ['https://developer.nvidia.com/nim', 'https://github.com/tashfeenahmed/freellmapi'],
    verifiedAt: '2026-10-03',
  },
];

export function getProviderBehavior(providerId: string): ProviderBehavior | undefined {
  return PROVIDER_BEHAVIORS.find((behavior) => behavior.providerId === providerId);
}
