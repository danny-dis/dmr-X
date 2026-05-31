/**
 * DMR-X MCP Server
 *
 * Exposes DMR-X routing capabilities as MCP tools.
 * Transport-agnostic: works with stdio, SSE, and Streamable HTTP transports.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Router, type RouterConfig, type ClassifyOptions } from '@dmr-x/router';
import { AdapterRegistry, OpenAIAdapter, AnthropicAdapter, OllamaAdapter } from '@dmr-x/adapters';
import { ReplicateAdapter, StabilityAdapter } from '@dmr-x/adapters';
import { ElevenLabsAdapter, DeepgramAdapter } from '@dmr-x/adapters';
import { CohereAdapter, JinaAdapter } from '@dmr-x/adapters';
import type {
  UnifiedRequest,
  UnifiedResponse,
  CandidateSet,
  Modality,
  QualityTarget,
  ProviderModel,
} from '@dmr-x/core';
import {
  TOOL_NAMES,
  TOOL_DESCRIPTIONS,
  dmrxChatParams as chatParams,
  dmrxGenerateImageParams as imageParams,
  dmrxEmbedParams as embedParams,
  dmrxTranscribeParams as transcribeParams,
  dmrxSpeakParams as speakParams,
  dmrxRerankParams as rerankParams,
  dmrxModelsParams as modelsParams,
  dmrxStatusParams as statusParams,
} from './tools.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DMRXMcpServerConfig {
  /** Router configuration */
  router?: RouterConfig;
  /** Pre-loaded candidate set (if not using registry) */
  candidates?: CandidateSet;
  /** Adapter configurations keyed by provider ID */
  adapterConfigs?: Record<string, { baseUrl: string; apiKey?: string }>;
  /** Enable task decomposition for complex prompts */
  enableDecomposition?: boolean;
}

interface ServerState {
  router: Router;
  adapterRegistry: AdapterRegistry;
  candidates: CandidateSet;
  startTime: number;
  requestCount: number;
  lastError: string | null;
  /** SDK tool definitions for programmatic access and discovery */
  sdkTools: Array<{ name: string; description: string; params: unknown }>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Map a modality to the API endpoint path expected by the task classifier */
const MODALITY_TO_PATH: Record<Modality, string> = {
  llm: '/v1/chat/completions',
  diffusion: '/v1/images/generations',
  embedding: '/v1/embeddings',
  audio_tts: '/v1/audio/speech',
  audio_stt: '/v1/audio/transcriptions',
  audio_speech: '/v1/audio/speech',
  audio_transcription: '/v1/audio/transcriptions',
  video: '/v1/video/generations',
  music: '/v1/music/generations',
  reranking: '/v1/rerank',
  moderation: '/v1/moderations',
  code_completion: '/v1/completions',
  image_upscaling: '/v1/images/upscale',
  image_inpainting: '/v1/images/inpaint',
};

function buildAdapterRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(new OpenAIAdapter());
  registry.register(new AnthropicAdapter());
  registry.register(new OllamaAdapter());
  registry.register(new ReplicateAdapter());
  registry.register(new StabilityAdapter());
  registry.register(new ElevenLabsAdapter());
  registry.register(new DeepgramAdapter());
  registry.register(new CohereAdapter());
  registry.register(new JinaAdapter());
  return registry;
}

