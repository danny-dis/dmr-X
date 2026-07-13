/**
 * DMR-X MCP Server
 *
 * Exposes DMR-X routing capabilities as MCP tools.
 * Transport-agnostic: works with stdio, SSE, and Streamable HTTP transports.
 */
import { AdapterRegistry, OpenAIAdapter, AnthropicAdapter, OllamaAdapter, PollinationsImageAdapter } from '@dmr-x/adapters';
import { initializeAdapters } from './adapter-init.js';
import { ReplicateAdapter, StabilityAdapter } from '@dmr-x/adapters';
import { ElevenLabsAdapter, DeepgramAdapter } from '@dmr-x/adapters';
import { CohereAdapter, JinaAdapter, ComfyUIAdapter } from '@dmr-x/adapters';
import { FalAdapter, VeoAdapter, RunwayAdapter } from '@dmr-x/adapters';
import type {
  UnifiedRequest,
  UnifiedResponse,
  CandidateSet,
  Modality,
  QualityTarget,
  ProviderModel,
} from '@dmr-x/core';
import { resolveProviderSlug } from '@dmr-x/core';
import { MCPClient } from '@dmr-x/mcp-client';
import { Router, type RouterConfig, type ClassifyOptions } from '@dmr-x/router';
import { HybridSearchEngine, type ToolDocument } from '@dmr-x/tool-search';
import { getRBACEngine, type RBACConfig, type Principal } from '@dmr-x/policy';
import { InputValidator, type InputValidatorConfig } from './guardrails/input-validator.js';
import { GuardrailsEngine } from './guardrails/filter-engine.js';
import { ToolInvocationPolicyEngine, getToolInvocationPolicyEngine } from './policies/tool-invocation-policy.js';
import { ToolTemplatesService, getToolTemplatesService } from './templates/tool-templates.js';
import type { AgentCardConfig } from './a2a/agent-card.js';
import type { FederationConfig } from './federation/manager.js';
import { logger } from '@dmr-x/utils';
import { persistentContextStore, initDb, getDb } from '@dmr-x/db';

// Ensure the shared DB is initialized in this module's @dmr-x/db instance.
// (The entry point also calls initDb, but under bun the entry and this module
// can resolve @dmr-x/db to separate instances, so we initialize defensively.)
void initDb().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[mcp-server] DB init (deferred) failed:', err);
});
import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { TOOL_ANNOTATIONS, type ToolAnnotations } from './annotations.js';
import {
  resolveGatewayKey,
  autoProvisionTenantKey,
  setLastRequestHeaders,
} from './tenant-key.js';
import { registerPrompts } from './prompts.js';
import { RateLimiter } from './rate-limiter.js';
import { registerResources } from './resources.js';
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
  dmrxToolSearchParams as toolSearchParams,
  dmrxToolListParams as toolListParams,
  dmrxTemplateListParams as templateListParams,
  dmrxTemplateGetParams as templateGetParams,
  dmrxTemplateCreateParams as templateCreateParams,
  dmrxTemplateUpdateParams as templateUpdateParams,
  dmrxTemplateDeleteParams as templateDeleteParams,
  dmrxTemplateExecuteParams as templateExecuteParams,
  dmrxPresetListParams as presetListParams,
  dmrxPresetGetParams as presetGetParams,
  dmrxPresetCreateParams as presetCreateParams,
  dmrxPresetUpdateParams as presetUpdateParams,
  dmrxPresetDeleteParams as presetDeleteParams,
  dmrxChatOutput,
  dmrxImageOutput,
  dmrxEmbeddingOutput,
  dmrxTranscribeOutput,
  dmrxSpeakOutput,
  dmrxRerankOutput,
  dmrxVideoOutput,
  dmrxMusicOutput,
  dmrx3DOutput,
  dmrxModelsOutput,
  dmrxStatusOutput,
  dmrxBatchOutput,
  dmrxContextSaveOutput,
  dmrxContextLoadOutput,
  dmrxContextListOutput,
  dmrxContextSummarizeOutput,
  dmrxContextCompressOutput,
  dmrxWorkflowOutput,
  dmrxToolSearchOutput,
  dmrxToolListOutput,
  dmrxReadFileInput as readFileParams,
  dmrxWriteFileInput as writeFileParams,
  dmrxEditFileInput as editFileParams,
  dmrxListFilesInput as listFilesParams,
  dmrxBashInput as bashParams,
  dmrxSearchFilesInput as searchFilesParams,
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
  /** Allowed tools filter (supports glob patterns like 'dmrx_*', 'github__*', or exact names) */
  allowedTools?: string[];
  /** Tool search configuration */
  toolSearch?: {
    bm25Weight?: number;
    semanticWeight?: number;
    rrfConstant?: number;
    maxResults?: number;
    minScore?: number;
    enableBM25?: boolean;
    enableSemantic?: boolean;
    embeddingConfig?: {
      provider: 'ollama' | 'openai' | 'remote';
      ollamaUrl?: string;
      ollamaModel?: string;
      openaiApiKey?: string;
      openaiModel?: string;
      remoteUrl?: string;
      remoteApiKey?: string;
    };
  };
  /** RBAC policy configuration */
  rbac?: RBACConfig;
  /** Guardrails configuration */
  guardrails?: {
    enabled?: boolean;
    piiRedaction?: boolean;
    contentFiltering?: boolean;
    blockedKeywords?: string[];
    logDetections?: boolean;
    /** Input validation configuration */
    inputValidation?: InputValidatorConfig;
  };
  /** Audit logging configuration */
  audit?: {
    enabled?: boolean;
    retentionDays?: number;
    includeBodies?: boolean;
  };
  /** A2A (Agent-to-Agent) protocol configuration */
  a2a?: {
    enabled?: boolean;
    agentCard?: AgentCardConfig;
  };
  /** Federation configuration for multi-instance tool sharing */
  federation?: FederationConfig;
  /** DMR-X gateway URL used to expose defined subagents as MCP tools */
  gatewayUrl?: string;
  /** API key used to list/run DMR-X subagents from the gateway */
  agentApiKey?: string;
}

export interface ServerState {
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
  /** Per-tool rate limiter */
  rateLimiter: RateLimiter;
  /** Hybrid search engine for intelligent tool discovery */
  searchEngine: HybridSearchEngine;
  /** RBAC policy engine */
  rbacEnabled: boolean;
  /** Guardrails enabled */
  guardrailsEnabled: boolean;
  /** Input validator for injection detection */
  inputValidator: InputValidator;
  /** Guardrails engine for output PII redaction */
  guardrailsEngine: GuardrailsEngine;
  /** Tool invocation policy engine */
  policyEngine: ToolInvocationPolicyEngine;
  /** Tool templates and presets service */
  templatesService: ToolTemplatesService;
  /** Audit logging enabled */
  auditEnabled: boolean;
  /** Tracks RegisteredTool references from the McpServer for each external server (for live add/remove) */
  externalToolRegistrations: Map<string, RegisteredTool[]>;
}

// ---------------------------------------------------------------------------
// MCP Logging helper
// ---------------------------------------------------------------------------

type LoggingLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

/**
 * Sends a logging message to the connected MCP client.
 * Errors are silently swallowed since logging is best-effort.
 */
function mcpLog(server: McpServer, level: LoggingLevel, data: unknown, loggerName?: string): void {
  server.server.sendLoggingMessage({ level, logger: loggerName ?? 'dmr-x', data }).catch(() => {
    // Logging is best-effort — swallow transport errors
  });
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
  audio_separation: '/v1/audio/separate',
  audio_intelligence: '/v1/audio/diarize',
  video: '/v1/video/generations',
  video_analysis: '/v1/video/analyze',
  music: '/v1/music/generations',
  reranking: '/v1/rerank',
  moderation: '/v1/moderations',
  code_completion: '/v1/completions',
  ocr: '/v1/ocr',
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
  registry.register(new PollinationsImageAdapter());
  // Provider adapters (keyed by provider UUID) are registered + initialized on
  // first use via initializeAdapters() inside initAdapters().
  return registry;
}

/**
 * Checks rate limit for a tool. Returns an MCP error response if rate-limited,
 * or null if the call is allowed.
 */
function checkRateLimit(
  state: ServerState,
  toolName: string,
  requestId?: string
): { content: Array<{ type: 'text'; text: string }>; isError: true } | null {
  const rateLimitError = state.rateLimiter.check(toolName);
  if (!rateLimitError) return null;
  state.lastError = rateLimitError;
  const errorPayload = {
    code: 'RATE_LIMITED',
    message: rateLimitError,
    requestId,
    timestamp: new Date().toISOString(),
  };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: errorPayload }, null, 2) }],
    isError: true as const,
  };
}

/**
 * Creates a structured error response for tool execution failures.
 * Includes error code, message, suggestion, and correlation ID.
 */
function toolError(
  message: string,
  code: string = 'TOOL_ERROR',
  requestId?: string,
  suggestion?: string
): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const errorPayload: Record<string, unknown> = {
    code,
    message,
    requestId,
    timestamp: new Date().toISOString(),
  };
  if (suggestion) errorPayload.suggestion = suggestion;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: errorPayload }, null, 2) }],
    isError: true as const,
  };
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

function formatRoutingInfo(response: UnifiedResponse, requestId?: string): string {
  const parts = [
    `\n\n---`,
    `Routed via: ${response.providerId} / ${response.modelId} (${response.latencyMs}ms)`,
  ];
  if (requestId) parts.push(`Request ID: ${requestId}`);
  return parts.join('\n');
}

/**
 * Maximum size for external tool arguments (1MB)
 */
const MAX_EXTERNAL_ARGS_SIZE = 1_000_000;

/**
 * Factory that creates an MCP tool handler for proxying calls to an external
 * MCP server tool. Used by both initial registration and live add/remove.
 */
