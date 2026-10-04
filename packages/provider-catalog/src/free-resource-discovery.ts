/**
 * Discovery-only resources. Discovery may come from official provider pages,
 * FreeLLMAPI, or community/directory sources, but discovery never grants
 * routing eligibility by itself.
 */

export interface DiscoveredFreeResource {
  providerId: string;
  displayName: string;
  source: 'official' | 'freellmapi' | 'directory' | 'community';
  status: 'candidate' | 'needs_verification';
  modalities: string[];
  notes?: string;
  sourceUrl: string;
}

type DiscoverySeed = readonly [
  providerId: string,
  displayName: string,
  source: DiscoveredFreeResource['source'],
  modalities: string[],
  sourceUrl: string,
];

const DISCOVERY_SEEDS: readonly DiscoverySeed[] = [
  ['aclyde', 'Aclide', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['airforce', 'Airforce', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['blaze', 'Blaze', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['blockrun', 'BlockRun', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['clod', 'Clod', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['dreamprompting', 'DreamPrompting', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['experiential', 'Experiential', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['gizmo', 'Gizmo', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['llmtr', 'LLMtr', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['logfare', 'Logfare', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['lucidity', 'Lucidity', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['modelscope', 'ModelScope', 'freellmapi', ['llm', 'diffusion'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['moondream', 'Moondream', 'freellmapi', ['vision'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['router9', 'Router9', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['sail', 'Sail', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['septor', 'Septor', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['speka', 'Speka', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['waterfall', 'Waterfall', 'freellmapi', ['llm'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['ai-horde', 'AI Horde', 'freellmapi', ['llm', 'diffusion', 'image_generation'], 'https://github.com/tashfeenahmed/freellmapi'],
  ['xkiro', 'xKiro', 'freellmapi', ['llm', 'image_generation', 'stt', 'tts', 'web_search', 'web_fetch'], 'https://github.com/tashfeenahmed/freellmapi'],

  ['inception', 'Inception Labs', 'official', ['llm', 'reasoning'], 'https://www.inceptionlabs.ai/models'],
  ['alibaba-model-studio', 'Alibaba Cloud Model Studio', 'official', ['llm', 'vision', 'embedding', 'audio', 'image_generation'], 'https://www.alibabacloud.com/help/en/model-studio/new-free-quota'],
  ['baidu-qianfan', 'Baidu Qianfan', 'official', ['llm', 'vision', 'embedding', 'image_generation'], 'https://cloud.baidu.com/product/qianfan.html'],
  ['nebius', 'Nebius Token Factory', 'official', ['llm', 'vision', 'embedding'], 'https://nebius.com/services/token-factory/inference-service'],
  ['speechmatics', 'Speechmatics', 'official', ['stt', 'tts'], 'https://www.speechmatics.com/pricing'],
  ['llm7', 'LLM7', 'directory', ['llm', 'reasoning', 'vision'], 'https://llm7.io/'],
  ['novita', 'Novita AI', 'directory', ['llm', 'image_generation', 'video_generation'], 'https://novita.ai/'],
  ['braintrust', 'Braintrust', 'official', ['evaluation', 'scoring', 'verification'], 'https://www.braintrust.dev/pricing'],
  ['futureagi', 'Future AGI', 'official', ['evaluation', 'simulation', 'voice'], 'https://docs.futureagi.com/docs/billing/reference/pricing'],
  ['agentrouter', 'AgentRouter', 'directory', ['llm'], 'https://aifree.dev/free-api-credits'],
];

export const DISCOVERED_FREE_RESOURCES: DiscoveredFreeResource[] = DISCOVERY_SEEDS.map(
  ([providerId, displayName, source, modalities, sourceUrl]) => ({
    providerId,
    displayName,
    source,
    status: 'needs_verification' as const,
    modalities,
    sourceUrl,
  }),
);

export function getDiscoveredFreeResources(): DiscoveredFreeResource[] {
  return [...DISCOVERED_FREE_RESOURCES];
}