function toUnifiedRequest(
  modality: Modality,
  params: Record<string, unknown>
): UnifiedRequest {
  const request: UnifiedRequest = {
    modality,
    stream: false,
    metadata: {},
  };

  // Map common fields
  if (params.model) request.model = params.model as string;
  if (params.user) request.user = params.user as string;
  if (params.quality_target) {
    request.metadata.qualityTarget = params.quality_target;
  }

  // Modality-specific mapping
  switch (modality) {
    case 'llm':
      request.messages = params.messages as UnifiedRequest['messages'];
      request.temperature = params.temperature as number | undefined;
      request.max_tokens = params.max_tokens as number | undefined;
      request.top_p = params.top_p as number | undefined;
      request.frequency_penalty = params.frequency_penalty as number | undefined;
      request.presence_penalty = params.presence_penalty as number | undefined;
      request.stop = params.stop as string[] | undefined;
      request.response_format = params.response_format as UnifiedRequest['response_format'];
      request.seed = params.seed as number | null | undefined;
      request.n = params.n as number | undefined;
      request.tools = params.tools as UnifiedRequest['tools'];
      request.tool_choice = params.tool_choice as UnifiedRequest['tool_choice'];
      break;

    case 'diffusion':
      request.prompt = params.prompt as string;
      request.negative_prompt = params.negative_prompt as string | undefined;
      request.width = params.width as number | undefined;
      request.height = params.height as number | undefined;
      request.steps = params.steps as number | undefined;
      request.diffusion_seed = params.seed as number | undefined;
      request.style = params.style as string | undefined;
      request.cfg_scale = params.cfg_scale as number | undefined;
      request.n = params.n as number | undefined;
      break;

    case 'embedding':
      request.input = params.input as string | string[];
      request.dimensions = params.dimensions as number | undefined;
      request.encoding_format = params.encoding_format as 'float' | 'base64' | undefined;
      break;

    case 'audio_stt':
      request.audio = params.audio as string;
      request.audio_format = params.audio_format as UnifiedRequest['audio_format'];
      request.language = params.language as string | undefined;
      break;

    case 'audio_tts':
      request.prompt = params.input as string;
      request.voice = params.voice as string | undefined;
      request.speed = params.speed as number | undefined;
      request.format = params.format as string | undefined;
      request.language = params.language as string | undefined;
      break;

    case 'reranking':
      request.query = params.query as string;
      request.documents = params.documents as string[];
      request.top_n = params.top_n as number | undefined;
      break;
  }

  return request;
}

function formatChatResponse(response: UnifiedResponse): string {
  const result: Record<string, unknown> = {
    id: response.requestId,
    object: 'chat.completion',
    model: response.modelId,
    provider: response.providerId,
    created: Math.floor(Date.now() / 1000),
  };

  if (response.message) {
    result.choices = [{
      index: 0,
      message: response.message,
      finish_reason: response.finishReason || 'stop',
    }];
  }

  if (response.usage) {
    result.usage = response.usage;
  }

  return JSON.stringify(result, null, 2);
}

function formatImageResponse(response: UnifiedResponse): string {
  const result: Record<string, unknown> = {
    created: Math.floor(Date.now() / 1000),
    provider: response.providerId,
    model: response.modelId,
    data: response.images?.map((img) => ({
      url: img.url,
      b64_json: img.b64_json,
      revised_prompt: img.revised_prompt,
    })) || [],
  };

  return JSON.stringify(result, null, 2);
}

function formatEmbeddingResponse(response: UnifiedResponse): string {
  const result: Record<string, unknown> = {
    object: 'list',
    provider: response.providerId,
    model: response.modelId,
    data: response.embeddings?.map((embedding, index) => ({
      object: 'embedding',
      index,
      embedding,
    })) || [],
  };

  if (response.usage) {
    result.usage = response.usage;
  }

  return JSON.stringify(result, null, 2);
}

function formatTranscribeResponse(response: UnifiedResponse): string {
  const result: Record<string, unknown> = {
    provider: response.providerId,
    model: response.modelId,
    text: response.completion || response.message?.content || '',
  };

  return JSON.stringify(result, null, 2);
}

function formatSpeakResponse(response: UnifiedResponse): string {
  const result: Record<string, unknown> = {
    provider: response.providerId,
    model: response.modelId,
    audio: response.audio ? {
      url: response.audio.url,
      b64_json: response.audio.b64_json,
      format: response.audio.format,
      duration: response.audio.duration,
    } : null,
  };

  return JSON.stringify(result, null, 2);
}

function formatRerankResponse(response: UnifiedResponse): string {
  const result: Record<string, unknown> = {
    provider: response.providerId,
    model: response.modelId,
    results: response.rerankResults?.map((r) => ({
      index: r.index,
      relevance_score: r.relevance_score,
      document: r.document,
    })) || [],
  };

  return JSON.stringify(result, null, 2);
}