function createExternalToolProxyHandler(
  state: ServerState,
  serverId: string,
  toolName: string
) {
  return async (params: any) => {
    const namespacedName = `${serverId}__${toolName}`;
    state.requestCount++;
    const rateLimitResponse = checkRateLimit(state, namespacedName);
    if (rateLimitResponse) return rateLimitResponse;

    const args = (params?.args ?? {}) as Record<string, unknown>;

    // Validate args size
    const argsSize = JSON.stringify(args).length;
    if (argsSize > MAX_EXTERNAL_ARGS_SIZE) {
      state.lastError = `External tool arguments too large: ${argsSize} bytes (max: ${MAX_EXTERNAL_ARGS_SIZE})`;
      return toolError(
        state.lastError,
        'INPUT_TOO_LARGE',
        `external-${serverId}-${toolName}`
      );
    }

    // Run input validation for injection detection
    if (state.guardrailsEnabled) {
      const validationResult = state.inputValidator.validateInput(JSON.stringify(args));
      if (!validationResult.valid) {
        logAuditEvent(state, 'input_validation.deny', namespacedName, {
          requestId: `external-${serverId}-${toolName}`,
          reason: validationResult.blockReason,
          detections: validationResult.detections.map(d => d.patternName),
          serverId,
          upstreamTool: toolName,
        });
        return toolError(
          validationResult.blockReason || 'Input validation failed',
          'INPUT_VALIDATION_FAILED',
          `external-${serverId}-${toolName}`
        );
      }
    }

    try {
      const registry = state.externalMcpClient!.getRegistry();
      const result = await registry.callTool(serverId, toolName, args);
      const text = typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2);
      return {
        content: [{ type: 'text' as const, text }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      state.lastError = message;

      const errorDetail: Record<string, unknown> = { message };
      if (error && typeof error === 'object') {
        const errObj = error as Record<string, unknown>;
        if (errObj.code) errorDetail.code = errObj.code;
        if (errObj.data) errorDetail.data = errObj.data;
      }
      errorDetail.server = serverId;
      errorDetail.tool = toolName;

      logAuditEvent(state, 'tool.error', namespacedName, {
        requestId: `external-${serverId}-${toolName}`,
        error: message,
        serverId,
        upstreamTool: toolName,
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: errorDetail }, null, 2) }],
        isError: true as const,
      };
    }
  };
}

/**
 * Compute live external tool count from the registration map.
 */
function computeExternalToolCount(state: ServerState): number {
  let count = 0;
  for (const tools of state.externalToolRegistrations.values()) {
    count += tools.length;
  }
  return count;
}

/**
 * Register tools for a single external server on the McpServer instance.
 * Captures the RegisteredTool references for later live removal.
 */
function registerServerToolsOnMcpServer(
  server: McpServer,
  state: ServerState,
  serverId: string,
  allowedTools?: string[]
): void {
  const registry = state.externalMcpClient?.getRegistry();
  if (!registry) return;

  const connected = registry.get(serverId);
  if (!connected) return;

  const registrations: RegisteredTool[] = [];

  for (const tool of connected.tools) {
    const namespacedName = `${serverId}__${tool.name}`;
    if (!isToolAllowed(namespacedName, allowedTools)) continue;

    const description = `[Proxied via MCP server '${serverId}'] ${tool.description ?? tool.name}`;

    const passthroughSchema = {
      args: z.record(z.unknown()).optional().describe(
        `Tool arguments (passed through to ${serverId}/${tool.name}; see upstream inputSchema for shape)`
      ),
    };

    const registered = server.tool(
      namespacedName,
      description,
      passthroughSchema as any,
      createExternalToolProxyHandler(state, serverId, tool.name)
    );

    registrations.push(registered as RegisteredTool);

    state.sdkTools.push({
      name: namespacedName,
      description,
      params: passthroughSchema,
    });
  }

  state.externalToolRegistrations.set(serverId, registrations);
  state.externalToolCount = computeExternalToolCount(state);
}

/**
 * Remove all registered tools for a single external server from the McpServer.
 */
function unregisterServerToolsFromMcpServer(
  _server: McpServer,
  state: ServerState,
  serverId: string
): void {
  const registrations = state.externalToolRegistrations.get(serverId);
  if (registrations) {
    for (const reg of registrations) {
      reg.remove();
    }
    state.externalToolRegistrations.delete(serverId);
  }

  // Remove from sdkTools
  state.sdkTools = state.sdkTools.filter(t => !t.name.startsWith(`${serverId}__`));

  // Update count
  state.externalToolCount = computeExternalToolCount(state);
}

/**
 * Reconcile external server tools against the current registry state:
 * - Adds tools for newly connected servers
 * - Removes tools for servers that have been disconnected
 * - Notifies MCP clients of tool list changes
 */
export function reconcileExternalTools(
  server: McpServer,
  state: ServerState,
  allowedTools?: string[]
): void {
  const connectedServerIds = state.externalMcpClient?.listServers() ?? [];
  const registeredServerIds = Array.from(state.externalToolRegistrations.keys());

  // Remove tools for servers no longer connected
  for (const serverId of registeredServerIds) {
    if (!connectedServerIds.includes(serverId)) {
      unregisterServerToolsFromMcpServer(server, state, serverId);
    }
  }

  // Add tools for newly connected servers
  for (const serverId of connectedServerIds) {
    if (!state.externalToolRegistrations.has(serverId)) {
      registerServerToolsOnMcpServer(server, state, serverId, allowedTools);
    }
  }

  // Notify MCP clients of tool list changes (only if connected)
  server.sendToolListChanged();
}

/**
 * Register every tool from every connected external MCP server into the
 * given McpServer, namespaced as `<serverId>__<toolName>`.
 *
 * Example: a tool named `create_issue` on server `github` becomes
 * `github__create_issue` in the aggregated tool list.
 *
 * This is called at startup. For live updates, use reconcileExternalTools().
 */
function registerExternalTools(server: McpServer, client: MCPClient, state: ServerState, allowedTools?: string[]): void {
  const registry = client.getRegistry();
  const allServers = registry.listAll();

  for (const connected of allServers) {
    const serverId = connected.config.id;
    const registrations: RegisteredTool[] = [];

    for (const tool of connected.tools) {
      const namespacedName = `${serverId}__${tool.name}`;
      if (!isToolAllowed(namespacedName, allowedTools)) {
        continue;
      }
      const description = `[Proxied via MCP server '${serverId}'] ${tool.description ?? tool.name}`;

      const passthroughSchema = {
        args: z.record(z.unknown()).optional().describe(
          `Tool arguments (passed through to ${serverId}/${tool.name}; see upstream inputSchema for shape)`
        ),
      };

      const registered = server.tool(
        namespacedName,
        description,
        passthroughSchema as any,
        createExternalToolProxyHandler(state, serverId, tool.name)
      );

      registrations.push(registered as RegisteredTool);

      state.sdkTools.push({
        name: namespacedName,
        description,
        params: passthroughSchema,
      });
    }

    state.externalToolRegistrations.set(serverId, registrations);
  }

  state.externalToolCount = computeExternalToolCount(state);
}

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports: `*` (zero or more characters), `?` (exactly one character).
 * All other regex-special characters are escaped.
 */
function globToRegex(glob: string): RegExp {
  let regexStr = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      regexStr += '.*';
    } else if (ch === '?') {
      regexStr += '.';
    } else {
      // Escape regex-special characters
      regexStr += ch.replace(/[-[\]{}()+.\\^$|]/g, '\\$&');
    }
  }
  return new RegExp(`^${regexStr}$`);
}

/**
 * Helper to check if a tool is allowed based on configured pattern filters.
 * Supports exact match, wildcard `*` (zero or more characters), and
 * single-character wildcard `?`. Patterns are matched as full globs
 * (anchored at both ends).
 *
 * Examples: "dmrx_*", "github__create_*", "gitlab__?ssue_*", "*"
 */
export function isToolAllowed(toolName: string, allowedTools?: string[]): boolean {
  if (!allowedTools) return true; // Default: allow all
  return allowedTools.some((pattern) => {
    if (pattern === '*') return true;
    // Fast path: no wildcards — exact match
    if (!pattern.includes('*') && !pattern.includes('?')) {
      return toolName === pattern;
    }
    return globToRegex(pattern).test(toolName);
  });
}

// ---------------------------------------------------------------------------
// RBAC authorization helper
// ---------------------------------------------------------------------------

/**
 * Check if a principal is authorized to use a tool via RBAC.
 * Returns true if allowed, false if denied.
 */
function checkRBACAuthorization(
  state: ServerState,
  toolName: string,
  principal?: Principal
): boolean {
  if (!state.rbacEnabled) return true; // RBAC disabled, allow all
  
  if (!principal) {
    // No principal provided, use default effect
    const rbacEngine = getRBACEngine();
    const stats = rbacEngine.getStats();
    return stats.denies === 0; // If there are deny policies, require principal
  }

  const rbacEngine = getRBACEngine();
  const result = rbacEngine.authorize({
    principal,
    action: { type: 'tool', id: toolName },
    resource: { type: 'tool', id: toolName },
  });

  if (!result.allowed) {
    logger.warn({
      tool: toolName,
      principal: principal.id,
      reason: result.reason,
    }, 'RBAC authorization denied');
  }

  return result.allowed;
}

// ---------------------------------------------------------------------------
// Guardrails helper
// ---------------------------------------------------------------------------

/**
 * Process tool response through guardrails (PII redaction, content filtering).
 * Returns the sanitized text.
 */
function processGuardrails(
  state: ServerState,
  text: string
): string {
  if (!state.guardrailsEnabled) return text;

  // Use the GuardrailsEngine for PII detection and redaction
  const result = state.guardrailsEngine.process(text);
  return result.sanitized;
}

/**
 * Validate tool call input for injection attempts and length limits.
 * Returns an error response if validation fails, undefined if validation passes.
 */
function validateToolInput(
  state: ServerState,
  toolName: string,
  params: Record<string, unknown>,
  requestId: string
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } | undefined {
  if (!state.guardrailsEnabled) return undefined;

  const result = state.inputValidator.validateInput(JSON.stringify(params));
  if (!result.valid) {
    logAuditEvent(state, 'policy.deny', toolName, {
      requestId,
      reason: result.blockReason,
      detections: result.detections.map(d => d.patternName),
    });
    return toolError(result.blockReason || 'Input validation failed', 'INPUT_VALIDATION_FAILED', requestId);
  }

  return undefined;
}

/**
 * Evaluate tool call against invocation policies.
 * Returns an error response if the tool call is blocked, undefined if allowed.
 */
