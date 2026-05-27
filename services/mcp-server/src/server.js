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
import { ElevenLabsAdapter, DeepgramAdapter } from '@dmr-x/adapters';
import { CohereAdapter, JinaAdapter } from '@dmr-x/adapters';
import { TOOL_NAMES, TOOL_DESCRIPTIONS, dmrxChatParams as chatParams, dmrxGenerateImageParams as imageParams, dmrxEmbedParams as embedParams, dmrxTranscribeParams as transcribeParams, dmrxSpeakParams as speakParams, dmrxRerankParams as rerankParams, dmrxModelsParams as modelsParams, dmrxStatusParams as statusParams, } from './tools.js';
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
            catch {
                // Adapter not configured — skip silently
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
    };
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
                        catch {
                            // Adapter not initialized — skip
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
    return { server, state };
}
//# sourceMappingURL=server.js.map