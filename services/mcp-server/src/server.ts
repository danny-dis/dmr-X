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
import { logger } from '@dmr-x/utils';
import { ElevenLabsAdapter, DeepgramAdapter } from '@dmr-x/adapters';
import { CohereAdapter, JinaAdapter, ComfyUIAdapter } from '@dmr-x/adapters';
import { FalAdapter, VeoAdapter, RunwayAdapter } from '@dmr-x/adapters';
import { MCPClient } from '@dmr-x/mcp-client';
import { z } from 'zod';
import type {
  UnifiedRequest,
  UnifiedResponse,
  CandidateSet,
  Modality,
  QualityTarget,
  ProviderModel,
} from '@dmr-x/core';
import { resolveProviderSlug } from '@dmr-x/core';
import {
  TOOL_NAMES,
  TOOL_DESCRIPTIONS,
  dmrxChatParams as chatParams,
  dmrxGenerateImageParams as imageParams,
  dmrxGenerateVideoParams as videoParams,
  dmrxGenerateMusicParams as musicParams,
  dmrxEmbedParams as embedParams,
  dmrxTranscribeParams as transcribeParams,
  dmrxSpeakParams as speakParams,
  dmrxRerankParams as rerankParams,
  dmrxModelsParams as modelsParams,
  dmrxStatusParams as statusParams,
  dmrxBatchParams as batchParams,
  dmrxContextSaveParams as contextSaveParams,
  dmrxContextLoadParams as contextLoadParams,
  dmrxContextListParams as contextListParams,
  dmrxContextSummarizeParams as contextSummarizeParams,
  dmrxContextCompressParams as contextCompressParams,
  dmrxChatStreamParams as chatStreamParams,
  dmrxGenerateImageStreamParams as imageStreamParams,
  dmrxGenerateVideoStreamParams as videoStreamParams,
  dmrxWorkflowParams as workflowParams,
  dmrxGenerate3DParams as threeDParams,
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
  /**
   * Already-connected MCP client. If provided, the server will re-expose
   * every tool from every connected external MCP server in the same MCP
   * tool list as dmrx_*, namespaced as `<serverId>__<toolName>`.
   * Use MCPClient.connect({ servers }) before passing it in.
   */
  externalMcpClient?: MCPClient;
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
  /** External MCP client (aggregator mode), if provided */
  externalMcpClient?: MCPClient;
  /** Number of external tools registered from the aggregator */
  externalToolCount: number;
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
  vision: '/v1/vision/detect',
  '3d': '/v1/3d/generate',
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
  registry.register(new ComfyUIAdapter());
  registry.register(new FalAdapter());
  registry.register(new VeoAdapter());
  registry.register(new RunwayAdapter());
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

  if (params.provider_preference) {
    request.metadata.providerPreferences = {
      order: (params.provider_preference as string[]).map(resolveProviderSlug),
      strategy: 'direct',
    };
  }
  if (params.provider_blacklist) {
    request.metadata.providerPreferences = {
      ...(request.metadata.providerPreferences || {}),
      ignore: (params.provider_blacklist as string[]).map(resolveProviderSlug),
    };
  }
  if (params.latency_target) {
    const latencyMs = typeof params.latency_target === 'number'
      ? params.latency_target as number
      : parseInt((params.latency_target as string).replace(/[^0-9]/g, ''), 10);
    request.metadata.providerPreferences = {
      ...(request.metadata.providerPreferences || {}),
      preferredMaxLatencyMs: latencyMs,
    };
  }
  if (params.cost_target) {
    const costPerMillion = typeof params.cost_target === 'number'
      ? (params.cost_target as number)
      : parseFloat((params.cost_target as string).replace(/[^0-9.]/g, ''));
    request.metadata.providerPreferences = {
      ...(request.metadata.providerPreferences || {}),
      maxPricePerMillionTokens: costPerMillion * 1_000_000,
    };
  }
  if (params.local_first) {
    const localSlugs = ['ollama', 'local'];
    request.metadata.providerPreferences = {
      ...(request.metadata.providerPreferences || {}),
      order: [
        ...(request.metadata.providerPreferences?.order || []),
        ...localSlugs,
      ],
      strategy: 'direct',
    };
  }
  if (params.require_privacy) {
    request.metadata.providerPreferences = {
      ...(request.metadata.providerPreferences || {}),
      zdr: true,
      only: [
        ...(request.metadata.providerPreferences?.only || []),
        ...(request.metadata.providerPreferences?.order || []),
      ].filter((slug: string) => ['ollama', 'local', 'openai'].includes(slug)),
      strategy: 'direct',
    };
  }
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

    case 'video':
      request.prompt = params.prompt as string;
      request.image = params.image as string | undefined;
      request.duration = params.duration as number | undefined;
      request.fps = params.fps as number | undefined;
      request.aspect_ratio = params.aspect_ratio as string | undefined;
      break;

    case 'music':
      request.prompt = params.prompt as string;
      request.genre = params.genre as string | undefined;
      request.duration_seconds = params.duration_seconds as number | undefined;
      request.instruments = params.instruments as string[] | undefined;
      break;

    case '3d':
      request.prompt = params.prompt as string | undefined;
      request.image = params.image as string | undefined;
      request.texture_resolution = params.texture_resolution as number | undefined;
      request.diffusion_seed = params.seed as number | undefined;
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

function formatVideoResponse(response: UnifiedResponse): string {
  const result: Record<string, unknown> = {
    created: Math.floor(Date.now() / 1000),
    provider: response.providerId,
    model: response.modelId,
    data: response.videos?.map((v) => ({
      url: v.url,
      b64_json: v.b64_json,
      duration: v.duration,
      fps: v.fps,
    })) || [],
  };

  return JSON.stringify(result, null, 2);
}

function formatMusicResponse(response: UnifiedResponse): string {
  const result: Record<string, unknown> = {
    created: Math.floor(Date.now() / 1000),
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

function format3DResponse(response: UnifiedResponse): string {
  const result: Record<string, unknown> = {
    created: Math.floor(Date.now() / 1000),
    provider: response.providerId,
    model: response.modelId,
    data: response.models3d?.map((v) => ({
      url: v.url,
      b64_json: v.b64_json,
      format: v.format,
    })) || [],
  };

  return JSON.stringify(result, null, 2);
}

function formatRoutingInfo(response: UnifiedResponse): string {
  return `\n\n---\nRouted via: ${response.providerId} / ${response.modelId} (${response.latencyMs}ms)`;
}

/**
 * Register every tool from every connected external MCP server into the
 * given McpServer, namespaced as `<serverId>__<toolName>`.
 *
 * Example: a tool named `create_issue` on server `github` becomes
 * `github__create_issue` in the aggregated tool list.
 */
function registerExternalTools(server: McpServer, client: MCPClient, state: ServerState): void {
  const registry = client.getRegistry();
  const allServers = registry.listAll();

  for (const connected of allServers) {
    const serverId = connected.config.id;
    for (const tool of connected.tools) {
      const namespacedName = `${serverId}__${tool.name}`;
      const description = `[Proxied via MCP server '${serverId}'] ${tool.description ?? tool.name}`;

      // Use a passthrough Zod schema for args; the underlying MCP server
      // validates the actual input shape via its own JSON Schema.
      const passthroughSchema = {
        args: z.record(z.unknown()).optional().describe(
          `Tool arguments (passed through to ${serverId}/${tool.name}; see upstream inputSchema for shape)`
        ),
      };

      server.tool(
        namespacedName,
        description,
        passthroughSchema as any,
        async (params: any) => {
          state.requestCount++;
          const args = (params?.args ?? {}) as Record<string, unknown>;
          try {
            // Use the registry's 3-arg form so we route to a specific
            // serverId, not by tool-name lookup (which can be ambiguous
            // when multiple external servers host a same-named tool).
            const result = await registry.callTool(serverId, tool.name, args);
            const text = typeof result === 'string'
              ? result
              : JSON.stringify(result, null, 2);
            return {
              content: [{ type: 'text' as const, text }],
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

      state.externalToolCount++;
      state.sdkTools.push({
        name: namespacedName,
        description,
        params: passthroughSchema,
      });
    }
  }
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
        logger.warn({ err: initErr, providerId }, 'Failed to initialize adapter');
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
    externalMcpClient: config.externalMcpClient,
    externalToolCount: 0,
  };

  // SDK tool definitions for programmatic access and discovery
  const sdkToolDefs: Array<{ name: string; description: string; params: unknown }> = [
    { name: TOOL_NAMES.CHAT, description: TOOL_DESCRIPTIONS[TOOL_NAMES.CHAT], params: chatParams },
    { name: TOOL_NAMES.GENERATE_IMAGE, description: TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_IMAGE], params: imageParams },
    { name: TOOL_NAMES.GENERATE_VIDEO, description: TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_VIDEO], params: videoParams },
    { name: TOOL_NAMES.GENERATE_MUSIC, description: TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_MUSIC], params: musicParams },
    { name: TOOL_NAMES.EMBED, description: TOOL_DESCRIPTIONS[TOOL_NAMES.EMBED], params: embedParams },
    { name: TOOL_NAMES.TRANSCRIBE, description: TOOL_DESCRIPTIONS[TOOL_NAMES.TRANSCRIBE], params: transcribeParams },
    { name: TOOL_NAMES.SPEAK, description: TOOL_DESCRIPTIONS[TOOL_NAMES.SPEAK], params: speakParams },
    { name: TOOL_NAMES.RERANK, description: TOOL_DESCRIPTIONS[TOOL_NAMES.RERANK], params: rerankParams },
    { name: TOOL_NAMES.MODELS, description: TOOL_DESCRIPTIONS[TOOL_NAMES.MODELS], params: modelsParams },
    { name: TOOL_NAMES.STATUS, description: TOOL_DESCRIPTIONS[TOOL_NAMES.STATUS], params: statusParams },
    { name: TOOL_NAMES.BATCH, description: TOOL_DESCRIPTIONS[TOOL_NAMES.BATCH], params: batchParams },
    { name: TOOL_NAMES.CONTEXT_SAVE, description: TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_SAVE], params: contextSaveParams },
    { name: TOOL_NAMES.CONTEXT_LOAD, description: TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_LOAD], params: contextLoadParams },
    { name: TOOL_NAMES.CONTEXT_LIST, description: TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_LIST], params: contextListParams },
    { name: TOOL_NAMES.CONTEXT_SUMMARIZE, description: TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_SUMMARIZE], params: contextSummarizeParams },
    { name: TOOL_NAMES.CONTEXT_COMPRESS, description: TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_COMPRESS], params: contextCompressParams },
    { name: TOOL_NAMES.CHAT_STREAM, description: TOOL_DESCRIPTIONS[TOOL_NAMES.CHAT_STREAM], params: chatStreamParams },
    { name: TOOL_NAMES.GENERATE_IMAGE_STREAM, description: TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_IMAGE_STREAM], params: imageStreamParams },
    { name: TOOL_NAMES.GENERATE_VIDEO_STREAM, description: TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_VIDEO_STREAM], params: videoStreamParams },
    { name: TOOL_NAMES.WORKFLOW, description: TOOL_DESCRIPTIONS[TOOL_NAMES.WORKFLOW], params: workflowParams },
    { name: TOOL_NAMES.GENERATE_3D, description: TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_3D], params: threeDParams },
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
  // Tool: dmrx_generate_video
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.GENERATE_VIDEO,
    TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_VIDEO],
    videoParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const request = toUnifiedRequest('video', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['video'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatVideoResponse(response);

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
  // Tool: dmrx_generate_video_stream
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.GENERATE_VIDEO_STREAM,
    TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_VIDEO_STREAM],
    videoStreamParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const request = toUnifiedRequest('video', params as unknown as Record<string, unknown>);
        request.stream = true;
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['video'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const adapter = state.adapterRegistry.get('runway') || state.adapterRegistry.get('replicate') || state.adapterRegistry.get('comfyui');
        if (!adapter || !adapter.executeStream) {
          throw new Error('Streaming video generation not supported by current adapter configuration');
        }

        const stream = adapter.executeStream(request);
        const updates: string[] = [];
        for await (const chunk of stream) {
          updates.push(JSON.stringify(chunk));
        }

        const response: UnifiedResponse = {
          modality: 'video',
          requestId: crypto.randomUUID(),
          providerId: 'streaming',
          modelId: request.model || 'streaming-video',
          videos: [],
          latencyMs: 0,
        };

        const formatted = formatVideoResponse(response);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ updates, final: JSON.parse(formatted) }, null, 2),
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
  // Tool: dmrx_generate_music
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.GENERATE_MUSIC,
    TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_MUSIC],
    musicParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const request = toUnifiedRequest('music', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['music'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatMusicResponse(response);

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
  // Tool: dmrx_generate_3d
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.GENERATE_3D,
    TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_3D],
    threeDParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const request = toUnifiedRequest('3d', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['3d'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = format3DResponse(response);

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
                logger.warn({ err: listErr }, 'Failed to list models from adapter');
              }
            }
          }

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ source: 'adapters', count: adapterModels.length, models: adapterModels }, null, 2),
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
          costPerVideo: m.costPerVideo,
          costPerSecond: m.costPerSecond,
          maxDuration: m.maxDuration,
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

        // Aggregator status (always included; zeros when aggregator is off)
        status.aggregator = {
          enabled: !!state.externalMcpClient,
          externalServerCount: state.externalMcpClient
            ? state.externalMcpClient.listServers().length
            : 0,
          externalToolCount: state.externalToolCount,
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

  // -----------------------------------------------------------------------
  // Tool: dmrx_batch
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.BATCH,
    TOOL_DESCRIPTIONS[TOOL_NAMES.BATCH],
    batchParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const calls = (params.calls || []) as Array<{ tool: string; parameters: Record<string, unknown> }>;
        const continueOnFail = params.continue_on_fail !== false;
        const results: Array<{ tool: string; success: boolean; output?: unknown; error?: string }> = [];

        for (const call of calls) {
          try {
            const output = await executeDMRXTool(state.router, state.adapterRegistry, call.tool, call.parameters || {});
            results.push({ tool: call.tool, success: true, output });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            results.push({ tool: call.tool, success: false, error: message });
            if (!continueOnFail) {
              throw err;
            }
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, results }, null, 2),
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
  // Tool: dmrx_context_save
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.CONTEXT_SAVE,
    TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_SAVE],
    contextSaveParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const id = params.id || `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const context = {
          id,
          messages: params.messages || [],
          user: params.user || 'anonymous',
          ttl_seconds: params.ttl_seconds || 86400,
          created_at: new Date().toISOString(),
        };

        const cacheKey = `context:${id}`;
        const cacheStore = getContextStore();
        cacheStore.set(cacheKey, JSON.stringify(context), params.ttl_seconds || 86400);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, context_id: id, message: 'Context saved' }, null, 2),
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
  // Tool: dmrx_context_load
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.CONTEXT_LOAD,
    TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_LOAD],
    contextLoadParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const cacheStore = getContextStore();
        const cached = cacheStore.get(`context:${params.id}`);
        if (!cached) {
          throw new Error(`Context not found: ${params.id}`);
        }

        const context = JSON.parse(cached as string);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, context }, null, 2),
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
  // Tool: dmrx_context_list
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.CONTEXT_LIST,
    TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_LIST],
    contextListParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const limit = params.limit || 20;
        const cacheStore = getContextStore();
        const keys = cacheStore.keys(`context:*`);

        const contexts: Array<{ id: string; user: string; created_at: string; preview: string }> = [];
        for (const key of keys) {
          const cached = cacheStore.get(key);
          if (cached) {
            const ctx = JSON.parse(cached as string);
            if (!params.user || ctx.user === params.user) {
              contexts.push({
                id: ctx.id,
                user: ctx.user,
                created_at: ctx.created_at,
                preview: (ctx.messages || []).slice(-1)[0]?.content?.slice(0, 50) || '',
              });
            }
          }
        }

        contexts.sort((a, b) => b.created_at.localeCompare(a.created_at));
        const sliced = contexts.slice(0, limit);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, count: sliced.length, contexts: sliced }, null, 2),
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
  // Tool: dmrx_context_summarize
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.CONTEXT_SUMMARIZE,
    TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_SUMMARIZE],
    contextSummarizeParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const cacheStore = getContextStore();
        const cached = cacheStore.get(`context:${params.id}`);
        if (!cached) {
          throw new Error(`Context not found: ${params.id}`);
        }

        const context = JSON.parse(cached as string);
        const messages = context.messages || [];

        let summary = `Context (${messages.length} messages):\n`;
        for (const msg of messages.slice(-10)) {
          summary += `- ${msg.role}: ${(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)).slice(0, 100)}\n`;
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, context_id: params.id, summary }, null, 2),
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
  // Tool: dmrx_context_compress
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.CONTEXT_COMPRESS,
    TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_COMPRESS],
    contextCompressParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const cacheStore = getContextStore();
        const cached = cacheStore.get(`context:${params.id}`);
        if (!cached) {
          throw new Error(`Context not found: ${params.id}`);
        }

        const context = JSON.parse(cached as string);
        let messages = context.messages || [];
        const targetTokens = params.target_tokens || 500;
        const maxMessages = Math.max(1, Math.floor(targetTokens / 50));

        if (messages.length > maxMessages) {
          const keepRecent = messages.slice(-Math.ceil(maxMessages / 2));
          const keepOlder = messages.slice(0, Math.floor(maxMessages / 2)).filter((m: any) => m.role === 'system' || m.role === 'user');
          messages = [...keepOlder, ...keepRecent];
        }

        const compressed = { ...context, messages, compressed_at: new Date().toISOString() };
        cacheStore.set(`context:${params.id}`, JSON.stringify(compressed), context.ttl_seconds || 86400);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, context_id: params.id, messages_kept: messages.length }, null, 2),
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
  // Tool: dmrx_chat_stream
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.CHAT_STREAM,
    TOOL_DESCRIPTIONS[TOOL_NAMES.CHAT_STREAM],
    chatStreamParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const request = toUnifiedRequest('llm', params as unknown as Record<string, unknown>);
        request.stream = true;
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['llm'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const adapter = state.adapterRegistry.get('openai');
        if (!adapter || !adapter.executeStream) {
          throw new Error('Streaming not supported by current adapter configuration');
        }

        const stream = adapter.executeStream(request);
        const chunks: string[] = [];
        for await (const chunk of stream) {
          if (chunk.type === 'token') {
            const tokenChunk = chunk as { data: { content?: string } };
            chunks.push(tokenChunk.data?.content || '');
          }
        }

        const fullText = chunks.join('');
        const response: UnifiedResponse = {
          modality: 'llm',
          requestId: crypto.randomUUID(),
          providerId: request.model || 'openai',
          modelId: request.model || 'gpt-4',
          message: { role: 'assistant', content: fullText },
          latencyMs: 0,
        };

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
  // Tool: dmrx_generate_image_stream
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.GENERATE_IMAGE_STREAM,
    TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_IMAGE_STREAM],
    imageStreamParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const request = toUnifiedRequest('diffusion', params as unknown as Record<string, unknown>);
        request.stream = true;
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['diffusion'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const adapter = state.adapterRegistry.get('stability') || state.adapterRegistry.get('replicate');
        if (!adapter || !adapter.executeStream) {
          throw new Error('Streaming image generation not supported by current adapter configuration');
        }

        const stream = adapter.executeStream(request);
        const updates: string[] = [];
        for await (const chunk of stream) {
          updates.push(JSON.stringify(chunk));
        }

        const response: UnifiedResponse = {
          modality: 'diffusion',
          requestId: crypto.randomUUID(),
          providerId: 'streaming',
          modelId: request.model || 'streaming-diffusion',
          images: [],
          latencyMs: 0,
        };

        const formatted = formatImageResponse(response);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ updates, final: JSON.parse(formatted) }, null, 2),
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
  // Tool: dmrx_workflow
  // -----------------------------------------------------------------------
  server.tool(
    TOOL_NAMES.WORKFLOW,
    TOOL_DESCRIPTIONS[TOOL_NAMES.WORKFLOW],
    workflowParams as any,
    async (params: any) => {
      await initAdapters();
      state.requestCount++;

      try {
        const steps = params.steps || [];
        const failFast = params.fail_fast !== false;
        const results: Array<{ step_id: string; tool: string; success: boolean; output?: unknown; error?: string }> = [];
        const stepOutputs: Record<string, unknown> = {};

        for (const step of steps) {
          try {
            let stepParams = { ...(step.parameters || {}) };

            if (step.input_mapping) {
              const mapping = step.input_mapping as Record<string, string>;
              for (const [targetKey, sourceRef] of Object.entries(mapping)) {
                const sourceValue = extractFromOutputs(sourceRef, stepOutputs, results);
                if (sourceValue !== undefined) {
                  setNestedValue(stepParams, targetKey, sourceValue);
                }
              }
            }

            const output = await executeDMRXTool(state.router, state.adapterRegistry, step.tool, stepParams);
            results.push({ step_id: step.id, tool: step.tool, success: true, output });
            stepOutputs[step.id] = output;
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            results.push({ step_id: step.id, tool: step.tool, success: false, error: message });
            if (failFast) {
              throw err;
            }
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, results, step_outputs: stepOutputs }, null, 2),
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

  // Register external MCP aggregator tools (if a client was provided)
  if (config.externalMcpClient) {
    try {
      registerExternalTools(server, config.externalMcpClient, state);
      logger.info(
        { externalToolCount: state.externalToolCount },
        'External MCP aggregator tools registered'
      );
    } catch (error) {
      logger.error({ err: error }, 'Failed to register external MCP aggregator tools');
    }
  }

  return { server, state };
}

// -----------------------------------------------------------------------
// Internal helpers for new tools
// -----------------------------------------------------------------------

function getContextStore(): { get(key: string): string | null; set(key: string, value: string, ttl: number): void; keys(prefix: string): string[]; delete(key: string): void } {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    set(key: string, value: string, ttl: number) {
      store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
    },
    keys(prefix: string) {
      const result: string[] = [];
      for (const [key] of store) {
        if (key.startsWith(prefix)) result.push(key);
      }
      return result;
    },
    delete(key: string) {
      store.delete(key);
    },
  };
}

function extractFromOutputs(ref: string, outputs: Record<string, unknown>, results: Array<{ step_id: string; output?: unknown }>): unknown {
  if (ref.startsWith('$')) {
    const stepId = ref.slice(1);
    return outputs[stepId];
  }
  if (ref.startsWith('steps.')) {
    const stepId = ref.slice(6);
    for (const r of results) {
      if (r.step_id === stepId && r.output) return r.output;
    }
  }
  return undefined;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

async function executeDMRXTool(
  router: Router,
  _adapterRegistry: AdapterRegistry,
  toolName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  let modality: Modality = 'llm';
  let path = '/v1/chat/completions';
  switch (toolName) {
    case TOOL_NAMES.CHAT:
      modality = 'llm';
      path = '/v1/chat/completions';
      break;
    case TOOL_NAMES.GENERATE_IMAGE:
      modality = 'diffusion';
      path = '/v1/images/generations';
      break;
    case TOOL_NAMES.EMBED:
      modality = 'embedding';
      path = '/v1/embeddings';
      break;
    case TOOL_NAMES.TRANSCRIBE:
      modality = 'audio_stt';
      path = '/v1/audio/transcriptions';
      break;
    case TOOL_NAMES.SPEAK:
      modality = 'audio_tts';
      path = '/v1/audio/speech';
      break;
    case TOOL_NAMES.RERANK:
      modality = 'reranking';
      path = '/v1/rerank';
      break;
    case TOOL_NAMES.GENERATE_VIDEO:
      modality = 'video';
      path = '/v1/video/generations';
      break;
    case TOOL_NAMES.GENERATE_MUSIC:
      modality = 'music';
      path = '/v1/music/generations';
      break;
    case TOOL_NAMES.GENERATE_3D:
      modality = '3d';
      path = '/v1/3d/generate';
      break;
    default:
      throw new Error(`Unsupported tool in batch: ${toolName}`);
  }

  const request = toUnifiedRequest(modality, params);
  const classifyOptions: ClassifyOptions = {
    path,
    qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
  };

  const { response } = await router.route(request, classifyOptions);

  switch (modality) {
    case 'llm':
      return JSON.parse(formatChatResponse(response));
    case 'diffusion':
      return JSON.parse(formatImageResponse(response));
    case 'embedding':
      return JSON.parse(formatEmbeddingResponse(response));
    case 'audio_stt':
      return JSON.parse(formatTranscribeResponse(response));
    case 'audio_tts':
      return JSON.parse(formatSpeakResponse(response));
    case 'reranking':
      return JSON.parse(formatRerankResponse(response));
    case 'video':
      return JSON.parse(formatVideoResponse(response));
    case 'music':
      return JSON.parse(formatMusicResponse(response));
    case '3d':
      return JSON.parse(format3DResponse(response));
    default:
      return { response };
  }
}
