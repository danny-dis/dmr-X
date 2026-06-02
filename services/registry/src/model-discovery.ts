/**
 * Model discovery for OpenAI-compatible providers.
 *
 * Polls `${baseUrl}/models` and normalizes the response into the
 * `model_profiles` row shape used throughout the registry. Supports
 * keyless providers (Pollinations) and any provider that returns the
 * standard `{ object: "list", data: [{ id, ... }] }` payload.
 */

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
}

export interface ModelDiscoveryOptions {
  baseUrl: string;
  apiKey?: string;
  /** Injected for tests; defaults to global fetch */
  fetchImpl?: typeof fetch;
  /** Hard timeout in ms; default 5000 */
  timeoutMs?: number;
}

const TIMEOUT_MS = 5000;

/**
 * Fetch and normalize models from an OpenAI-compatible provider.
 * Returns an empty list on any error so callers can log + continue.
 */
export async function discoverOpenAIModels(
  options: ModelDiscoveryOptions
): Promise<DiscoveredModel[]> {
  const { baseUrl, apiKey = '', fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = options;

  if (!baseUrl) {
    logger.warn('discoverOpenAIModels called with empty baseUrl');
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
function normalizeModel(raw: Record<string, unknown>): DiscoveredModel {
  const id = String(raw.id ?? raw.name ?? '').trim();
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

  return {
    modelId: id,
    displayName: id,
    modality,
    contextWindow: numberOrNull(raw.context_window ?? raw.contextWindow ?? raw.context_length),
    maxOutputTokens: numberOrNull(raw.max_output_tokens ?? raw.maxOutputTokens),
    inputCostPer1M: 0,
    outputCostPer1M: 0,
    costPerImage: 0,
    capabilities,
    specializations: [],
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
  return Array.from(caps);
}

function inferModality(raw: Record<string, unknown>, id: string): string {
  const v = raw.modality ?? raw.type ?? raw.object;
  if (typeof v === 'string') {
    const lower = v.toLowerCase();
    if (lower.includes('embed')) return 'embedding';
    if (lower.includes('image') || lower.includes('diffusion')) return 'diffusion';
    if (lower.includes('audio')) return 'audio';
    if (lower.includes('vision') || lower.includes('multimodal')) return 'multimodal';
    if (lower === 'llm' || lower === 'chat' || lower === 'model') return 'llm';
  }
  if (id.toLowerCase().includes('embed')) return 'embedding';
  if (id.toLowerCase().includes('vision')) return 'multimodal';
  return 'llm';
}
