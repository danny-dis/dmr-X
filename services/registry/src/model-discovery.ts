/**
 * Model discovery for OpenAI-compatible providers.
 *
 * Polls `${baseUrl}/models` and normalizes the response into the
 * `model_profiles` row shape used throughout the registry. Supports
 * keyless providers (Pollinations) and any provider that returns the
 * standard `{ object: "list", data: [{ id, ... }] }` payload.
 */

import net from 'node:net';

import { logger } from '@dmr-x/utils';

export interface DiscoveredModel {
  modelId: string;
  displayName: string;
  modality: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  inputCostPer1M: number;
  outputCostPer1M: number;
  costPerImage: number;
  capabilities: string[];
  specializations: string[];
  /** If true, this model is only available via OAuth subscription auth (not API key) */
  subscriptionOnly?: boolean;
  /** Free-tier metadata carried over from the static catalog (when the /v1/models
   *  endpoint publishes none). Kept optional so discovery-only models stay flat. */
  rateLimits?: { rpm?: number; rpd?: number; tpm?: number; tpd?: number };
  monthlyTokenBudget?: number;
  intelligenceRank?: number;
  speedRank?: number;
}

export interface ModelDiscoveryOptions {
  baseUrl: string;
  apiKey?: string;
  /** Injected for tests; defaults to global fetch */
  fetchImpl?: typeof fetch;
  /** Hard timeout in ms; default 5000 */
  timeoutMs?: number;
  /**
   * Injected for tests; defaults to a 250ms TCP probe. Returns true when
   * the host:port is reachable (i.e. the local model server is actually
   * running). Set to `() => Promise.resolve(true)` to disable the probe.
   */
  isReachable?: (url: URL) => Promise<boolean>;
}

/**
 * OpenRouter's own virtual routing models. They are not concrete models —
 * routing to `openrouter/auto` hands the decision back to OpenRouter's
 * server-side router, defeating DMR-X's own scoring — and they publish a
 * "-1" pricing sentinel that corrupts every cost-based scorer. They are
 * excluded from the candidate pool entirely.
 */
export const OPENROUTER_VIRTUAL_MODEL_IDS: readonly string[] = [
  'openrouter/auto',
  'openrouter/auto-beta',
  'openrouter/bodybuilder',
  'openrouter/free',
  'openrouter/fusion',
  'openrouter/pareto-code',
];

export function isOpenRouterVirtualModel(modelId: string): boolean {
  return OPENROUTER_VIRTUAL_MODEL_IDS.includes(modelId);
}

const TIMEOUT_MS = 1000;
const LOCAL_REACHABILITY_TIMEOUT_MS = 250;

/**
 * Quick TCP probe for localhost-style URLs. Returns false fast (sub-250ms)
 * when nothing is listening on the port, so we never fire the real fetch
 * at a closed port — that was leaking unhandled rejections from the boot
 * path on dev machines that don't run the local model stack.
 */
function defaultIsReachable(url: URL, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!isLocalishHost(url.hostname)) {
      resolve(true);
      return;
    }
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    try {
      socket.connect(Number(url.port) || (url.protocol === 'https:' ? 443 : 80), url.hostname);
    } catch {
      finish(false);
    }
  });
}

function isLocalishHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === '::1' ||
    host === '0.0.0.0'
  );
}

/**
 * Fetch and normalize models from an OpenAI-compatible provider.
 * Returns an empty list on any error so callers can log + continue.
 */