function formatRoutingInfo(response: UnifiedResponse): string {
  return `\n\n---\nRouted via: ${response.providerId} / ${response.modelId} (${response.latencyMs}ms)`;
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createDMRXMcpServer(config: DMRXMcpServerConfig = {}): {
  server: McpServer;
  state: ServerState;
} {
  // Initialize adapter registry
  const adapterRegistry = buildAdapterRegistry();

  // Initialize adapter configs
  const adapterConfigs = config.adapterConfigs || {};

  // Initialize adapters asynchronously (will be awaited on first use)
  let adaptersInitialized = false;
  const initAdapters = async () => {
    if (adaptersInitialized) return;
    for (const [providerId, cfg] of Object.entries(adapterConfigs)) {
      try {
        await adapterRegistry.initialize(providerId, cfg);
      } catch (initErr) {
        // Adapter not configured — skip but log for debugging
        console.warn(`[mcp-server] Failed to initialize adapter "${providerId}":`, initErr instanceof Error ? initErr.message : initErr);
      }
    }
    adaptersInitialized = true;
  };

  // Create router
  const router = new Router(config.router);

  // Server state
  const state: ServerState = {
    router,
    adapterRegistry,
    candidates: config.candidates || [],
    startTime: Date.now(),
    requestCount: 0,
    lastError: null,
    sdkTools: [],
  };

  // SDK tool definitions for programmatic access and discovery
  const sdkToolDefs: Array<{ name: string; description: string; params: unknown }> = [
    { name: TOOL_NAMES.CHAT, description: TOOL_DESCRIPTIONS[TOOL_NAMES.CHAT], params: chatParams },
    { name: TOOL_NAMES.GENERATE_IMAGE, description: TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_IMAGE], params: imageParams },
    { name: TOOL_NAMES.EMBED, description: TOOL_DESCRIPTIONS[TOOL_NAMES.EMBED], params: embedParams },
    { name: TOOL_NAMES.TRANSCRIBE, description: TOOL_DESCRIPTIONS[TOOL_NAMES.TRANSCRIBE], params: transcribeParams },
    { name: TOOL_NAMES.SPEAK, description: TOOL_DESCRIPTIONS[TOOL_NAMES.SPEAK], params: speakParams },
    { name: TOOL_NAMES.RERANK, description: TOOL_DESCRIPTIONS[TOOL_NAMES.RERANK], params: rerankParams },
    { name: TOOL_NAMES.MODELS, description: TOOL_DESCRIPTIONS[TOOL_NAMES.MODELS], params: modelsParams },
    { name: TOOL_NAMES.STATUS, description: TOOL_DESCRIPTIONS[TOOL_NAMES.STATUS], params: statusParams },
  ];

  for (const def of sdkToolDefs) {
    state.sdkTools.push(def);
  }

  // Wire up adapter executor for fallback
  router.setAdapterExecutor({
    async execute(providerId: string, modelId: string, request: UnifiedRequest) {
      const adapter = adapterRegistry.get(providerId);
      if (!adapter) {
        throw new Error(`Adapter not found: ${providerId}`);
      }
      // Override model if a specific one was selected by the router
      if (modelId) {
        request.model = modelId;
      }
      return adapter.execute(request);
    },
  });

  // Load candidates if provided
  if (config.candidates?.length) {
    router.setCandidates(config.candidates);
  }

  // Create MCP server
  const server = new McpServer({
    name: 'dmr-x',
    version: '0.1.0',
  });

  // -----------------------------------------------------------------------
  // Tool: dmrx_chat
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.CHAT,
    TOOL_DESCRIPTIONS[TOOL_NAMES.CHAT],
    chatParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const request = toUnifiedRequest('llm', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['llm'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatChatResponse(response);

        return {
          content: [{
            type: 'text' as const,
            text: formatted + formatRoutingInfo(response),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_generate_image
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.GENERATE_IMAGE,
    TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_IMAGE],
    imageParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const request = toUnifiedRequest('diffusion', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['diffusion'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatImageResponse(response);

        return {
          content: [{
            type: 'text' as const,
            text: formatted + formatRoutingInfo(response),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_embed
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.EMBED,
    TOOL_DESCRIPTIONS[TOOL_NAMES.EMBED],
    embedParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const request = toUnifiedRequest('embedding', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['embedding'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatEmbeddingResponse(response);

        return {
          content: [{
            type: 'text' as const,
            text: formatted + formatRoutingInfo(response),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_transcribe
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.TRANSCRIBE,
    TOOL_DESCRIPTIONS[TOOL_NAMES.TRANSCRIBE],
    transcribeParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const request = toUnifiedRequest('audio_stt', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['audio_stt'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatTranscribeResponse(response);

        return {
          content: [{
            type: 'text' as const,
            text: formatted + formatRoutingInfo(response),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_speak
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.SPEAK,
    TOOL_DESCRIPTIONS[TOOL_NAMES.SPEAK],
    speakParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const request = toUnifiedRequest('audio_tts', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['audio_tts'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatSpeakResponse(response);

        return {
          content: [{
            type: 'text' as const,
            text: formatted + formatRoutingInfo(response),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_rerank
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.RERANK,
    TOOL_DESCRIPTIONS[TOOL_NAMES.RERANK],
    rerankParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const request = toUnifiedRequest('reranking', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['reranking'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatRerankResponse(response);

        return {
          content: [{
            type: 'text' as const,
            text: formatted + formatRoutingInfo(response),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_models
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.MODELS,
    TOOL_DESCRIPTIONS[TOOL_NAMES.MODELS],
    modelsParams as any,
    async (params: any) => {
      await initAdapters();

      try {
        let models: ProviderModel[] = [...state.candidates];

        // Apply modality filter
        if (params.modality) {
          models = models.filter((m) => m.modality === params.modality);
        }

        // Apply provider filter
        if (params.provider) {
          models = models.filter((m) =>
            m.providerId.toLowerCase().includes((params.provider as string).toLowerCase())
          );
        }

        // If no candidates loaded, list from adapters
        if (models.length === 0 && state.candidates.length === 0) {
          const adapterModels: Array<{
            provider: string;
            modelId: string;
            modality: string;
            capabilities: string[];
          }> = [];

          for (const providerId of state.adapterRegistry.list()) {
            const adapter = state.adapterRegistry.get(providerId);
            if (adapter) {
              try {
                const info = await adapter.listModels();
                for (const model of info) {
                  if (!params.modality || model.modality === params.modality) {
                    adapterModels.push({
                      provider: providerId,
                      modelId: model.modelId,
                      modality: model.modality,
                      capabilities: model.capabilities,
                    });
                  }
                }
              } catch (listErr) {
                // Adapter not initialized — skip but log for debugging
                console.warn(`[mcp-server] Failed to list models from adapter:`, listErr instanceof Error ? listErr.message : listErr);
              }
            }
          }

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                source: 'adapters',
                count: adapterModels.length,
                models: adapterModels,
              }, null, 2),
            }],
          };
        }

        const formatted = models.map((m) => ({
          provider: m.providerId,
          providerName: m.providerName,
          model: m.modelId,
          modality: m.modality,
          intelligenceLayer: m.intelligenceLayer,
          capabilities: m.capabilities,
          qualityScore: m.qualityScore,
          avgLatencyMs: m.avgLatencyMs,
          costPerInputToken: m.costPerInputToken,
          costPerOutputToken: m.costPerOutputToken,
          costPerImage: m.costPerImage,
          healthy: m.isHealthy,
        }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              source: 'registry',
              count: formatted.length,
              models: formatted,
            }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_status
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.STATUS,
    TOOL_DESCRIPTIONS[TOOL_NAMES.STATUS],
    statusParams as any,
    async (params: any) => {
      await initAdapters();

      try {
        const uptimeMs = Date.now() - state.startTime;
        const uptimeHours = Math.floor(uptimeMs / 3600000);
        const uptimeMinutes = Math.floor((uptimeMs % 3600000) / 60000);

        const status: Record<string, unknown> = {
          status: 'ok',
          version: '0.1.0',
          uptime: `${uptimeHours}h ${uptimeMinutes}m`,
          uptimeMs,
          requestsHandled: state.requestCount,
          lastError: state.lastError,
          router: {
            candidateCount: state.candidates.length,
            config: {
              epsilon: state.router['config']?.epsilon ?? 0.05,
              defaultQualityTarget: state.router['config']?.defaultQualityTarget ?? 'balanced',
              enableDecomposition: state.router['config']?.enableDecomposition ?? false,
            },
          },
        };

        // Include provider health if requested
        if (params.include_providers) {
          const providerHealth: Record<string, { healthy: boolean; modalities: string[] }> = {};
          for (const providerId of state.adapterRegistry.list()) {
            const adapter = state.adapterRegistry.get(providerId);
            if (adapter) {
              try {
                const health = await adapter.healthCheck();
                providerHealth[providerId] = {
                  healthy: health.healthy,
                  modalities: adapter.supportedModalities,
                };
              } catch {
                providerHealth[providerId] = {
                  healthy: false,
                  modalities: adapter.supportedModalities,
                };
              }
            }
          }
          status.providers = providerHealth;
        }

        // Include model details if requested
        if (params.include_models && state.candidates.length > 0) {
          const modelsByModality: Record<string, number> = {};
          for (const candidate of state.candidates) {
            modelsByModality[candidate.modality] = (modelsByModality[candidate.modality] || 0) + 1;
          }
          status.modelsByModality = modelsByModality;
          status.totalModels = state.candidates.length;
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(status, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  return { server, state };
}
