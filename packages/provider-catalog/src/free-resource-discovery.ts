/**
 * Discovery-only providers surfaced by the FreeLLMAPI ecosystem.
 *
 * These are deliberately NOT appended to the executable ProviderTemplate
 * catalog until entitlement, endpoint compatibility and operational behavior
 * are verified by DMR-X. This lets the Resource Observatory discover more labs
 * without turning a directory listing into a routing decision.
 */

export interface DiscoveredFreeResource {
  providerId: string;
  displayName: string;
  source: 'freellmapi' | 'directory' | 'community';
  status: 'candidate' | 'needs_verification';
  modalities: string[];
  notes?: string;
  sourceUrl: string;
}

export const DISCOVERED_FREE_RESOURCES: DiscoveredFreeResource[] = [
  ['aclyde', 'Aclide', ['llm']],
  ['airforce', 'Airforce', ['llm']],
  ['blaze', 'Blaze', ['llm']],
  ['blockrun', 'BlockRun', ['llm']],
  ['clod', 'Clod', ['llm']],
  ['dreamprompting', 'DreamPrompting', ['llm']],
  ['experiential', 'Experiential', ['llm']],
  ['gizmo', 'Gizmo', ['llm']],
  ['llmtr', 'LLMtr', ['llm']],
  ['logfare', 'Logfare', ['llm']],
  ['lucidity', 'Lucidity', ['llm']],
  ['modelscope', 'ModelScope', ['llm', 'diffusion']],
  ['moondream', 'Moondream', ['vision']],
  ['router9', 'Router9', ['llm']],
  ['sail', 'Sail', ['llm']],
  ['septor', 'Septor', ['llm']],
  ['speka', 'Speka', ['llm']],
  ['waterfall', 'Waterfall', ['llm']],
  ['ai-horde', 'AI Horde', ['llm', 'diffusion', 'image_generation']],
  ['xkiro', 'xKiro', ['llm', 'image_generation', 'stt', 'tts', 'web_search', 'web_fetch']],
].map(([providerId, displayName, modalities]) => ({
  providerId,
  displayName,
  source: 'freellmapi',
  status: 'needs_verification',
  modalities,
  sourceUrl: 'https://github.com/tashfeenahmed/freellmapi',
}));

export function getDiscoveredFreeResources(): DiscoveredFreeResource[] {
  return [...DISCOVERED_FREE_RESOURCES];
}