export async function discoverOpenAIModels(
  options: ModelDiscoveryOptions
): Promise<DiscoveredModel[]> {
  const {
    baseUrl,
    apiKey = '',
    fetchImpl = fetch,
    timeoutMs = TIMEOUT_MS,
    isReachable = (u) => defaultIsReachable(u, LOCAL_REACHABILITY_TIMEOUT_MS),
  } = options;

  if (!baseUrl) {
    logger.warn('discoverOpenAIModels called with empty baseUrl');
    return [];
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    logger.warn({ baseUrl }, 'discoverOpenAIModels called with invalid baseUrl');
    return [];
  }

  // Short-circuit localhost URLs whose port isn't accepting connections.
  // The real /v1/models fetch below would otherwise ECONNREFUSED on every
  // boot for any developer who hasn't started the local model stack.
  if (!(await isReachable(parsed))) {
    logger.debug(
      { baseUrl, host: parsed.hostname, port: parsed.port },
      'Skipping model discovery: upstream port is not accepting connections',
    );
    return [];
  }

  const url = `${baseUrl.replace(/\/$/, '')}/models`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn(
        { baseUrl, status: response.status },
        'Model discovery returned non-OK status',
      );
      return [];
    }

    const payload = (await response.json()) as unknown;
    const data = extractModelList(payload);
    if (data.length === 0) {
      logger.warn({ baseUrl }, 'Model discovery returned empty list');
      return [];
    }

    return data
      .map((m) => normalizeModel(m))
      .filter((m) => m.modelId.length > 0);
  } catch (error) {
    logger.warn(
      { err: error, baseUrl },
      'Model discovery failed',
    );
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort extraction of the model list from an OpenAI-shaped response.
 * Tolerates: `{ data: [...] }`, `{ models: [...] }`, or a bare array.
 */
function extractModelList(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (isRecord(payload)) {
    if (Array.isArray(payload.data)) {
      return payload.data.filter(isRecord);
    }
    if (Array.isArray(payload.models)) {
      return payload.models.filter(isRecord);
    }
  }
  return [];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Map a raw model object into our normalized shape.
 * Conservative defaults: $0 cost, 'streaming' capability only,
 * modality 'llm' unless the payload hints otherwise.
 */
/**
 * Strip provider namespacing that the chat endpoint does not expect.
 *
 * Google's OpenAI-compatible /models returns `models/gemini-2.5-flash` while
 * chat/completions wants the bare `gemini-2.5-flash`. Left as-is, discovery
 * inserts a duplicate prefixed row AND every stored bare id looks stale,
 * so cleanup would try to deactivate the entire provider.
 */
function canonicalModelId(rawId: string): string {
  return rawId.replace(/^models\//, '');
}

function normalizeModel(raw: Record<string, unknown>): DiscoveredModel {
  const id = canonicalModelId(String(raw.id ?? raw.name ?? '').trim());
  if (!id) {
    return {
      modelId: '',
      displayName: '',
      modality: 'llm',
      contextWindow: null,
      maxOutputTokens: null,
      inputCostPer1M: 0,
      outputCostPer1M: 0,
      costPerImage: 0,
      capabilities: [],
      specializations: [],
    };
  }

  const capabilities = inferCapabilities(raw);
  const modality = inferModality(raw, id);
  const pricing = extractPricing(raw);

  return {
    modelId: id,
    displayName: String(raw.display_name ?? raw.name ?? id),
    modality,
    // Spellings observed in the wild: OpenAI-style `context_window`,
    // OpenRouter `context_length`, Mistral `max_context_length`,
    // gitlawb `context_window`. Anything a provider publishes is used
    // verbatim; the static catalog is only consulted when the API is silent.
    contextWindow: numberOrNull(
      raw.context_window ??
        raw.contextWindow ??
        raw.context_length ??
        raw.max_context_length ??
        raw.maxContextLength,
    ),
    maxOutputTokens: numberOrNull(
      raw.max_output_tokens ?? raw.maxOutputTokens ?? raw.max_completion_tokens,
    ),
    inputCostPer1M: pricing.inputPer1M,
    outputCostPer1M: pricing.outputPer1M,
    costPerImage: pricing.perImage,
    capabilities,
    specializations: [],
  };
}

/**
 * Read pricing when the provider publishes it (gitlawb exposes `pricing`,
 * OpenRouter exposes per-token strings). Values are normalised to cost per
 * 1M tokens. Returns zeros when nothing is published — never invents a price.
 */
function extractPricing(raw: Record<string, unknown>): {
  inputPer1M: number;
  outputPer1M: number;
  perImage: number;
} {
  const src = (raw.pricing ?? raw.effective_pricing) as Record<string, unknown> | undefined;
  if (!src || typeof src !== 'object') {
    return { inputPer1M: 0, outputPer1M: 0, perImage: 0 };
  }
  // OpenRouter publishes per-token decimals as strings; per-1M variants are
  // already scaled. Detect which by field name rather than by magnitude.
  const perToken = (v: unknown): number => {
    const n = numberOrNull(v);
    return n === null ? 0 : n * 1_000_000;
  };
  const per1M = (v: unknown): number => numberOrNull(v) ?? 0;

  const input =
    src.input_per_1m !== undefined || src.prompt_per_1m !== undefined
      ? per1M(src.input_per_1m ?? src.prompt_per_1m)
      : perToken(src.input ?? src.prompt);
  const output =
    src.output_per_1m !== undefined || src.completion_per_1m !== undefined
      ? per1M(src.output_per_1m ?? src.completion_per_1m)
      : perToken(src.output ?? src.completion);

  // Clamp negative values to 0. OpenRouter publishes a "-1" sentinel for its
  // virtual routing models (openrouter/auto, openrouter/fusion, ...), and a
  // negative cost poisons every cost-based scorer (meta-model rankers do
  // `1 - totalCost*1000`, the pipeline scorer normalises `1 - cost/maxCost`),
  // giving those models an infinite "cheapest" score over every real model.
  return {
    inputPer1M: Number.isFinite(input) ? Math.max(0, input) : 0,
    outputPer1M: Number.isFinite(output) ? Math.max(0, output) : 0,
    perImage: numberOrNull(src.image ?? src.per_image) ?? 0,
  };
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function inferCapabilities(raw: Record<string, unknown>): string[] {
  const caps = new Set<string>(['streaming']);
  // Common explicit fields
  if (raw.supports_streaming === true) caps.add('streaming');
  if (raw.supports_tool_use === true || raw.supports_function_call === true) {
    caps.add('tool_use');
  }
  if (raw.supports_vision === true || raw.vision === true) caps.add('vision');
  if (raw.supports_reasoning === true || raw.reasoning === true) caps.add('reasoning');
  if (raw.supports_json_mode === true || raw.json_mode === true) caps.add('json_mode');

  // Capability arrays
  for (const key of ['capabilities', 'supported_features']) {
    const v = raw[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === 'string') caps.add(item);
      }
    }
  }

  // Capability OBJECTS. Mistral publishes
  //   capabilities: { completion_chat, function_calling, reasoning, vision, ... }
  // which the array branch above silently skipped, so tool_use/reasoning/vision
  // were dropped for every Mistral model and had to come from the catalog.
  const capObj = raw.capabilities;
  if (capObj && typeof capObj === 'object' && !Array.isArray(capObj)) {
    const flags = capObj as Record<string, unknown>;
    const on = (k: string): boolean => flags[k] === true;
    if (on('function_calling') || on('tool_use') || on('tools')) caps.add('tool_use');
    if (on('function_calling')) caps.add('function_call');
    if (on('vision') || on('image_understanding')) caps.add('vision');
    if (on('reasoning')) caps.add('reasoning');
    if (on('json_mode') || on('structured_outputs')) caps.add('json_mode');
    // Anything else that is simply true is carried through by name.
    for (const [k, v] of Object.entries(flags)) {
      if (v === true && !k.startsWith('completion_')) caps.add(k);
    }
  }
  return Array.from(caps);
}

/**
 * Model-id patterns for non-chat families, checked in order.
 *
 * Most `/v1/models` endpoints describe every entry identically — Google's
 * OpenAI-compatible listing returns `object: "model"` for all 57 of its
 * models — so the id is the only signal available. Previously only "embed"
 * and "vision" were recognised and everything else defaulted to `llm`, which
 * registered Veo (video), Imagen, Lyria (music), TTS and native-audio models
 * as chat candidates. The router could then pick `veo-3.1-generate-preview`
 * to answer a chat request, which fails 100% of the time.
 *
 * Ordering matters: image/video/music suffixes are checked before the
 * generic families so `gemini-3.1-flash-image` resolves to diffusion rather
 * than falling through to llm on the strength of "flash".
 */
const MODALITY_ID_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/embed/i, 'embedding'],
  [/(^|[-_/])(veo|sora|kling|wan|hunyuan-video)|[-_]video($|[-_])/i, 'video'],
  [/lyria|musicgen|suno|audiocraft/i, 'music'],
  [/imagen|dall-?e|stable-?diffusion|sdxl|nano-banana|flux/i, 'diffusion'],
  // Trailing "-image" / "-image-preview" marks an image-OUTPUT variant of an
  // otherwise chat-shaped family (gemini-3.1-flash-image).
  [/[-_]image([-_](preview|latest|\d{2}-\d{4}))?$/i, 'diffusion'],
  [/[-_]tts([-_]|$)|(^|[-_])tts[-_]|text-to-speech/i, 'audio_tts'],
  [/whisper|transcri|[-_]stt([-_]|$)/i, 'audio_stt'],
  // Realtime / bidirectional audio sessions are not chat-completions models.
  [/native-audio|[-_]live([-_]|$)|realtime/i, 'audio'],
  [/rerank/i, 'reranking'],
  [/moderat|[-_]guard([-_]|$)|shield/i, 'moderation'],
  [/vision/i, 'multimodal'],
];

function inferModality(raw: Record<string, unknown>, id: string): string {
  const v = raw.modality ?? raw.type ?? raw.object;
  if (typeof v === 'string') {
    const lower = v.toLowerCase();
    if (lower.includes('embed')) return 'embedding';
    if (lower.includes('image') || lower.includes('diffusion')) return 'diffusion';
    if (lower.includes('audio')) return 'audio';
    if (lower.includes('vision') || lower.includes('multimodal')) return 'multimodal';
    // `object: "model"` is what nearly every OpenAI-compatible endpoint
    // returns for everything, so it carries no information — fall through to
    // the id patterns rather than declaring it a chat model.
    if (lower === 'llm' || lower === 'chat') return 'llm';
  }

  for (const [pattern, modality] of MODALITY_ID_PATTERNS) {
    if (pattern.test(id)) return modality;
  }
  return 'llm';
}