function evaluateToolPolicy(
  state: ServerState,
  toolName: string,
  params: Record<string, unknown>,
  requestId: string,
  tenantId: string = 'default'
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } | undefined {
  const result = state.policyEngine.evaluate({
    tenant_id: tenantId,
    tool_name: toolName,
    tool_input: params,
    request_id: requestId,
  });

  if (!result.allowed) {
    logAuditEvent(state, 'policy.deny', toolName, {
      requestId,
      reason: result.reason,
      policyId: result.policy?.id,
    });
    return toolError(result.reason || 'Tool call blocked by policy', 'POLICY_DENIED', requestId);
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Audit logging helper
// ---------------------------------------------------------------------------

/**
 * Log a tool invocation event for audit purposes.
 */
function logAuditEvent(
  state: ServerState,
  eventType: 'tool.invocation' | 'tool.result' | 'policy.allow' | 'policy.deny' | 'input_validation.deny' | 'tool.error',
  toolName: string,
  metadata?: Record<string, unknown>
): void {
  if (!state.auditEnabled) return;
  
  // Simple implementation - in production, use the full AuditLogger
  logger.info({
    eventType,
    tool: toolName,
    timestamp: new Date().toISOString(),
    ...metadata,
  }, 'Audit event');
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
    // Register + initialize provider adapters keyed by provider UUID from .env
    // (mirrors the gateway). Must run before any routed request resolves a
    // candidate's providerId to an adapter.
    try {
      await initializeAdapters(adapterRegistry);
    } catch (envInitErr) {
      logger.warn({ err: envInitErr }, 'Env-based adapter init failed (some providers unavailable)');
    }
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

  // Initialize search engine for tool discovery
  const searchEngine = new HybridSearchEngine(config.toolSearch);

  // Initialize RBAC engine
  if (config.rbac?.enabled) {
    const rbacEngine = getRBACEngine(config.rbac);
    logger.info('RBAC policy engine enabled');
  }

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
    rateLimiter: new RateLimiter(),
    searchEngine,
    rbacEnabled: config.rbac?.enabled ?? false,
    guardrailsEnabled: config.guardrails?.enabled ?? false,
    inputValidator: new InputValidator(config.guardrails?.inputValidation),
    guardrailsEngine: new GuardrailsEngine({
      enabled: config.guardrails?.enabled ?? false,
      piiRedaction: config.guardrails?.piiRedaction ?? true,
      contentFiltering: config.guardrails?.contentFiltering ?? true,
      blockedKeywords: config.guardrails?.blockedKeywords ?? [],
      logDetections: config.guardrails?.logDetections ?? true,
    }),
    policyEngine: getToolInvocationPolicyEngine(),
    templatesService: getToolTemplatesService(),
    auditEnabled: config.audit?.enabled ?? false,
    externalToolRegistrations: new Map(),
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
    if (isToolAllowed(def.name, config.allowedTools)) {
      state.sdkTools.push(def);
    }
  }

  // Wire up adapter executor for fallback
  router.setAdapterExecutor({
    async execute(providerId: string, modelId: string, request: UnifiedRequest) {
      // Resolve the provider UUID to its registered adapter. The router's
      // candidates carry provider UUIDs, but adapters are registered by their
      // adapter_type / catalog id (e.g. "cohere"). Mirror the gateway's
      // getAdapter: try the raw id, then fall back to providers.name.
      let adapter = adapterRegistry.get(providerId);
      if (!adapter) {
        try {
          const db = getDb();
          const row = db.prepare('SELECT name FROM providers WHERE id = ?').get(providerId) as
            | { name: string }
            | undefined;
          if (row) adapter = adapterRegistry.get(row.name);
        } catch {
          /* DB lookup best-effort */
        }
      }
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

  // Intercept tool registration to filter by allowed tools
  const originalRegisterTool = server.registerTool.bind(server);
  (server as any).registerTool = (name: string, spec: any, handler: any) => {
    if (isToolAllowed(name, config.allowedTools)) {
      return originalRegisterTool(name, spec, handler);
    }
    return undefined as any;
  };

  const originalTool = server.tool.bind(server);
  (server as any).tool = (name: string, description: any, schema?: any, handler?: any) => {
    if (isToolAllowed(name, config.allowedTools)) {
      return originalTool(name, description, schema, handler);
    }
    return undefined as any;
  };

  // Register MCP resources
  registerResources(server);

  // Register MCP prompts
  registerPrompts(server);

  // -----------------------------------------------------------------------
  // Tool: dmrx_chat
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.CHAT,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.CHAT],
      inputSchema: chatParams as any,
      outputSchema: dmrxChatOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.CHAT],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const requestId = crypto.randomUUID();
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.CHAT);
      if (rateLimitResponse) return rateLimitResponse;

      // RBAC authorization check
      if (!checkRBACAuthorization(state, TOOL_NAMES.CHAT, params._principal)) {
        logAuditEvent(state, 'policy.deny', TOOL_NAMES.CHAT, { requestId, principal: params._principal?.id });
        return toolError('Access denied by RBAC policy', 'RBAC_DENIED', requestId);
      }

      // Input validation
      const validationError = validateToolInput(state, TOOL_NAMES.CHAT, params, requestId);
      if (validationError) return validationError;

      // Tool invocation policy check
      const tenantId = params._tenant_id || 'default';
      const policyError = evaluateToolPolicy(state, TOOL_NAMES.CHAT, params, requestId, tenantId);
      if (policyError) return policyError;

      // Audit logging
      logAuditEvent(state, 'tool.invocation', TOOL_NAMES.CHAT, { requestId, params: { ...params, messages: '[omitted]' } });

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.CHAT, requestId }, 'routing');

        const request = toUnifiedRequest('llm', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['llm'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatChatResponse(response);

        // Apply guardrails to response
        const sanitized = processGuardrails(state, formatted);

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.CHAT,
          requestId,
          provider: response.providerId,
          model: response.modelId,
          latencyMs: response.latencyMs,
        }, 'routing');

        // Audit logging for successful result
        logAuditEvent(state, 'tool.result', TOOL_NAMES.CHAT, {
          requestId,
          provider: response.providerId,
          model: response.modelId,
          latencyMs: response.latencyMs,
        });

        const structured = JSON.parse(formatted);
        return {
          content: [{
            type: 'text' as const,
            text: sanitized + formatRoutingInfo(response, requestId),
          }],
          structuredContent: {
            ...structured,
            routed_via: `${response.providerId} / ${response.modelId}`,
            latency_ms: response.latencyMs,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;

        let code = 'ROUTING_ERROR';
        let suggestion: string | undefined;
        if (message.includes('unavailable') || message.includes('no candidates')) {
          code = 'PROVIDER_UNAVAILABLE';
          suggestion = 'Try a different quality target or provider preference';
        } else if (message.includes('timeout')) {
          code = 'TIMEOUT';
          suggestion = 'Increase latency_target or try a different provider';
        } else if (message.includes('rate limit')) {
          code = 'RATE_LIMITED';
          suggestion = 'Wait before retrying or use a different provider';
        }

        mcpLog(server, 'error', { tool: TOOL_NAMES.CHAT, requestId, code, message }, 'routing');
        logAuditEvent(state, 'tool.result', TOOL_NAMES.CHAT, { requestId, error: message, code });
        return toolError(message, code, requestId, suggestion);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_generate_image
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.GENERATE_IMAGE,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_IMAGE],
      inputSchema: imageParams as any,
      outputSchema: dmrxImageOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.GENERATE_IMAGE],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.GENERATE_IMAGE);
      if (rateLimitResponse) return rateLimitResponse;

      // Input validation
      const requestId = crypto.randomUUID();
      const validationError = validateToolInput(state, TOOL_NAMES.GENERATE_IMAGE, params, requestId);
      if (validationError) return validationError;

      // Tool invocation policy check
      const tenantId = params._tenant_id || 'default';
      const policyError = evaluateToolPolicy(state, TOOL_NAMES.GENERATE_IMAGE, params, requestId, tenantId);
      if (policyError) return policyError;

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.GENERATE_IMAGE }, 'routing');

        const request = toUnifiedRequest('diffusion', params as unknown as Record<string, unknown>);
        // Pin diffusion to the dedicated pollinations-image provider. The router
        // honors a `providerName/modelId` model prefix (scopes candidates to that
        // provider), and the generic 'pollinations' text adapter rejects the
        // diffusion modality — so without this pin it throws
        // "Unsupported modality: diffusion". The PollinationsImageAdapter
        // (providerName 'pollinations-images') handles diffusion + returns a URL.
        const imageModel = (params.model as string) || 'flux';
        request.model = `pollinations-images/${imageModel}`;
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['diffusion'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatImageResponse(response);

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.GENERATE_IMAGE,
          provider: response.providerId,
          model: response.modelId,
          latencyMs: response.latencyMs,
        }, 'routing');

        const structured = JSON.parse(formatted);
        return {
          content: [{
            type: 'text' as const,
            text: formatted + formatRoutingInfo(response),
          }],
          structuredContent: {
            ...structured,
            routed_via: `${response.providerId} / ${response.modelId}`,
            latency_ms: response.latencyMs,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.GENERATE_IMAGE, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.EMBED,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.EMBED],
      inputSchema: embedParams as any,
      outputSchema: dmrxEmbeddingOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.EMBED],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.EMBED);
      if (rateLimitResponse) return rateLimitResponse;

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.EMBED }, 'routing');

        const request = toUnifiedRequest('embedding', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['embedding'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatEmbeddingResponse(response);

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.EMBED,
          provider: response.providerId,
          model: response.modelId,
          latencyMs: response.latencyMs,
        }, 'routing');

        const structured = JSON.parse(formatted);
        return {
          content: [{
            type: 'text' as const,
            text: formatted + formatRoutingInfo(response),
          }],
          structuredContent: {
            ...structured,
            routed_via: `${response.providerId} / ${response.modelId}`,
            latency_ms: response.latencyMs,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.EMBED, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.TRANSCRIBE,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.TRANSCRIBE],
      inputSchema: transcribeParams as any,
      outputSchema: dmrxTranscribeOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.TRANSCRIBE],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.TRANSCRIBE);
      if (rateLimitResponse) return rateLimitResponse;

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.TRANSCRIBE }, 'routing');

        const request = toUnifiedRequest('audio_stt', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['audio_stt'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatTranscribeResponse(response);

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.TRANSCRIBE,
          provider: response.providerId,
          model: response.modelId,
          latencyMs: response.latencyMs,
        }, 'routing');

        const structured = JSON.parse(formatted);
        return {
          content: [{
            type: 'text' as const,
            text: formatted + formatRoutingInfo(response),
          }],
          structuredContent: {
            ...structured,
            routed_via: `${response.providerId} / ${response.modelId}`,
            latency_ms: response.latencyMs,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.TRANSCRIBE, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.SPEAK,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.SPEAK],
      inputSchema: speakParams as any,
      outputSchema: dmrxSpeakOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.SPEAK],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.SPEAK);
      if (rateLimitResponse) return rateLimitResponse;

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.SPEAK }, 'routing');

        const request = toUnifiedRequest('audio_tts', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['audio_tts'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatSpeakResponse(response);

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.SPEAK,
          provider: response.providerId,
          model: response.modelId,
          latencyMs: response.latencyMs,
        }, 'routing');

        const structured = JSON.parse(formatted);
        return {
          content: [{
            type: 'text' as const,
            text: formatted + formatRoutingInfo(response),
          }],
          structuredContent: {
            ...structured,
            routed_via: `${response.providerId} / ${response.modelId}`,
            latency_ms: response.latencyMs,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.SPEAK, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.RERANK,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.RERANK],
      inputSchema: rerankParams as any,
      outputSchema: dmrxRerankOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.RERANK],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.RERANK);
      if (rateLimitResponse) return rateLimitResponse;

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.RERANK }, 'routing');

        const request = toUnifiedRequest('reranking', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['reranking'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatRerankResponse(response);

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.RERANK,
          provider: response.providerId,
          model: response.modelId,
          latencyMs: response.latencyMs,
        }, 'routing');

        const structured = JSON.parse(formatted);
        // The Cohere rerank adapter doesn't always echo the document text back,
        // so fall back to the caller's input documents (indexed by result.index)
        // to satisfy the output schema's required `document` field.
        const inputDocs = (params.documents as string[] | undefined) || [];
        if (Array.isArray((structured as any).results)) {
          (structured as any).results = (structured as any).results.map((r: any) => ({
            ...r,
            document: r.document ?? inputDocs[r.index] ?? '',
          }));
        }
        return {
          content: [{
            type: 'text' as const,
            text: formatted + formatRoutingInfo(response),
          }],
          structuredContent: {
            ...structured,
            routed_via: `${response.providerId} / ${response.modelId}`,
            latency_ms: response.latencyMs,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.RERANK, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.GENERATE_VIDEO,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_VIDEO],
      inputSchema: videoParams as any,
      outputSchema: dmrxVideoOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.GENERATE_VIDEO],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.GENERATE_VIDEO);
      if (rateLimitResponse) return rateLimitResponse;

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.GENERATE_VIDEO }, 'routing');

        const request = toUnifiedRequest('video', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['video'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatVideoResponse(response);

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.GENERATE_VIDEO,
          provider: response.providerId,
          model: response.modelId,
          latencyMs: response.latencyMs,
        }, 'routing');

        const structured = JSON.parse(formatted);
        return {
          content: [{
            type: 'text' as const,
            text: formatted + formatRoutingInfo(response),
          }],
          structuredContent: {
            ...structured,
            routed_via: `${response.providerId} / ${response.modelId}`,
            latency_ms: response.latencyMs,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.GENERATE_VIDEO, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.GENERATE_VIDEO_STREAM,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_VIDEO_STREAM],
      inputSchema: videoStreamParams as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.GENERATE_VIDEO_STREAM],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.GENERATE_VIDEO_STREAM);
      if (rateLimitResponse) return rateLimitResponse;

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.GENERATE_VIDEO_STREAM }, 'routing');

        const request = toUnifiedRequest('video', params as unknown as Record<string, unknown>);
        request.stream = true;
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['video'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { plan } = await router.route(request, { ...classifyOptions, planOnly: true });
        const adapter = state.adapterRegistry.get(plan.primary.adapterType);
        if (!adapter || !adapter.executeStream) {
          throw new Error(`Streaming not supported by adapter: ${plan.primary.adapterType}`);
        }

        const stream = adapter.executeStream(request);
        const updates: string[] = [];
        for await (const chunk of stream) {
          updates.push(JSON.stringify(chunk));
        }

        const response: UnifiedResponse = {
          modality: 'video',
          requestId: crypto.randomUUID(),
          providerId: plan.primary.providerId,
          modelId: plan.primary.modelId,
          videos: [],
          latencyMs: 0,
        };

        const formatted = formatVideoResponse(response);

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.GENERATE_VIDEO_STREAM,
          provider: response.providerId,
          model: response.modelId,
        }, 'routing');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ updates, final: JSON.parse(formatted) }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.GENERATE_VIDEO_STREAM, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.GENERATE_MUSIC,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_MUSIC],
      inputSchema: musicParams as any,
      outputSchema: dmrxMusicOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.GENERATE_MUSIC],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.GENERATE_MUSIC);
      if (rateLimitResponse) return rateLimitResponse;

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.GENERATE_MUSIC }, 'routing');

        const request = toUnifiedRequest('music', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['music'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = formatMusicResponse(response);

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.GENERATE_MUSIC,
          provider: response.providerId,
          model: response.modelId,
          latencyMs: response.latencyMs,
        }, 'routing');

        const structured = JSON.parse(formatted);
        return {
          content: [{
            type: 'text' as const,
            text: formatted + formatRoutingInfo(response),
          }],
          structuredContent: {
            ...structured,
            routed_via: `${response.providerId} / ${response.modelId}`,
            latency_ms: response.latencyMs,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.GENERATE_MUSIC, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.GENERATE_3D,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_3D],
      inputSchema: threeDParams as any,
      outputSchema: dmrx3DOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.GENERATE_3D],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.GENERATE_3D);
      if (rateLimitResponse) return rateLimitResponse;

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.GENERATE_3D }, 'routing');

        const request = toUnifiedRequest('3d', params as unknown as Record<string, unknown>);
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['3d'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { response } = await router.route(request, classifyOptions);
        const formatted = format3DResponse(response);

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.GENERATE_3D,
          provider: response.providerId,
          model: response.modelId,
          latencyMs: response.latencyMs,
        }, 'routing');

        const structured = JSON.parse(formatted);
        return {
          content: [{
            type: 'text' as const,
            text: formatted + formatRoutingInfo(response),
          }],
          structuredContent: {
            ...structured,
            routed_via: `${response.providerId} / ${response.modelId}`,
            latency_ms: response.latencyMs,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.GENERATE_3D, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.MODELS,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.MODELS],
      inputSchema: modelsParams as any,
      outputSchema: dmrxModelsOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.MODELS],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.MODELS);
      if (rateLimitResponse) return rateLimitResponse;

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
            structuredContent: { source: 'adapters' as const, count: adapterModels.length, models: adapterModels },
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
          structuredContent: {
            source: 'registry' as const,
            count: formatted.length,
            models: formatted,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.MODELS, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.STATUS,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.STATUS],
      inputSchema: statusParams as any,
      outputSchema: dmrxStatusOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.STATUS],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.STATUS);
      if (rateLimitResponse) return rateLimitResponse;

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

        // Rate limiter status
        status.rateLimit = {
          configured: state.rateLimiter.listConfig().length > 0,
          limits: state.rateLimiter.listConfig(),
        };

        // Circuit breaker status (aggregator mode)
        if (state.externalMcpClient) {
          try {
            const registry = state.externalMcpClient.getRegistry();
            status.circuitBreaker = {
              enabled: true,
              servers: registry.getCircuitBreakerStatus(),
            };
          } catch {
            status.circuitBreaker = { enabled: true, servers: {} };
          }
        }

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
          structuredContent: status as any,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.STATUS, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.BATCH,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.BATCH],
      inputSchema: batchParams as any,
      outputSchema: dmrxBatchOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.BATCH],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.BATCH);
      if (rateLimitResponse) return rateLimitResponse;

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.BATCH, callCount: (params.calls || []).length }, 'routing');

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

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.BATCH,
          total: results.length,
          succeeded: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
        }, 'routing');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, results }, null, 2),
          }],
          structuredContent: { success: true, results },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.BATCH, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.CONTEXT_SAVE,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_SAVE],
      inputSchema: contextSaveParams as any,
      outputSchema: dmrxContextSaveOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.CONTEXT_SAVE],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.CONTEXT_SAVE);
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const id = params.id || `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const isPermanent = params.permanent === true || params.ttl_seconds === 0;
        const ttl = isPermanent ? 0 : (params.ttl_seconds || 86400);
        
        const context = {
          id,
          messages: params.messages || [],
          user: params.user || 'anonymous',
          ttl_seconds: ttl,
          permanent: isPermanent,
          created_at: new Date().toISOString(),
        };

        const cacheKey = `context:${id}`;
        const cacheStore = getContextStore();
        cacheStore.set(cacheKey, JSON.stringify(context), ttl);

        mcpLog(server, 'debug', { tool: TOOL_NAMES.CONTEXT_SAVE, contextId: id, permanent: isPermanent }, 'routing');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ 
              success: true, 
              context_id: id, 
              message: isPermanent ? 'Context saved permanently' : 'Context saved',
              permanent: isPermanent
            }, null, 2),
          }],
          structuredContent: { success: true as const, context_id: id, message: isPermanent ? 'Context saved permanently' : 'Context saved', permanent: isPermanent },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.CONTEXT_SAVE, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.CONTEXT_LOAD,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_LOAD],
      inputSchema: contextLoadParams as any,
      outputSchema: dmrxContextLoadOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.CONTEXT_LOAD],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.CONTEXT_LOAD);
      if (rateLimitResponse) return rateLimitResponse;

      try {
        const cacheStore = getContextStore();
        const cached = cacheStore.get(`context:${params.id}`);
        if (!cached) {
          throw new Error(`Context not found: ${params.id}`);
        }

        const context = JSON.parse(cached as string);
        mcpLog(server, 'debug', { tool: TOOL_NAMES.CONTEXT_LOAD, contextId: params.id }, 'routing');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, context }, null, 2),
          }],
          structuredContent: { success: true as const, context },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.CONTEXT_LOAD, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.CONTEXT_LIST,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_LIST],
      inputSchema: contextListParams as any,
      outputSchema: dmrxContextListOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.CONTEXT_LIST],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.CONTEXT_LIST);
      if (rateLimitResponse) return rateLimitResponse;

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

        mcpLog(server, 'debug', { tool: TOOL_NAMES.CONTEXT_LIST, count: sliced.length }, 'routing');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, count: sliced.length, contexts: sliced }, null, 2),
          }],
          structuredContent: { success: true as const, count: sliced.length, contexts: sliced },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.CONTEXT_LIST, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.CONTEXT_SUMMARIZE,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_SUMMARIZE],
      inputSchema: contextSummarizeParams as any,
      outputSchema: dmrxContextSummarizeOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.CONTEXT_SUMMARIZE],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.CONTEXT_SUMMARIZE);
      if (rateLimitResponse) return rateLimitResponse;

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

        mcpLog(server, 'debug', { tool: TOOL_NAMES.CONTEXT_SUMMARIZE, contextId: params.id, messageCount: messages.length }, 'routing');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, context_id: params.id, summary }, null, 2),
          }],
          structuredContent: { success: true as const, context_id: params.id, summary },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.CONTEXT_SUMMARIZE, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.CONTEXT_COMPRESS,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_COMPRESS],
      inputSchema: contextCompressParams as any,
      outputSchema: dmrxContextCompressOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.CONTEXT_COMPRESS],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.CONTEXT_COMPRESS);
      if (rateLimitResponse) return rateLimitResponse;

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

        mcpLog(server, 'debug', { tool: TOOL_NAMES.CONTEXT_COMPRESS, contextId: params.id, messagesKept: messages.length }, 'routing');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, context_id: params.id, messages_kept: messages.length }, null, 2),
          }],
          structuredContent: { success: true as const, context_id: params.id, messages_kept: messages.length },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.CONTEXT_COMPRESS, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.CHAT_STREAM,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.CHAT_STREAM],
      inputSchema: chatStreamParams as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.CHAT_STREAM],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.CHAT_STREAM);
      if (rateLimitResponse) return rateLimitResponse;

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.CHAT_STREAM }, 'routing');

        const request = toUnifiedRequest('llm', params as unknown as Record<string, unknown>);
        request.stream = true;
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['llm'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { plan } = await router.route(request, { ...classifyOptions, planOnly: true });
        const adapter = state.adapterRegistry.get(plan.primary.adapterType);
        if (!adapter || !adapter.executeStream) {
          throw new Error(`Streaming not supported by adapter: ${plan.primary.adapterType}`);
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
          providerId: plan.primary.providerId,
          modelId: plan.primary.modelId,
          message: { role: 'assistant', content: fullText },
          latencyMs: 0,
        };

        const formatted = formatChatResponse(response);

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.CHAT_STREAM,
          provider: response.providerId,
          model: response.modelId,
          chunkCount: chunks.length,
        }, 'routing');

        return {
          content: [{
            type: 'text' as const,
            text: formatted + formatRoutingInfo(response),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.CHAT_STREAM, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.GENERATE_IMAGE_STREAM,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_IMAGE_STREAM],
      inputSchema: imageStreamParams as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.GENERATE_IMAGE_STREAM],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.GENERATE_IMAGE_STREAM);
      if (rateLimitResponse) return rateLimitResponse;

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.GENERATE_IMAGE_STREAM }, 'routing');

        const request = toUnifiedRequest('diffusion', params as unknown as Record<string, unknown>);
        request.stream = true;
        const classifyOptions: ClassifyOptions = {
          path: MODALITY_TO_PATH['diffusion'],
          qualityTarget: (params.quality_target as QualityTarget) || 'balanced',
        };

        const { plan } = await router.route(request, { ...classifyOptions, planOnly: true });
        const adapter = state.adapterRegistry.get(plan.primary.adapterType);
        if (!adapter || !adapter.executeStream) {
          throw new Error(`Streaming not supported by adapter: ${plan.primary.adapterType}`);
        }

        const stream = adapter.executeStream(request);
        const updates: string[] = [];
        for await (const chunk of stream) {
          updates.push(JSON.stringify(chunk));
        }

        const response: UnifiedResponse = {
          modality: 'diffusion',
          requestId: crypto.randomUUID(),
          providerId: plan.primary.providerId,
          modelId: plan.primary.modelId,
          images: [],
          latencyMs: 0,
        };

        const formatted = formatImageResponse(response);

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.GENERATE_IMAGE_STREAM,
          provider: response.providerId,
          model: response.modelId,
          updateCount: updates.length,
        }, 'routing');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ updates, final: JSON.parse(formatted) }, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.GENERATE_IMAGE_STREAM, message }, 'routing');
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
  server.registerTool(
    TOOL_NAMES.WORKFLOW,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.WORKFLOW],
      inputSchema: workflowParams as any,
      outputSchema: dmrxWorkflowOutput as any,
      annotations: TOOL_ANNOTATIONS[TOOL_NAMES.WORKFLOW],
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.WORKFLOW);
      if (rateLimitResponse) return rateLimitResponse;

      // Tool invocation policy check
      const requestId = crypto.randomUUID();
      const tenantId = params._tenant_id || 'default';
      const policyError = evaluateToolPolicy(state, TOOL_NAMES.WORKFLOW, params, requestId, tenantId);
      if (policyError) return policyError;

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.WORKFLOW, stepCount: (params.steps || []).length }, 'routing');

        const steps = params.steps || [];
        const failFast = params.fail_fast !== false;
        const results: Array<{ step_id: string; tool: string; success: boolean; output?: unknown; error?: string }> = [];
        const stepOutputs: Record<string, unknown> = {};

        for (const step of steps) {
          try {
            const stepParams = { ...(step.parameters || {}) };

            if (step.input_mapping) {
              const mapping = step.input_mapping as Record<string, string>;
              for (const [targetKey, sourceRef] of Object.entries(mapping)) {
                const sourceValue = extractFromOutputs(sourceRef, stepOutputs, results);
                if (sourceValue !== undefined) {
                  setNestedValue(stepParams, targetKey, sourceValue);
                }
              }
            }

            mcpLog(server, 'debug', {
              tool: TOOL_NAMES.WORKFLOW,
              stepId: step.id,
              stepTool: step.tool,
            }, 'routing');

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

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.WORKFLOW,
          totalSteps: results.length,
          succeeded: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
        }, 'routing');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, results, step_outputs: stepOutputs }, null, 2),
          }],
          structuredContent: { success: true, results, step_outputs: stepOutputs },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.WORKFLOW, message }, 'routing');
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_read_file
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.READ_FILE,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.READ_FILE],
      inputSchema: readFileParams as any,
      annotations: { title: 'Read File', readOnlyHint: true, destructiveHint: false },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.READ_FILE);
      if (rateLimitResponse) return rateLimitResponse;
      try {
        const fs = await import('node:fs');
        const filePath = params.path;
        if (!filePath) return { content: [{ type: 'text' as const, text: 'Error: path is required' }], isError: true };
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const start = (params.offset ?? 1) - 1;
        const end = params.limit ? start + params.limit : lines.length;
        const selected = lines.slice(start, end);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ content: selected.join('\n'), totalLines: lines.length, startLine: start + 1, endLine: Math.min(end, lines.length) }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_write_file
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.WRITE_FILE,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.WRITE_FILE],
      inputSchema: writeFileParams as any,
      annotations: { title: 'Write File', readOnlyHint: false, destructiveHint: false },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.WRITE_FILE);
      if (rateLimitResponse) return rateLimitResponse;

      // Input validation
      const requestId = crypto.randomUUID();
      const validationError = validateToolInput(state, TOOL_NAMES.WRITE_FILE, params, requestId);
      if (validationError) return validationError;

      // Tool invocation policy check
      const tenantId = params._tenant_id || 'default';
      const policyError = evaluateToolPolicy(state, TOOL_NAMES.WRITE_FILE, params, requestId, tenantId);
      if (policyError) return policyError;

      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const filePath = params.path;
        const content = params.content;
        if (!filePath || content === undefined) return { content: [{ type: 'text' as const, text: 'Error: path and content are required' }], isError: true };
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
        return { content: [{ type: 'text' as const, text: JSON.stringify({ path: filePath, bytes: Buffer.byteLength(content), lines: content.split('\n').length }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_edit_file
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.EDIT_FILE,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.EDIT_FILE],
      inputSchema: editFileParams as any,
      annotations: { title: 'Edit File', readOnlyHint: false, destructiveHint: false },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.EDIT_FILE);
      if (rateLimitResponse) return rateLimitResponse;
      try {
        const fs = await import('node:fs');
        const filePath = params.path;
        const oldStr = params.old_string;
        const newStr = params.new_string;
        if (!filePath || !oldStr || newStr === undefined) return { content: [{ type: 'text' as const, text: 'Error: path, old_string, and new_string are required' }], isError: true };
        let content = fs.readFileSync(filePath, 'utf-8');
        const count = content.split(oldStr).length - 1;
        if (count === 0) return { content: [{ type: 'text' as const, text: `Error: old_string not found in ${filePath}` }], isError: true };
        if (count > 1) return { content: [{ type: 'text' as const, text: `Error: Found ${count} matches for old_string. Provide more context.` }], isError: true };
        content = content.replace(oldStr, newStr);
        fs.writeFileSync(filePath, content, 'utf-8');
        return { content: [{ type: 'text' as const, text: JSON.stringify({ path: filePath, replaced: 1, lines: content.split('\n').length }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_list_files
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.LIST_FILES,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.LIST_FILES],
      inputSchema: listFilesParams as any,
      annotations: { title: 'List Files', readOnlyHint: true, destructiveHint: false },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.LIST_FILES);
      if (rateLimitResponse) return rateLimitResponse;
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const dirPath = params.path || '.';
        const results: string[] = [];
        const skip = ['node_modules', '.git', 'dist'];
        function walk(dir: string, prefix: string) {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (skip.includes(entry.name)) continue;
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
              results.push(`${rel}/`);
              if (params.recursive) walk(path.join(dir, entry.name), rel);
            } else if (!params.pattern || entry.name.includes(params.pattern)) {
              results.push(rel);
            }
          }
        }
        walk(dirPath, '');
        return { content: [{ type: 'text' as const, text: JSON.stringify({ files: results.slice(0, 200), total: results.length }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_bash
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.BASH,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.BASH],
      inputSchema: bashParams as any,
      annotations: { title: 'Bash', readOnlyHint: false, destructiveHint: false },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.BASH);
      if (rateLimitResponse) return rateLimitResponse;

      // Input validation
      const requestId = crypto.randomUUID();
      const validationError = validateToolInput(state, TOOL_NAMES.BASH, params, requestId);
      if (validationError) return validationError;

      // Tool invocation policy check
      const tenantId = params._tenant_id || 'default';
      const policyError = evaluateToolPolicy(state, TOOL_NAMES.BASH, params, requestId, tenantId);
      if (policyError) return policyError;

      try {
        const { execSync } = await import('node:child_process');
        const cmd = params.command;
        if (!cmd) return { content: [{ type: 'text' as const, text: 'Error: command is required' }], isError: true };
        const blocked = ['rm -rf /', 'mkfs', ':(){', 'dd if=/dev'];
        if (blocked.some(b => cmd.includes(b))) return { content: [{ type: 'text' as const, text: 'Error: Command blocked for safety' }], isError: true };
        const stdout = execSync(cmd, { cwd: params.cwd || undefined, timeout: params.timeout_ms || 30000, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }) as string;
        return { content: [{ type: 'text' as const, text: JSON.stringify({ stdout, exitCode: 0 }, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status ?? 1, error: err.message }, null, 2) }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_search_files
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.SEARCH_FILES,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.SEARCH_FILES],
      inputSchema: searchFilesParams as any,
      annotations: { title: 'Search Files', readOnlyHint: true, destructiveHint: false },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.SEARCH_FILES);
      if (rateLimitResponse) return rateLimitResponse;
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const searchPattern = params.pattern;
        const dirPath = params.path || '.';
        if (!searchPattern) return { content: [{ type: 'text' as const, text: 'Error: pattern is required' }], isError: true };
        const results: Array<{ file: string; line: number; text: string }> = [];
        const skip = ['node_modules', '.git', 'dist'];
        function walk(dir: string) {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (skip.includes(entry.name)) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walk(fullPath);
            } else {
              if (params.include && !entry.name.includes(params.include)) continue;
              try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].includes(searchPattern)) {
                    results.push({ file: path.relative('.', fullPath), line: i + 1, text: lines[i].trim() });
                    if (results.length >= 100) return;
                  }
                }
              } catch { /* skip binary files */ }
            }
          }
        }
        walk(dirPath);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ matches: results, total: results.length }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // DMR-X subagents exposed as MCP tools (dmrx_agent_<slug>)
  //
  // Lets an external agent (Claude Code, Cursor, Codex) call a DMR-X defined
  // subagent directly by name instead of knowing its UUID. The list of
  // subagents is fetched lazily from the gateway; failures are non-fatal.
  // -----------------------------------------------------------------------
  const gatewayUrl =
    config.gatewayUrl || process.env.DMRX_GATEWAY_URL || 'http://localhost:3000';
  // Legacy shared key (env/config). Per-request isolation is resolved via
  // resolveGatewayKey() which prefers each client's X-DMR-Tenant-Key header.
  const agentApiKey = config.agentApiKey || process.env.DMRX_MCP_AGENT_API_KEY;

  // Best-effort zero-config tenant isolation: if neither a per-client header
  // nor the legacy shared key is set, auto-create a dedicated tenant + API key.
  // Fire-and-forget so createDMRXMcpServer stays synchronous.
  autoProvisionTenantKey(gatewayUrl);

  function slugifyAgentName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
  }

  // Tracks live dmrx_agent_* tool handles so we can unregister/update them
  // without restarting the MCP server when the gateway's subagent set changes.
  const registeredSubagentTools = new Map<string, any>();

  async function fetchSubagentDefs(): Promise<any[]> {
    const key = resolveGatewayKey();
    if (!key) {
      return [];
    }
    const listRes = await fetch(`${gatewayUrl}/v1/agents`, {
      method: 'GET',
      headers: { authorization: `Bearer ${key}` },
    });
    if (!listRes.ok) {
      mcpLog(server, 'warning', { status: listRes.status }, 'subagent-list-failed');
      return [];
    }
    const listJson: any = await listRes.json();
    const defs: any[] = Array.isArray(listJson) ? listJson : listJson?.items ?? listJson?.data ?? [];
    return defs;
  }

  // DRY helper for authenticated JSON POSTs to the gateway. Uses the same
  // key resolution as other outbound calls (per-client tenant header →
  // DMRX_MCP_AGENT_API_KEY → auto-provisioned key). Returns the parsed JSON
  // body and status so handlers can surface gateway errors gracefully.
  async function dmrxPost(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: any }> {
    const key = resolveGatewayKey();
    const res = await fetch(`${gatewayUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(540_000),
    });
    let json: any;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  }

  async function dmrxGet(path: string): Promise<{ ok: boolean; status: number; json: any }> {
    const key = resolveGatewayKey();
    const res = await fetch(`${gatewayUrl}${path}`, {
      method: 'GET',
      headers: {
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      signal: AbortSignal.timeout(120_000),
    });
    let json: any;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  }

  async function refreshSubagentTools(): Promise<void> {
    try {
      const defs = await fetchSubagentDefs();
      const desired = new Map<string, any>();
      for (const def of defs) {
        if (!def?.name) continue;
        desired.set(`dmrx_agent_${slugifyAgentName(def.name)}`, def);
      }

      // Unregister tools whose slug no longer exists in the gateway.
      for (const slug of [...registeredSubagentTools.keys()]) {
        if (!desired.has(slug)) {
          try {
            if (typeof (server as any).unregisterTool === 'function') {
              (server as any).unregisterTool(slug);
            } else {
              registeredSubagentTools.get(slug)?.remove?.();
            }
          } catch { /* ignore unregister failures */ }
          registeredSubagentTools.delete(slug);
        }
      }

      // Register or update tools for the current defs.
      for (const [slug, def] of desired) {
        const desc =
          def.description || `Run the DMR-X subagent "${def.name}" with a task.`;
        try {
          const existing = registeredSubagentTools.get(slug);
          if (existing) {
            existing.update?.({ description: desc });
            continue;
          }
          const handle = server.registerTool(
            slug,
            {
              description: desc,
              inputSchema: {
                task: z.string().describe('The task or prompt for the subagent'),
                run: z.boolean().optional().describe('If true, execute immediately (default true)'),
              } as any,
              annotations: { title: `Subagent: ${def.name}`, readOnlyHint: false, destructiveHint: false },
            },
            async (params: any) => {
              try {
                const key = resolveGatewayKey();
                if (!key) {
                  return {
                    content: [
                      { type: 'text' as const, text: 'A2A agent key not configured (DMRX_MCP_AGENT_API_KEY / X-DMR-Tenant-Key)' },
                    ],
                    isError: true,
                  };
                }
                const runRes = await fetch(`${gatewayUrl}/v1/agentic/dispatch`, {
                  method: 'POST',
                  headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${key}`,
                  },
                  body: JSON.stringify({ task: params.task, run: params.run ?? true }),
                });
                const runJson: any = await runRes.json();
                if (!runRes.ok) {
                  return {
                    content: [
                      { type: 'text' as const, text: `Error: ${runJson?.error?.message || runRes.statusText}` },
                    ],
                    isError: true,
                  };
                }
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: JSON.stringify(
                        {
                          subagent: def.name,
                          content: runJson.content,
                          model: runJson.model,
                          usage: runJson.usage,
                        },
                        null,
                        2,
                      ),
                    },
                  ],
                };
              } catch (err) {
                return {
                  content: [
                    { type: 'text' as const, text: `Error contacting gateway: ${err instanceof Error ? err.message : String(err)}` },
                  ],
                  isError: true,
                };
              }
            },
          );
          registeredSubagentTools.set(slug, handle);
        } catch { /* guard against already-registered / update races */ }
      }
      mcpLog(server, 'info', { subagentTools: defs.length }, 'routing');
    } catch (err) {
      mcpLog(server, 'warning', { message: err instanceof Error ? err.message : String(err) }, 'subagent-list-error');
    }
  }

  {
    // Keep createDMRXMcpServer synchronous so existing callers can still
    // destructure { server, state } immediately. Registration refreshes
    // lazily on startup and then on an interval so gateway subagent changes
    // are picked up without restarting the MCP server. refreshSubagentTools()
    // self-guards on a missing key, so it's safe to start even before
    // auto-provisioning (or an X-DMR-Tenant-Key) resolves.
    void refreshSubagentTools();
    const subagentRefreshInterval = setInterval(() => void refreshSubagentTools(), 60_000);
    void subagentRefreshInterval;
  }

  // -----------------------------------------------------------------------
  // Tool: dmrx_tool_search — Intelligent tool discovery
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.TOOL_SEARCH,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.TOOL_SEARCH],
      inputSchema: toolSearchParams as any,
      outputSchema: dmrxToolSearchOutput as any,
      annotations: { title: 'Search Tools', readOnlyHint: true, openWorldHint: false },
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const requestId = crypto.randomUUID();
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.TOOL_SEARCH);
      if (rateLimitResponse) return rateLimitResponse;

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.TOOL_SEARCH, requestId }, 'tool-search');

        // Build tool documents from SDK tools and external tools
        const documents: ToolDocument[] = [];
        
        // Add internal tools
        for (const tool of state.sdkTools) {
          documents.push({
            id: tool.name,
            name: tool.name,
            description: tool.description || tool.name,
            serverId: 'dmr-x',
            serverName: 'DMR-X',
          });
        }

        // Add external tools if enabled
        if (params.include_external !== false && state.externalMcpClient) {
          const registry = state.externalMcpClient.getRegistry();
          const allServers = registry.listAll();
          for (const connected of allServers) {
            const serverId = connected.config.id;
            for (const tool of connected.tools) {
              const namespacedName = `${serverId}__${tool.name}`;
              documents.push({
                id: namespacedName,
                name: namespacedName,
                description: `[Proxied via MCP server '${serverId}'] ${tool.description ?? tool.name}`,
                serverId,
                serverName: connected.config.name,
              });
            }
          }
        }

        // Initialize and populate search engine
        await state.searchEngine.initialize();
        await state.searchEngine.addTools(documents);

        // Perform hybrid search
        const searchResults = await state.searchEngine.search(params.query, params.max_results || 10);

        // Format results
        const results = searchResults.map((result) => ({
          name: result.tool.name,
          description: result.tool.description,
          score: result.score,
          source: (result.tool.serverId === 'dmr-x' ? 'internal' : 'external') as 'internal' | 'external',
          server_id: result.tool.serverId === 'dmr-x' ? undefined : result.tool.serverId,
          modality: undefined,
        }));

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.TOOL_SEARCH,
          requestId,
          query: params.query,
          resultCount: results.length,
        }, 'tool-search');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              query: params.query,
              results,
              total_count: results.length,
            }, null, 2),
          }],
          structuredContent: {
            query: params.query,
            results,
            total_count: results.length,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.TOOL_SEARCH, requestId, message }, 'tool-search');
        return toolError(message, 'TOOL_SEARCH_ERROR', requestId);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_tool_list — List all available tools
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.TOOL_LIST,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.TOOL_LIST],
      inputSchema: toolListParams as any,
      outputSchema: dmrxToolListOutput as any,
      annotations: { title: 'List Tools', readOnlyHint: true, openWorldHint: false },
    },
    async (params: any) => {
      await initAdapters();
      state.requestCount++;
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.TOOL_LIST);
      if (rateLimitResponse) return rateLimitResponse;

      try {
        mcpLog(server, 'debug', { tool: TOOL_NAMES.TOOL_LIST }, 'tool-list');

        const tools: Array<{
          name: string;
          description?: string;
          source: 'internal' | 'external';
          server_id?: string;
          modality?: string;
        }> = [];

        // Add internal tools
        for (const tool of state.sdkTools) {
          tools.push({
            name: tool.name,
            description: params.include_descriptions !== false ? tool.description : undefined,
            source: 'internal',
          });
        }

        // Add external tools if enabled
        if (params.include_external !== false && state.externalMcpClient) {
          const registry = state.externalMcpClient.getRegistry();
          const allServers = registry.listAll();
          for (const connected of allServers) {
            const serverId = connected.config.id;
            for (const tool of connected.tools) {
              const namespacedName = `${serverId}__${tool.name}`;
              tools.push({
                name: namespacedName,
                description: params.include_descriptions !== false
                  ? `[Proxied via MCP server '${serverId}'] ${tool.description ?? tool.name}`
                  : undefined,
                source: 'external',
                server_id: serverId,
              });
            }
          }
        }

        const internalCount = tools.filter((t) => t.source === 'internal').length;
        const externalCount = tools.filter((t) => t.source === 'external').length;

        mcpLog(server, 'info', {
          tool: TOOL_NAMES.TOOL_LIST,
          totalCount: tools.length,
          internalCount,
          externalCount,
        }, 'tool-list');

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              tools,
              total_count: tools.length,
              internal_count: internalCount,
              external_count: externalCount,
            }, null, 2),
          }],
          structuredContent: {
            tools,
            total_count: tools.length,
            internal_count: internalCount,
            external_count: externalCount,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        state.lastError = message;
        mcpLog(server, 'error', { tool: TOOL_NAMES.TOOL_LIST, message }, 'tool-list');
        return toolError(message, 'TOOL_LIST_ERROR');
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_template_list
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.TEMPLATE_LIST,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.TEMPLATE_LIST],
      inputSchema: templateListParams as any,
      annotations: { title: 'List Templates', readOnlyHint: true, destructiveHint: false },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.TEMPLATE_LIST);
      if (rateLimitResponse) return rateLimitResponse;

      const requestId = crypto.randomUUID();
      const tenantId = params._tenant_id || 'default';

      try {
        const templates = state.templatesService.listTemplates(tenantId, {
          tag: params.tag,
          search: params.search,
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              templates: templates.map(t => ({
                id: t.id,
                name: t.name,
                description: t.description,
                version: t.version,
                tags: t.tags,
                step_count: t.steps.length,
                created_at: t.created_at,
              })),
              total_count: templates.length,
            }, null, 2),
          }],
          structuredContent: {
            templates,
            total_count: templates.length,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(message, 'TEMPLATE_LIST_ERROR', requestId);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_template_get
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.TEMPLATE_GET,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.TEMPLATE_GET],
      inputSchema: templateGetParams as any,
      annotations: { title: 'Get Template', readOnlyHint: true, destructiveHint: false },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.TEMPLATE_GET);
      if (rateLimitResponse) return rateLimitResponse;

      const requestId = crypto.randomUUID();

      try {
        const template = state.templatesService.getTemplate(params.id);
        if (!template) {
          return toolError('Template not found', 'TEMPLATE_NOT_FOUND', requestId);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(template, null, 2),
          }],
          structuredContent: template,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(message, 'TEMPLATE_GET_ERROR', requestId);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_template_create
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.TEMPLATE_CREATE,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.TEMPLATE_CREATE],
      inputSchema: templateCreateParams as any,
      annotations: { title: 'Create Template', readOnlyHint: false, destructiveHint: false },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.TEMPLATE_CREATE);
      if (rateLimitResponse) return rateLimitResponse;

      const requestId = crypto.randomUUID();
      const tenantId = params._tenant_id || 'default';

      try {
        const template = state.templatesService.createTemplate({
          tenant_id: tenantId,
          name: params.name,
          description: params.description,
          steps: params.steps,
          tags: params.tags || [],
          version: params.version || '1.0.0',
          created_by: params._user_id,
          is_active: true,
        });

        logAuditEvent(state, 'tool.invocation', TOOL_NAMES.TEMPLATE_CREATE, { requestId, templateId: template.id });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(template, null, 2),
          }],
          structuredContent: template,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(message, 'TEMPLATE_CREATE_ERROR', requestId);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_template_update
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.TEMPLATE_UPDATE,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.TEMPLATE_UPDATE],
      inputSchema: templateUpdateParams as any,
      annotations: { title: 'Update Template', readOnlyHint: false, destructiveHint: false },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.TEMPLATE_UPDATE);
      if (rateLimitResponse) return rateLimitResponse;

      const requestId = crypto.randomUUID();

      try {
        const updates: Record<string, unknown> = {};
        if (params.name !== undefined) updates.name = params.name;
        if (params.description !== undefined) updates.description = params.description;
        if (params.steps !== undefined) updates.steps = params.steps;
        if (params.tags !== undefined) updates.tags = params.tags;
        if (params.version !== undefined) updates.version = params.version;

        const success = state.templatesService.updateTemplate(params.id, updates);
        if (!success) {
          return toolError('Template not found', 'TEMPLATE_NOT_FOUND', requestId);
        }

        const template = state.templatesService.getTemplate(params.id);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(template, null, 2),
          }],
          structuredContent: template ?? undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(message, 'TEMPLATE_UPDATE_ERROR', requestId);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_template_delete
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.TEMPLATE_DELETE,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.TEMPLATE_DELETE],
      inputSchema: templateDeleteParams as any,
      annotations: { title: 'Delete Template', readOnlyHint: false, destructiveHint: true },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.TEMPLATE_DELETE);
      if (rateLimitResponse) return rateLimitResponse;

      const requestId = crypto.randomUUID();

      try {
        const success = state.templatesService.deleteTemplate(params.id);
        if (!success) {
          return toolError('Template not found', 'TEMPLATE_NOT_FOUND', requestId);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, id: params.id }, null, 2),
          }],
          structuredContent: { success: true, id: params.id },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(message, 'TEMPLATE_DELETE_ERROR', requestId);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_template_execute
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.TEMPLATE_EXECUTE,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.TEMPLATE_EXECUTE],
      inputSchema: templateExecuteParams as any,
      annotations: { title: 'Execute Template', readOnlyHint: false, destructiveHint: false },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.TEMPLATE_EXECUTE);
      if (rateLimitResponse) return rateLimitResponse;

      const requestId = crypto.randomUUID();
      const tenantId = params._tenant_id || 'default';

      try {
        const template = state.templatesService.getTemplate(params.id);
        if (!template) {
          return toolError('Template not found', 'TEMPLATE_NOT_FOUND', requestId);
        }

        // Log execution start
        const executionId = state.templatesService.logExecution({
          template_id: template.id,
          tenant_id: tenantId,
          status: 'running',
          steps_total: template.steps.length,
          request_id: requestId,
          user_id: params._user_id,
        });

        const startTime = Date.now();
        const stepOutputs: Record<string, unknown> = {};
        const results: Array<{ step_id: string; tool: string; success: boolean; output?: unknown; error?: string }> = [];

        // Execute each step
        for (const step of template.steps) {
          try {
            // Merge parameters with any overrides from params.inputs
            const stepParams = { ...step.parameters };

            // Apply input mapping from previous steps
            if (step.input_mapping) {
              for (const [targetKey, sourceRef] of Object.entries(step.input_mapping)) {
                // Parse source reference: "$step_id.field" or "$step_id"
                const match = sourceRef.match(/^\$(\w+)(?:\.(\w+))?$/);
                if (match) {
                  const [, sourceStepId, sourceField] = match;
                  const sourceOutput = stepOutputs[sourceStepId];
                  if (sourceOutput !== undefined) {
                    stepParams[targetKey] = sourceField
                      ? (sourceOutput as Record<string, unknown>)?.[sourceField]
                      : sourceOutput;
                  }
                }
              }
            }

            // Apply user overrides (key format: "step_id.param")
            if (params.inputs) {
              for (const [key, value] of Object.entries(params.inputs)) {
                const [stepId, param] = key.split('.');
                if (stepId === step.id && param) {
                  stepParams[param] = value;
                }
              }
            }

            // Execute the tool
            const output = await executeDMRXTool(state.router, state.adapterRegistry, step.tool_name, stepParams);
            results.push({ step_id: step.id, tool: step.tool_name, success: true, output });
            stepOutputs[step.id] = output;
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            results.push({ step_id: step.id, tool: step.tool_name, success: false, error: message });
            stepOutputs[step.id] = { error: message };
          }
        }

        const durationMs = Date.now() - startTime;
        const allSuccess = results.every(r => r.success);

        // Update execution log
        state.templatesService.logExecution({
          template_id: template.id,
          tenant_id: tenantId,
          status: allSuccess ? 'completed' : 'failed',
          steps_completed: results.filter(r => r.success).length,
          steps_total: template.steps.length,
          output: results,
          duration_ms: durationMs,
          request_id: requestId,
          user_id: params._user_id,
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              template_id: template.id,
              template_name: template.name,
              success: allSuccess,
              results,
              step_outputs: stepOutputs,
              duration_ms: durationMs,
            }, null, 2),
          }],
          structuredContent: {
            template_id: template.id,
            template_name: template.name,
            success: allSuccess,
            results,
            step_outputs: stepOutputs,
            duration_ms: durationMs,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(message, 'TEMPLATE_EXECUTE_ERROR', requestId);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_preset_list
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.PRESET_LIST,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.PRESET_LIST],
      inputSchema: presetListParams as any,
      annotations: { title: 'List Presets', readOnlyHint: true, destructiveHint: false },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.PRESET_LIST);
      if (rateLimitResponse) return rateLimitResponse;

      const requestId = crypto.randomUUID();
      const tenantId = params._tenant_id || 'default';

      try {
        const presets = state.templatesService.listPresets(tenantId, params.tool_name);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              presets: presets.map(p => ({
                id: p.id,
                tool_name: p.tool_name,
                priority: p.priority,
                description: p.description,
                has_defaults: Object.keys(p.defaults).length > 0,
                has_overrides: p.overrides ? Object.keys(p.overrides).length > 0 : false,
                created_at: p.created_at,
              })),
              total_count: presets.length,
            }, null, 2),
          }],
          structuredContent: {
            presets,
            total_count: presets.length,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(message, 'PRESET_LIST_ERROR', requestId);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_preset_get
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.PRESET_GET,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.PRESET_GET],
      inputSchema: presetGetParams as any,
      annotations: { title: 'Get Preset', readOnlyHint: true, destructiveHint: false },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.PRESET_GET);
      if (rateLimitResponse) return rateLimitResponse;

      const requestId = crypto.randomUUID();

      try {
        const preset = state.templatesService.getPreset(params.id);
        if (!preset) {
          return toolError('Preset not found', 'PRESET_NOT_FOUND', requestId);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(preset, null, 2),
          }],
          structuredContent: preset,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(message, 'PRESET_GET_ERROR', requestId);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_preset_create
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.PRESET_CREATE,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.PRESET_CREATE],
      inputSchema: presetCreateParams as any,
      annotations: { title: 'Create Preset', readOnlyHint: false, destructiveHint: false },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.PRESET_CREATE);
      if (rateLimitResponse) return rateLimitResponse;

      const requestId = crypto.randomUUID();
      const tenantId = params._tenant_id || 'default';

      try {
        const preset = state.templatesService.createPreset({
          tenant_id: tenantId,
          tool_name: params.tool_name,
          defaults: params.defaults,
          overrides: params.overrides,
          priority: params.priority || 0,
          description: params.description,
          created_by: params._user_id,
          is_active: true,
        });

        logAuditEvent(state, 'tool.invocation', TOOL_NAMES.PRESET_CREATE, { requestId, presetId: preset.id });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(preset, null, 2),
          }],
          structuredContent: preset,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(message, 'PRESET_CREATE_ERROR', requestId);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_preset_update
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.PRESET_UPDATE,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.PRESET_UPDATE],
      inputSchema: presetUpdateParams as any,
      annotations: { title: 'Update Preset', readOnlyHint: false, destructiveHint: false },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.PRESET_UPDATE);
      if (rateLimitResponse) return rateLimitResponse;

      const requestId = crypto.randomUUID();

      try {
        const updates: Record<string, unknown> = {};
        if (params.defaults !== undefined) updates.defaults = params.defaults;
        if (params.overrides !== undefined) updates.overrides = params.overrides;
        if (params.priority !== undefined) updates.priority = params.priority;
        if (params.description !== undefined) updates.description = params.description;

        const success = state.templatesService.updatePreset(params.id, updates);
        if (!success) {
          return toolError('Preset not found', 'PRESET_NOT_FOUND', requestId);
        }

        const preset = state.templatesService.getPreset(params.id);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(preset, null, 2),
          }],
          structuredContent: preset ?? undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(message, 'PRESET_UPDATE_ERROR', requestId);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_preset_delete
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.PRESET_DELETE,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.PRESET_DELETE],
      inputSchema: presetDeleteParams as any,
      annotations: { title: 'Delete Preset', readOnlyHint: false, destructiveHint: true },
    },
    async (params: any) => {
      const rateLimitResponse = checkRateLimit(state, TOOL_NAMES.PRESET_DELETE);
      if (rateLimitResponse) return rateLimitResponse;

      const requestId = crypto.randomUUID();

      try {
        const success = state.templatesService.deletePreset(params.id);
        if (!success) {
          return toolError('Preset not found', 'PRESET_NOT_FOUND', requestId);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ success: true, id: params.id }, null, 2),
          }],
          structuredContent: { success: true, id: params.id },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(message, 'PRESET_DELETE_ERROR', requestId);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_import_repo
  //
  // Imports agents + skills from a GitHub repository through the gateway.
  // Two sequential POSTs: /v1/agents/import then /v1/skills/import.
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.IMPORT_REPO,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.IMPORT_REPO],
      inputSchema: {
        repoUrl: z.string().describe('Public GitHub repository URL to import agents and skills from'),
        category: z.string().optional().describe('Optional category to assign to imported agents'),
        source: z.enum(['github']).optional().default('github').describe('Source type (only github is supported)'),
      } as any,
      annotations: { title: 'Import Repository', readOnlyHint: false, openWorldHint: true, destructiveHint: false },
    },
    async (params: any) => {
      const requestId = crypto.randomUUID();

      if (!gatewayUrl) {
        return toolError('Gateway URL is not configured', 'GATEWAY_URL_MISSING', requestId);
      }

      try {
        const repoUrl: string = params.repoUrl;
        if (!repoUrl || typeof repoUrl !== 'string') {
          return toolError('repoUrl is required', 'INVALID_ARGUMENT', requestId);
        }

        const agentsRes = await dmrxPost('/v1/agents/import', {
          source: 'github',
          githubUrl: repoUrl,
          ...(params.category ? { category: params.category } : {}),
        });

        const skillsRes = await dmrxPost('/v1/skills/import', {
          mode: 'github',
          githubUrl: repoUrl,
        });

        if (!agentsRes.ok || !skillsRes.ok) {
          const detail = {
            agentsStatus: agentsRes.status,
            agentsError: agentsRes.json,
            skillsStatus: skillsRes.status,
            skillsError: skillsRes.json,
          };
          return toolError(
            'Gateway import failed',
            'GATEWAY_IMPORT_FAILED',
            requestId,
            JSON.stringify(detail)
          );
        }

        const agentsJson = agentsRes.json ?? {};
        const skillsJson = skillsRes.json ?? {};
        // /v1/agents/import returns a nested wrapper: { agents: {...}, skills: {...}, artifacts }.
        // /v1/skills/import returns the BulkImportSkillResult directly: { imported, errors, skills }.
        const agents = agentsJson.agents ?? agentsJson;
        const agentSkills = agentsJson.skills ?? {};
        const result = {
          success: true,
          repository: repoUrl,
          agents: {
            imported: agents.imported ?? 0,
            skipped: agents.skipped ?? 0,
            errors: agents.errors ?? [],
            items: agents.agents ?? [],
          },
          skills: {
            imported: (agentSkills.imported ?? skillsJson.imported) ?? 0,
            errors: agentSkills.errors ?? skillsJson.errors ?? [],
            items: agentSkills.skills ?? skillsJson.skills ?? [],
          },
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(message, 'IMPORT_REPO_ERROR', requestId);
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool: dmrx_list_skills
  //
  // Lists skills imported into DMR-X via the gateway (GET /v1/skills).
  // -----------------------------------------------------------------------
  server.registerTool(
    TOOL_NAMES.LIST_SKILLS,
    {
      description: TOOL_DESCRIPTIONS[TOOL_NAMES.LIST_SKILLS],
      inputSchema: {
        search: z.string().optional().describe('Optional free-text search query'),
        tag: z.string().optional().describe('Optional tag filter'),
        limit: z.number().optional().default(50).describe('Maximum number of skills to return (default 50)'),
      } as any,
      annotations: { title: 'List Skills', readOnlyHint: true, openWorldHint: false },
    },
    async (params: any) => {
      const requestId = crypto.randomUUID();

      if (!gatewayUrl) {
        return toolError('Gateway URL is not configured', 'GATEWAY_URL_MISSING', requestId);
      }

      try {
        const query = new URLSearchParams();
        if (params.search) query.set('search', String(params.search));
        if (params.tag) query.set('tag', String(params.tag));
        query.set('limit', String(params.limit ?? 50));

        const res = await dmrxGet(`/v1/skills?${query.toString()}`);
        if (!res.ok) {
          return toolError(
            'Gateway skills list failed',
            'GATEWAY_LIST_FAILED',
            requestId,
            JSON.stringify({ status: res.status, error: res.json })
          );
        }

        const json = res.json ?? {};
        const items: any[] = json.items ?? [];
        const result = {
          total: json.total ?? items.length,
          skills: items.map((s: any) => ({ id: s.id ?? s.name, name: s.name })),
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(message, 'LIST_SKILLS_ERROR', requestId);
      }
    }
  );

  // Register external MCP aggregator tools (if a client was provided)
  if (config.externalMcpClient) {
    try {
      registerExternalTools(server, config.externalMcpClient, state, config.allowedTools);
      logger.info(
        { externalToolCount: state.externalToolCount },
        'External MCP aggregator tools registered'
      );
    } catch (error) {
      logger.error({ err: error }, 'Failed to register external MCP aggregator tools');
    }
  }

  // Start periodic cleanup of expired contexts (every hour)
  setInterval(() => {
    try {
      const cleaned = persistentContextStore.cleanupExpired();
      if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} expired conversation contexts`);
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to cleanup expired contexts');
    }
  }, 60 * 60 * 1000);

  return { server, state };
}

// -----------------------------------------------------------------------
// Internal helpers for new tools
// -----------------------------------------------------------------------

function getContextStore(): { get(key: string): string | null; set(key: string, value: string, ttl: number): void; keys(prefix: string): string[]; delete(key: string): void } {
  return {
    get(key: string) {
      return persistentContextStore.get(key);
    },
    set(key: string, value: string, ttl: number) {
      persistentContextStore.set(key, value, ttl);
    },
    keys(prefix: string) {
      return persistentContextStore.keys(prefix);
    },
    delete(key: string) {
      persistentContextStore.delete(key);
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
