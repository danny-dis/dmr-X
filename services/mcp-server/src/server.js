/**
 * DMR-X MCP Server
 *
 * Exposes DMR-X routing capabilities as MCP tools.
 * Transport-agnostic: works with stdio, SSE, and Streamable HTTP transports.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Router } from '@dmr-x/router';
import { AdapterRegistry, OpenAIAdapter, AnthropicAdapter, OllamaAdapter } from '@dmr-x/adapters';
import { ReplicateAdapter, StabilityAdapter } from '@dmr-x/adapters';
import { logger } from '@dmr-x/utils';
import { ElevenLabsAdapter, DeepgramAdapter } from '@dmr-x/adapters';
import { CohereAdapter, JinaAdapter } from '@dmr-x/adapters';
import { resolveProviderSlug } from '@dmr-x/core';
import { TOOL_NAMES, TOOL_DESCRIPTIONS, dmrxChatParams as chatParams, dmrxGenerateImageParams as imageParams, dmrxEmbedParams as embedParams, dmrxTranscribeParams as transcribeParams, dmrxSpeakParams as speakParams, dmrxRerankParams as rerankParams, dmrxModelsParams as modelsParams, dmrxStatusParams as statusParams, dmrxBatchParams as batchParams, dmrxContextSaveParams as contextSaveParams, dmrxContextLoadParams as contextLoadParams, dmrxContextListParams as contextListParams, dmrxContextSummarizeParams as contextSummarizeParams, dmrxContextCompressParams as contextCompressParams, dmrxChatStreamParams as chatStreamParams, dmrxGenerateImageStreamParams as imageStreamParams, dmrxWorkflowParams as workflowParams, } from './tools.js';
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
/** Map a modality to the API endpoint path expected by the task classifier */
const MODALITY_TO_PATH = {
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
function buildAdapterRegistry() {
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
function toUnifiedRequest(modality, params) {
    const request = {
        modality,
        stream: false,
        metadata: {},
    };
    // Map common fields
    if (params.model)
        request.model = params.model;
    if (params.user)
        request.user = params.user;
    if (params.provider_preference) {
        request.metadata.providerPreferences = {
            order: params.provider_preference.map(resolveProviderSlug),
            strategy: 'direct',
        };
    }
    if (params.provider_blacklist) {
        request.metadata.providerPreferences = {
            ...(request.metadata.providerPreferences || {}),
            ignore: params.provider_blacklist.map(resolveProviderSlug),
        };
    }
    if (params.latency_target) {
        const latencyMs = typeof params.latency_target === 'number'
            ? params.latency_target
            : parseInt(params.latency_target.replace(/[^0-9]/g, ''), 10);
        request.metadata.providerPreferences = {
            ...(request.metadata.providerPreferences || {}),
            preferredMaxLatencyMs: latencyMs,
        };
    }
    if (params.cost_target) {
        const costPerMillion = typeof params.cost_target === 'number'
            ? params.cost_target
            : parseFloat(params.cost_target.replace(/[^0-9.]/g, ''));
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
            ].filter((slug) => ['ollama', 'local', 'openai'].includes(slug)),
            strategy: 'direct',
        };
    }
    if (params.quality_target) {
        request.metadata.qualityTarget = params.quality_target;
    }
    // Modality-specific mapping
    switch (modality) {
        case 'llm':
            request.messages = params.messages;
            request.temperature = params.temperature;
            request.max_tokens = params.max_tokens;
            request.top_p = params.top_p;
            request.frequency_penalty = params.frequency_penalty;
            request.presence_penalty = params.presence_penalty;
            request.stop = params.stop;
            request.response_format = params.response_format;
            request.seed = params.seed;
            request.n = params.n;
            request.tools = params.tools;
            request.tool_choice = params.tool_choice;
            break;
        case 'diffusion':
            request.prompt = params.prompt;
            request.negative_prompt = params.negative_prompt;
            request.width = params.width;
            request.height = params.height;
            request.steps = params.steps;
            request.diffusion_seed = params.seed;
            request.style = params.style;
            request.cfg_scale = params.cfg_scale;
            request.n = params.n;
            break;
        case 'embedding':
            request.input = params.input;
            request.dimensions = params.dimensions;
            request.encoding_format = params.encoding_format;
            break;
        case 'audio_stt':
            request.audio = params.audio;
            request.audio_format = params.audio_format;
            request.language = params.language;
            break;
        case 'audio_tts':
            request.prompt = params.input;
            request.voice = params.voice;
            request.speed = params.speed;
            request.format = params.format;
            request.language = params.language;
            break;
        case 'reranking':
            request.query = params.query;
            request.documents = params.documents;
            request.top_n = params.top_n;
            break;
    }
    return request;
}
function formatChatResponse(response) {
    const result = {
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
function formatImageResponse(response) {
    const result = {
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
function formatEmbeddingResponse(response) {
    const result = {
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
function formatTranscribeResponse(response) {
    const result = {
        provider: response.providerId,
        model: response.modelId,
        text: response.completion || response.message?.content || '',
    };
    return JSON.stringify(result, null, 2);
}
function formatSpeakResponse(response) {
    const result = {
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
function formatRerankResponse(response) {
    const result = {
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
function formatRoutingInfo(response) {
    return `\n\n---\nRouted via: ${response.providerId} / ${response.modelId} (${response.latencyMs}ms)`;
}
// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------
export function createDMRXMcpServer(config = {}) {
    // Initialize adapter registry
    const adapterRegistry = buildAdapterRegistry();
    // Initialize adapter configs
    const adapterConfigs = config.adapterConfigs || {};
    // Initialize adapters asynchronously (will be awaited on first use)
    let adaptersInitialized = false;
    const initAdapters = async () => {
        if (adaptersInitialized)
            return;
        for (const [providerId, cfg] of Object.entries(adapterConfigs)) {
            try {
                await adapterRegistry.initialize(providerId, cfg);
            }
            catch (initErr) {
                // Adapter not configured — skip but log for debugging
                logger.warn({ err: initErr, providerId }, 'Failed to initialize adapter');
            }
        }
        adaptersInitialized = true;
    };
    // Create router
    const router = new Router(config.router);
    // Server state
    const state = {
        router,
        adapterRegistry,
        candidates: config.candidates || [],
        startTime: Date.now(),
        requestCount: 0,
        lastError: null,
        sdkTools: [],
    };
    // SDK tool definitions for programmatic access and discovery
    const sdkToolDefs = [
        { name: TOOL_NAMES.CHAT, description: TOOL_DESCRIPTIONS[TOOL_NAMES.CHAT], params: chatParams },
        { name: TOOL_NAMES.GENERATE_IMAGE, description: TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_IMAGE], params: imageParams },
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
        { name: TOOL_NAMES.WORKFLOW, description: TOOL_DESCRIPTIONS[TOOL_NAMES.WORKFLOW], params: workflowParams },
    ];
    for (const def of sdkToolDefs) {
        state.sdkTools.push(def);
    }
    // Wire up adapter executor for fallback
    router.setAdapterExecutor({
        async execute(providerId, modelId, request) {
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
    server.tool(TOOL_NAMES.CHAT, TOOL_DESCRIPTIONS[TOOL_NAMES.CHAT], chatParams, async (params) => {
        await initAdapters();
        state.requestCount++;
        try {
            const request = toUnifiedRequest('llm', params);
            const classifyOptions = {
                path: MODALITY_TO_PATH['llm'],
                qualityTarget: params.quality_target || 'balanced',
            };
            const { response } = await router.route(request, classifyOptions);
            const formatted = formatChatResponse(response);
            return {
                content: [{
                        type: 'text',
                        text: formatted + formatRoutingInfo(response),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_generate_image
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.GENERATE_IMAGE, TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_IMAGE], imageParams, async (params) => {
        await initAdapters();
        state.requestCount++;
        try {
            const request = toUnifiedRequest('diffusion', params);
            const classifyOptions = {
                path: MODALITY_TO_PATH['diffusion'],
                qualityTarget: params.quality_target || 'balanced',
            };
            const { response } = await router.route(request, classifyOptions);
            const formatted = formatImageResponse(response);
            return {
                content: [{
                        type: 'text',
                        text: formatted + formatRoutingInfo(response),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_embed
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.EMBED, TOOL_DESCRIPTIONS[TOOL_NAMES.EMBED], embedParams, async (params) => {
        await initAdapters();
        state.requestCount++;
        try {
            const request = toUnifiedRequest('embedding', params);
            const classifyOptions = {
                path: MODALITY_TO_PATH['embedding'],
                qualityTarget: params.quality_target || 'balanced',
            };
            const { response } = await router.route(request, classifyOptions);
            const formatted = formatEmbeddingResponse(response);
            return {
                content: [{
                        type: 'text',
                        text: formatted + formatRoutingInfo(response),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_transcribe
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.TRANSCRIBE, TOOL_DESCRIPTIONS[TOOL_NAMES.TRANSCRIBE], transcribeParams, async (params) => {
        await initAdapters();
        state.requestCount++;
        try {
            const request = toUnifiedRequest('audio_stt', params);
            const classifyOptions = {
                path: MODALITY_TO_PATH['audio_stt'],
                qualityTarget: params.quality_target || 'balanced',
            };
            const { response } = await router.route(request, classifyOptions);
            const formatted = formatTranscribeResponse(response);
            return {
                content: [{
                        type: 'text',
                        text: formatted + formatRoutingInfo(response),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_speak
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.SPEAK, TOOL_DESCRIPTIONS[TOOL_NAMES.SPEAK], speakParams, async (params) => {
        await initAdapters();
        state.requestCount++;
        try {
            const request = toUnifiedRequest('audio_tts', params);
            const classifyOptions = {
                path: MODALITY_TO_PATH['audio_tts'],
                qualityTarget: params.quality_target || 'balanced',
            };
            const { response } = await router.route(request, classifyOptions);
            const formatted = formatSpeakResponse(response);
            return {
                content: [{
                        type: 'text',
                        text: formatted + formatRoutingInfo(response),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_rerank
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.RERANK, TOOL_DESCRIPTIONS[TOOL_NAMES.RERANK], rerankParams, async (params) => {
        await initAdapters();
        state.requestCount++;
        try {
            const request = toUnifiedRequest('reranking', params);
            const classifyOptions = {
                path: MODALITY_TO_PATH['reranking'],
                qualityTarget: params.quality_target || 'balanced',
            };
            const { response } = await router.route(request, classifyOptions);
            const formatted = formatRerankResponse(response);
            return {
                content: [{
                        type: 'text',
                        text: formatted + formatRoutingInfo(response),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_models
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.MODELS, TOOL_DESCRIPTIONS[TOOL_NAMES.MODELS], modelsParams, async (params) => {
        await initAdapters();
        try {
            let models = [...state.candidates];
            // Apply modality filter
            if (params.modality) {
                models = models.filter((m) => m.modality === params.modality);
            }
            // Apply provider filter
            if (params.provider) {
                models = models.filter((m) => m.providerId.toLowerCase().includes(params.provider.toLowerCase()));
            }
            // If no candidates loaded, list from adapters
            if (models.length === 0 && state.candidates.length === 0) {
                const adapterModels = [];
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
                        }
                        catch (listErr) {
                            // Adapter not initialized — skip but log for debugging
                            logger.warn({ err: listErr }, 'Failed to list models from adapter');
                        }
                    }
                }
                return {
                    content: [{
                            type: 'text',
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
                        type: 'text',
                        text: JSON.stringify({
                            source: 'registry',
                            count: formatted.length,
                            models: formatted,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_status
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.STATUS, TOOL_DESCRIPTIONS[TOOL_NAMES.STATUS], statusParams, async (params) => {
        await initAdapters();
        try {
            const uptimeMs = Date.now() - state.startTime;
            const uptimeHours = Math.floor(uptimeMs / 3600000);
            const uptimeMinutes = Math.floor((uptimeMs % 3600000) / 60000);
            const status = {
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
                const providerHealth = {};
                for (const providerId of state.adapterRegistry.list()) {
                    const adapter = state.adapterRegistry.get(providerId);
                    if (adapter) {
                        try {
                            const health = await adapter.healthCheck();
                            providerHealth[providerId] = {
                                healthy: health.healthy,
                                modalities: adapter.supportedModalities,
                            };
                        }
                        catch {
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
                const modelsByModality = {};
                for (const candidate of state.candidates) {
                    modelsByModality[candidate.modality] = (modelsByModality[candidate.modality] || 0) + 1;
                }
                status.modelsByModality = modelsByModality;
                status.totalModels = state.candidates.length;
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(status, null, 2),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_batch
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.BATCH, TOOL_DESCRIPTIONS[TOOL_NAMES.BATCH], batchParams, async (params) => {
        await initAdapters();
        state.requestCount++;
        try {
            const calls = (params.calls || []);
            const continueOnFail = params.continue_on_fail !== false;
            const results = [];
            for (const call of calls) {
                try {
                    const output = await executeDMRXTool(state.router, state.adapterRegistry, call.tool, call.parameters || {});
                    results.push({ tool: call.tool, success: true, output });
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : 'Unknown error';
                    results.push({ tool: call.tool, success: false, error: message });
                    if (!continueOnFail) {
                        throw err;
                    }
                }
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ success: true, results }, null, 2),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_context_save
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.CONTEXT_SAVE, TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_SAVE], contextSaveParams, async (params) => {
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
                        type: 'text',
                        text: JSON.stringify({ success: true, context_id: id, message: 'Context saved' }, null, 2),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_context_load
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.CONTEXT_LOAD, TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_LOAD], contextLoadParams, async (params) => {
        await initAdapters();
        state.requestCount++;
        try {
            const cacheStore = getContextStore();
            const cached = cacheStore.get(`context:${params.id}`);
            if (!cached) {
                throw new Error(`Context not found: ${params.id}`);
            }
            const context = JSON.parse(cached);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ success: true, context }, null, 2),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_context_list
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.CONTEXT_LIST, TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_LIST], contextListParams, async (params) => {
        await initAdapters();
        state.requestCount++;
        try {
            const limit = params.limit || 20;
            const cacheStore = getContextStore();
            const keys = cacheStore.keys(`context:*`);
            const contexts = [];
            for (const key of keys) {
                const cached = cacheStore.get(key);
                if (cached) {
                    const ctx = JSON.parse(cached);
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
                        type: 'text',
                        text: JSON.stringify({ success: true, count: sliced.length, contexts: sliced }, null, 2),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_context_summarize
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.CONTEXT_SUMMARIZE, TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_SUMMARIZE], contextSummarizeParams, async (params) => {
        await initAdapters();
        state.requestCount++;
        try {
            const cacheStore = getContextStore();
            const cached = cacheStore.get(`context:${params.id}`);
            if (!cached) {
                throw new Error(`Context not found: ${params.id}`);
            }
            const context = JSON.parse(cached);
            const messages = context.messages || [];
            let summary = `Context (${messages.length} messages):\n`;
            for (const msg of messages.slice(-10)) {
                summary += `- ${msg.role}: ${(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)).slice(0, 100)}\n`;
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ success: true, context_id: params.id, summary }, null, 2),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_context_compress
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.CONTEXT_COMPRESS, TOOL_DESCRIPTIONS[TOOL_NAMES.CONTEXT_COMPRESS], contextCompressParams, async (params) => {
        await initAdapters();
        state.requestCount++;
        try {
            const cacheStore = getContextStore();
            const cached = cacheStore.get(`context:${params.id}`);
            if (!cached) {
                throw new Error(`Context not found: ${params.id}`);
            }
            const context = JSON.parse(cached);
            let messages = context.messages || [];
            const targetTokens = params.target_tokens || 500;
            const maxMessages = Math.max(1, Math.floor(targetTokens / 50));
            if (messages.length > maxMessages) {
                const keepRecent = messages.slice(-Math.ceil(maxMessages / 2));
                const keepOlder = messages.slice(0, Math.floor(maxMessages / 2)).filter((m) => m.role === 'system' || m.role === 'user');
                messages = [...keepOlder, ...keepRecent];
            }
            const compressed = { ...context, messages, compressed_at: new Date().toISOString() };
            cacheStore.set(`context:${params.id}`, JSON.stringify(compressed), context.ttl_seconds || 86400);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ success: true, context_id: params.id, messages_kept: messages.length }, null, 2),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_chat_stream
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.CHAT_STREAM, TOOL_DESCRIPTIONS[TOOL_NAMES.CHAT_STREAM], chatStreamParams, async (params) => {
        await initAdapters();
        state.requestCount++;
        try {
            const request = toUnifiedRequest('llm', params);
            request.stream = true;
            const classifyOptions = {
                path: MODALITY_TO_PATH['llm'],
                qualityTarget: params.quality_target || 'balanced',
            };
            const adapter = state.adapterRegistry.get('openai');
            if (!adapter || !adapter.executeStream) {
                throw new Error('Streaming not supported by current adapter configuration');
            }
            const stream = adapter.executeStream(request);
            const chunks = [];
            for await (const chunk of stream) {
                if (chunk.type === 'token') {
                    const tokenChunk = chunk;
                    chunks.push(tokenChunk.data?.content || '');
                }
            }
            const fullText = chunks.join('');
            const response = {
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
                        type: 'text',
                        text: formatted + formatRoutingInfo(response),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_generate_image_stream
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.GENERATE_IMAGE_STREAM, TOOL_DESCRIPTIONS[TOOL_NAMES.GENERATE_IMAGE_STREAM], imageStreamParams, async (params) => {
        await initAdapters();
        state.requestCount++;
        try {
            const request = toUnifiedRequest('diffusion', params);
            request.stream = true;
            const classifyOptions = {
                path: MODALITY_TO_PATH['diffusion'],
                qualityTarget: params.quality_target || 'balanced',
            };
            const adapter = state.adapterRegistry.get('stability') || state.adapterRegistry.get('replicate');
            if (!adapter || !adapter.executeStream) {
                throw new Error('Streaming image generation not supported by current adapter configuration');
            }
            const stream = adapter.executeStream(request);
            const updates = [];
            for await (const chunk of stream) {
                updates.push(JSON.stringify(chunk));
            }
            const response = {
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
                        type: 'text',
                        text: JSON.stringify({ updates, final: JSON.parse(formatted) }, null, 2),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    // -----------------------------------------------------------------------
    // Tool: dmrx_workflow
    // -----------------------------------------------------------------------
    server.tool(TOOL_NAMES.WORKFLOW, TOOL_DESCRIPTIONS[TOOL_NAMES.WORKFLOW], workflowParams, async (params) => {
        await initAdapters();
        state.requestCount++;
        try {
            const steps = params.steps || [];
            const failFast = params.fail_fast !== false;
            const results = [];
            const stepOutputs = {};
            for (const step of steps) {
                try {
                    let stepParams = { ...(step.parameters || {}) };
                    if (step.input_mapping) {
                        const mapping = step.input_mapping;
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
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : 'Unknown error';
                    results.push({ step_id: step.id, tool: step.tool, success: false, error: message });
                    if (failFast) {
                        throw err;
                    }
                }
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ success: true, results, step_outputs: stepOutputs }, null, 2),
                    }],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            state.lastError = message;
            return {
                content: [{ type: 'text', text: `Error: ${message}` }],
                isError: true,
            };
        }
    });
    return { server, state };
}
// -----------------------------------------------------------------------
// Internal helpers for new tools
// -----------------------------------------------------------------------
function getContextStore() {
    const store = new Map();
    return {
        get(key) {
            const entry = store.get(key);
            if (!entry)
                return null;
            if (Date.now() > entry.expiresAt) {
                store.delete(key);
                return null;
            }
            return entry.value;
        },
        set(key, value, ttl) {
            store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
        },
        keys(prefix) {
            const result = [];
            for (const [key] of store) {
                if (key.startsWith(prefix))
                    result.push(key);
            }
            return result;
        },
        delete(key) {
            store.delete(key);
        },
    };
}
function extractFromOutputs(ref, outputs, results) {
    if (ref.startsWith('$')) {
        const stepId = ref.slice(1);
        return outputs[stepId];
    }
    if (ref.startsWith('steps.')) {
        const stepId = ref.slice(6);
        for (const r of results) {
            if (r.step_id === stepId && r.output)
                return r.output;
        }
    }
    return undefined;
}
function setNestedValue(obj, path, value) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (!(key in current)) {
            current[key] = {};
        }
        current = current[key];
    }
    current[parts[parts.length - 1]] = value;
}
async function executeDMRXTool(router, _adapterRegistry, toolName, params) {
    let modality = 'llm';
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
        default:
            throw new Error(`Unsupported tool in batch: ${toolName}`);
    }
    const request = toUnifiedRequest(modality, params);
    const classifyOptions = {
        path,
        qualityTarget: params.quality_target || 'balanced',
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
        default:
            return { response };
    }
}
//# sourceMappingURL=server.js.map