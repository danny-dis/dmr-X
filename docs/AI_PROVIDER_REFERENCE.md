# AI Provider Reference (2026)

Comprehensive catalog of 100+ AI providers with API details for adapter configuration.
DMR-X ships 20+ first-class adapters (see "Local & Specialized Adapters" at the end) plus
a `GenericOpenAIAdapter` that handles any OpenAI-compatible provider (OpenRouter, Together,
Fireworks, Groq, Cerebras, SambaNova, etc.) without custom code.

> **Note**: Prices and model lists reflect known state circa early 2026. Always verify against provider docs before building adapters.

> **Adapter inventory** (see `services/adapters/src/index.ts`): OpenAI, Anthropic,
> Ollama, GenericOpenAI, Replicate, Stability, ComfyUI, FAL.ai, Runway, Veo,
> ElevenLabs, Deepgram, Kokoro, Piper, Cohere, Jina, TEI. Total: **18 adapters**.

---

## 1. CLOUD LLM PROVIDERS

### 1.1 OpenAI

| Field | Value |
|---|---|
| **API Base** | `https://api.openai.com/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | Native (de facto industry standard) |
| **Modalities** | llm, embedding, audio_tts, audio_stt, image_gen, vision |
| **Notable Models** | `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `o1`, `o1-mini`, `o1-pro`, `o3`, `o3-mini`, `o4-mini`, `gpt-4o-audio-preview`, `dall-e-3`, `tts-1`, `tts-1-hd`, `whisper-1`, `text-embedding-3-small`, `text-embedding-3-large`, `codex-mini` |
| **Rate Limits** | Tier-based: Tier 1 ~500 RPM, Tier 5 ~10,000 RPM for GPT-4o |
| **Pricing** | Per-token (input/output split). GPT-4o: ~$2.50/$10 per 1M tokens. Embeddings: ~$0.02/1M tokens |
| **Streaming** | Yes (SSE) |
| **Tool/Function Calling** | Yes (native, structured outputs) |
| **Notes** | Supports JSON mode, response format, parallel tool calls, vision (image URLs/base64 in messages) |

---

### 1.2 Anthropic (Claude)

| Field | Value |
|---|---|
| **API Base** | `https://api.anthropic.com/v1` |
| **Auth** | `x-api-key: <key>` header |
| **API Format** | Custom (Messages API) |
| **Modalities** | llm, vision |
| **Notable Models** | `claude-opus-4-0520`, `claude-sonnet-4-0520`, `claude-3.7-sonnet`, `claude-3.5-sonnet`, `claude-3.5-haiku`, `claude-3-opus` |
| **Rate Limits** | Tier-based: ~50 RPM (Free), ~1000 RPM (Tier 4) |
| **Pricing** | Per-token. Sonnet 4: ~$3/$15 per 1M tokens. Haiku: ~$0.80/$4 per 1M |
| **Streaming** | Yes (SSE) |
| **Tool/Function Calling** | Yes (native tool_use blocks) |
| **Notes** | Requires `anthropic-version` header. Supports extended thinking, PDF input, 200K context. Not OpenAI-compatible (different message format with `system` as top-level param). |

---

### 1.3 Google (Gemini)

| Field | Value |
|---|---|
| **API Base** | `https://generativelanguage.googleapis.com/v1beta` (Gemini API) or `https://aiplatform.googleapis.com/v1` (Vertex AI) |
| **Auth** | API key param `?key=<key>` or OAuth2 bearer token (Vertex) |
| **API Format** | Custom (Gemini API) or Vertex AI format |
| **Modalities** | llm, vision, embedding, audio_stt, image_gen (Imagen) |
| **Notable Models** | `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-2.0-pro`, `gemini-1.5-pro`, `gemini-1.5-flash`, `text-embedding-004`, `imagen-3.0` |
| **Rate Limits** | Free tier: 15 RPM. Pay-as-you-go: ~1000 RPM |
| **Pricing** | Per-token. Gemini 2.5 Pro: ~$1.25/$5 per 1M tokens (under 200K). Flash: ~$0.15/$0.60 |
| **Streaming** | Yes (SSE via `streamGenerateContent`) |
| **Tool/Function Calling** | Yes (native function calling with JSON schema) |
| **Notes** | Supports grounding with Google Search, code execution, 1M+ context window. Vertex AI offers more enterprise features. |

---

### 1.4 Meta (Llama via API)

| Field | Value |
|---|---|
| **API Base** | No single official API; available via partners: `https://api.together.xyz`, `https://api.fireworks.ai`, `https://console.groq.com`, official at `https://api.llama.com/v1` (Meta Llama API, launched 2025) |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | OpenAI-compatible (via partners). Meta's own API uses custom format |
| **Modalities** | llm, vision (Llama 3.2 Vision) |
| **Notable Models** | `llama-4-maverick`, `llama-4-scout`, `llama-3.3-70b`, `llama-3.2-90b-vision`, `llama-3.1-405b`, `llama-3.1-70b`, `llama-3.1-8b` |
| **Rate Limits** | Varies by hosting partner |
| **Pricing** | Varies by partner. Groq: ~$0.59/$0.79 per 1M (Llama 3.3 70B). Together: ~$0.88/$0.88 |
| **Streaming** | Yes (via partners) |
| **Tool/Function Calling** | Yes (Llama 3.1+ supports tool use) |
| **Notes** | Open-weight models. Best accessed through hosting partners. Meta Llama API is newer and more limited. |

---

### 1.5 Mistral AI

| Field | Value |
|---|---|
| **API Base** | `https://api.mistral.ai/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | OpenAI-compatible |
| **Modalities** | llm, vision, embedding, agent (Le Chat / agents) |
| **Notable Models** | `mistral-large-latest`, `mistral-medium-latest`, `mistral-small-latest`, `codestral-latest`, `pixtral-large-latest`, `ministral-8b-latest`, `ministral-3b-latest`, `mistral-embed`, `mistral-ocr` |
| **Rate Limits** | Tier-based, ~500 RPM on standard tier |
| **Pricing** | Per-token. Large: ~$2/$6 per 1M. Small: ~$0.10/$0.30 |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (native, OpenAI-compatible format) |
| **Notes** | Also offers La Plateforme for fine-tuning. Supports JSON mode, function calling. Codestral for code. |

---

### 1.6 Cohere

| Field | Value |
|---|---|
| **API Base** | `https://api.cohere.com/v2` (v2) or `https://api.cohere.ai/v1` (legacy) |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | Custom (Cohere format), also OpenAI-compatible endpoint available |
| **Modalities** | llm, embedding, reranking, audio_stt (Whisper compat) |
| **Notable Models** | `command-a`, `command-r-plus`, `command-r`, `command-light`, `embed-v4`, `embed-english-v3.0`, `embed-multilingual-v3.0`, `rerank-v3.5`, `rerank-english-v3.0` |
| **Rate Limits** | ~100 RPM trial, ~1000 RPM production |
| **Pricing** | Per-token. Command R+: ~$2.50/$10 per 1M. Embed: ~$0.10/1M |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (native tool use in Command R+) |
| **Notes** | Strong at RAG, search, and enterprise. Excellent embedding and reranking models. |

---

### 1.7 AI21 Labs

| Field | Value |
|---|---|
| **API Base** | `https://api.ai21.com/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | OpenAI-compatible (v1) and legacy custom format |
| **Modalities** | llm |
| **Notable Models** | `jamba-1.5-large`, `jamba-1.5-mini`, `jamba-instruct`, `jurassic-2-ultra`, `jurassic-2-mid` |
| **Rate Limits** | ~60 RPM standard |
| **Pricing** | Per-token. Jamba 1.5 Large: ~$2/$8 per 1M |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (Jamba models) |
| **Notes** | Jamba models use hybrid Transformer-Mamba architecture. Long context (256K). |

---

### 1.8 Aleph Alpha

| Field | Value |
|---|---|
| **API Base** | `https://api.aleph-alpha.com` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | Custom |
| **Modalities** | llm, embedding |
| **Notable Models** | `luminous-base`, `luminous-extended`, `luminous-supreme`, `luminous-supreme-control` |
| **Rate Limits** | Enterprise-tiered |
| **Pricing** | Per-token |
| **Streaming** | Yes |
| **Tool/Function Calling** | Limited |
| **Notes** | European AI company focused on sovereignty. Supports multimodal (text+image). Less widely used than US/Chinese competitors. |

---

### 1.9 Inflection AI (Pi)

| Field | Value |
|---|---|
| **API Base** | `https://api.inflection.ai` (enterprise) |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | Custom |
| **Modalities** | llm |
| **Notable Models** | `inflection-3-pi`, `inflection-3-productivity` |
| **Rate Limits** | Enterprise-negotiated |
| **Pricing** | Enterprise pricing |
| **Streaming** | Yes |
| **Tool/Function Calling** | Limited |
| **Notes** | Originally built Pi chatbot. Pivoted to enterprise AI. Microsoft acquired much of the team in 2024. |

---

### 1.10 xAI (Grok)

| Field | Value |
|---|---|
| **API Base** | `https://api.x.ai/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | OpenAI-compatible |
| **Modalities** | llm, vision, image_gen (Aurora/Flux) |
| **Notable Models** | `grok-3`, `grok-3-mini`, `grok-2`, `grok-2-vision`, `grok-2-image` |
| **Rate Limits** | Tier-based |
| **Pricing** | Per-token. Grok 3: ~$3/$15 per 1M. Grok 3 Mini: ~$0.30/$0.50 |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (OpenAI-compatible format) |
| **Notes** | Access to X/Twitter data for grounding. Grok 3 is competitive with GPT-4o. |

---

### 1.11 DeepSeek

| Field | Value |
|---|---|
| **API Base** | `https://api.deepseek.com/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | OpenAI-compatible |
| **Modalities** | llm |
| **Notable Models** | `deepseek-chat` (DeepSeek-V3), `deepseek-reasoner` (DeepSeek-R1), `deepseek-coder` |
| **Rate Limits** | ~60 RPM standard, higher on paid |
| **Pricing** | Per-token. V3: ~$0.27/$1.10 per 1M. R1: ~$0.55/$2.19 per 1M |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (OpenAI-compatible) |
| **Notes** | Very cost-effective. R1 reasoning model is strong. Open-weight models available. |

---

### 1.12 Moonshot AI (Kimi)

| Field | Value |
|---|---|
| **API Base** | `https://api.moonshot.cn/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | OpenAI-compatible |
| **Modalities** | llm, vision |
| **Notable Models** | `moonshot-v1-128k`, `moonshot-v1-32k`, `moonshot-v1-8k`, `kimi-latest` |
| **Rate Limits** | ~60 RPM |
| **Pricing** | Per-token. ~$1.40/$1.40 per 1M (128K model) |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes |
| **Notes** | Chinese provider with strong long-context capabilities. Kimi chatbot popular in China. |

---

### 1.13 Xiaomi (MiMo)

| Field | Value |
|---|---|
| **API Base** | Via Xiaomi AI platform (limited availability) |
| **Auth** | API key |
| **API Format** | OpenAI-compatible (when available via third-party hosting) |
| **Modalities** | llm |
| **Notable Models** | `MiMo-7B` (open-weight reasoning model) |
| **Rate Limits** | N/A (primarily open-weight) |
| **Pricing** | Free (open-weight). Hosting costs vary |
| **Streaming** | Yes (when self-hosted) |
| **Tool/Function Calling** | Limited |
| **Notes** | Open-weight reasoning model. Primarily self-hosted or via Together/Fireworks. |

---

### 1.14 Baichuan

| Field | Value |
|---|---|
| **API Base** | `https://api.baichuan-ai.com/v1` |
| **Auth** | `Authorization: Bearer <key>` (with custom header `X-BC-Signature`) |
| **API Format** | Custom (similar to OpenAI but with signature auth) |
| **Modalities** | llm, embedding |
| **Notable Models** | `Baichuan4`, `Baichuan3-Turbo`, `Baichuan2-Turbo`, `Baichuan-Text-Embedding` |
| **Rate Limits** | ~60 RPM |
| **Pricing** | Per-token. ~$1.40/$1.40 per 1M (Baichuan4) |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (Baichuan4) |
| **Notes** | Chinese AI company. Requires signature-based authentication alongside API key. |

---

### 1.15 Zhipu AI (GLM / ChatGLM)

| Field | Value |
|---|---|
| **API Base** | `https://open.bigmodel.cn/api/paas/v4` |
| **Auth** | `Authorization: Bearer <key>` (JWT token generated from API key + secret) |
| **API Format** | OpenAI-compatible |
| **Modalities** | llm, vision, image_gen (CogView), video (CogVideo), embedding |
| **Notable Models** | `glm-4-plus`, `glm-4-flash`, `glm-4-long`, `glm-4v-plus`, `cogview-3-plus`, `cogvideox`, `embedding-3` |
| **Rate Limits** | ~60 RPM standard |
| **Pricing** | Per-token. GLM-4-Plus: ~$7.14/$7.14 per 1M. Flash: free tier available |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (GLM-4 supports function calling) |
| **Notes** | Auth requires generating JWT from API key ID + secret. Strong multimodal capabilities. |

---

### 1.16 01.AI (Yi)

| Field | Value |
|---|---|
| **API Base** | `https://api.01.ai/v1` or via `https://api.lingyiwanwu.com/v1` (domestic) |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | OpenAI-compatible |
| **Modalities** | llm, vision |
| **Notable Models** | `yi-lightning`, `yi-large`, `yi-medium`, `yi-spark`, `yi-vision-plus` |
| **Rate Limits** | ~60 RPM |
| **Pricing** | Per-token. Yi-Lightning: ~$0.99/$0.99 per 1M |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes |
| **Notes** | Founded by Kai-Fu Yi. Yi models are also open-weight. Strong bilingual (EN/CN). |

---

### 1.17 Databricks (DBRX / Foundation Model APIs)

| Field | Value |
|---|---|
| **API Base** | `https://<workspace>.databricks.com/serving-endpoints` |
| **Auth** | `Authorization: Bearer <databricks-token>` |
| **API Format** | OpenAI-compatible (via serving endpoints) |
| **Modalities** | llm, embedding |
| **Notable Models** | `dbrx`, `llama-3.3-70b`, `mixtral-8x7b`, `bge-large-en-v1.5` (varies by workspace) |
| **Rate Limits** | Per-endpoint, configurable by provisioned throughput |
| **Pricing** | Per-token via Databricks Model Serving or Provisioned Throughput |
| **Streaming** | Yes |
| **Tool/Function Calling** | Depends on hosted model |
| **Notes** | Enterprise platform. DBRX is their open MoE model. Unity Catalog integration. |

---

### 1.18 Snowflake (Cortex AI)

| Field | Value |
|---|---|
| **API Base** | `https://<account>.snowflakecomputing.com/api/v2/cortex` |
| **Auth** | Snowflake session token / JWT |
| **API Format** | Custom (SQL-based and REST) |
| **Modalities** | llm, embedding |
| **Notable Models** | `snowflake-arctic`, `llama-3.3-70b`, `mistral-large` (hosted within Snowflake) |
| **Rate Limits** | Per-warehouse, configurable |
| **Pricing** | Credits-based (Snowflake credits) |
| **Streaming** | Limited |
| **Tool/Function Calling** | Via Cortex Analyst |
| **Notes** | Enterprise data platform. Arctic is their open model optimized for SQL/enterprise. |

---

### 1.19 Writer

| Field | Value |
|---|---|
| **API Base** | `https://api.writer.com/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | Custom (also offers OpenAI-compatible) |
| **Modalities** | llm, image_gen (Palmyra Vision) |
| **Notable Models** | `palmyra-x-004`, `palmyra-x-003`, `palmyra-vision`, `palmyra-creative` |
| **Rate Limits** | Enterprise-tiered |
| **Pricing** | Per-token |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes |
| **Notes** | Enterprise-focused AI platform. Emphasis on brand governance and content. |

---

### 1.20 Voyage AI

| Field | Value |
|---|---|
| **API Base** | `https://api.voyageai.com/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | Custom (similar to OpenAI embeddings endpoint) |
| **Modalities** | embedding, reranking |
| **Notable Models** | `voyage-3`, `voyage-3-lite`, `voyage-code-3`, `voyage-law-2`, `voyage-finance-2`, `rerank-2` |
| **Rate Limits** | ~1000 RPM |
| **Pricing** | Per-token. Voyage-3: ~$0.06/1M tokens |
| **Streaming** | N/A (embedding/reranking) |
| **Tool/Function Calling** | N/A |
| **Notes** | Best-in-class embedding models. Domain-specific variants (code, law, finance). |

---

## 2. CLOUD DIFFUSION PROVIDERS

### 2.1 Stability AI

| Field | Value |
|---|---|
| **API Base** | `https://api.stability.ai/v2beta` (v2) or `https://api.stability.ai/v1` (legacy) |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | Custom REST |
| **Modalities** | image_gen, image_edit, video (Stable Video) |
| **Notable Models** | `stable-diffusion-3.5-large`, `stable-diffusion-3.5-medium`, `stable-image-ultra`, `stable-image-core`, `sd3-large-turbo`, `stable-video-diffusion` |
| **Rate Limits** | ~150 credits/sec (tier-based) |
| **Pricing** | Per-generation (credits). SD3.5 Large: ~6.5 credits/image |
| **Streaming** | N/A (image generation) |
| **Tool/Function Calling** | N/A |
| **Notes** | Offers ControlNet, inpainting, upscaling. Also provides SDXL via API. |

---

### 2.2 Midjourney

| Field | Value |
|---|---|
| **API Base** | `https://api.midjourney.com/v1` (official API launched ~2025) |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | Custom REST |
| **Modalities** | image_gen, image_edit |
| **Notable Models** | `midjourney-v7`, `midjourney-v6.1`, `midjourney-niji` |
| **Rate Limits** | Subscription-tiered |
| **Pricing** | Subscription-based (Basic $10/mo, Standard $30/mo, Pro $60/mo) with per-image costs |
| **Streaming** | N/A |
| **Tool/Function Calling** | N/A |
| **Notes** | Long available only via Discord. Official REST API launched later. High aesthetic quality. |

---

### 2.3 Leonardo AI

| Field | Value |
|---|---|
| **API Base** | `https://cloud.leonardo.ai/api/rest/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | Custom REST (GraphQL also available) |
| **Modalities** | image_gen, image_edit |
| **Notable Models** | `Leonardo Phoenix`, `Leonardo Kino XL`, `Leonardo Vision XL`, `AlbedoBase XL` |
| **Rate Limits** | Token-based (daily token allowance per plan) |
| **Pricing** | Freemium/subscription. API usage via tokens per plan |
| **Streaming** | N/A |
| **Tool/Function Calling** | N/A |
| **Notes** | Also offers fine-tuning (LoRA training) via API. |

---

### 2.4 RunwayML

| Field | Value |
|---|---|
| **API Base** | `https://api.dev.runwayml.com/v1` (beta) |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | Custom REST |
| **Modalities** | image_gen, video |
| **Notable Models** | `Gen-3 Alpha Turbo`, `Gen-3 Alpha` |
| **Rate Limits** | Subscription-tiered |
| **Pricing** | Credit-based |
| **Streaming** | N/A (async generation, poll for result) |
| **Tool/Function Calling** | N/A |
| **Notes** | Best known for video generation. Image-to-video and text-to-video. |

---

### 2.5 Pika Labs

| Field | Value |
|---|---|
| **API Base** | `https://api.pika.art/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | Custom REST |
| **Modalities** | video, image_gen |
| **Notable Models** | `pika-2.0`, `pika-1.5` |
| **Rate Limits** | Credit-based |
| **Pricing** | Credit-based per generation |
| **Streaming** | N/A (async) |
| **Tool/Function Calling** | N/A |
| **Notes** | Video generation with special effects (Pika Effects). |

---

### 2.6 Ideogram

| Field | Value |
|---|---|
| **API Base** | `https://api.ideogram.ai/v1` |
| **Auth** | `Authorization: Bearer <key>` or `Api-Key: <key>` |
| **API Format** | Custom REST |
| **Modalities** | image_gen, image_edit |
| **Notable Models** | `V_2A`, `V_2`, `V_1` |
| **Rate Limits** | ~5 RPM (free), ~300 RPM (enterprise) |
| **Pricing** | Credit-based. ~$0.08/image (V_2 Turbo) |
| **Streaming** | N/A |
| **Tool/Function Calling** | N/A |
| **Notes** | Best-in-class text rendering in images. Good for logos and typography. |

---

### 2.7 Black Forest Labs (Flux)

| Field | Value |
|---|---|
| **API Base** | `https://api.bfl.ml/v1` |
| **Auth** | `X-Key: <key>` |
| **API Format** | Custom REST |
| **Modalities** | image_gen, image_edit |
| **Notable Models** | `flux-pro-1.1`, `flux-pro`, `flux-dev`, `flux-schnell` |
| **Rate Limits** | ~50 RPM |
| **Pricing** | Per-generation. Flux Pro: ~$0.05/image |
| **Streaming** | N/A (async polling) |
| **Tool/Function Calling** | N/A |
| **Notes** | Founded by original Stable Diffusion creators. Flux models are also open-weight. Flux Schnell is very fast. |

---

## 3. CLOUD AUDIO PROVIDERS

### 3.1 ElevenLabs

| Field | Value |
|---|---|
| **API Base** | `https://api.elevenlabs.io/v1` |
| **Auth** | `xi-api-key: <key>` |
| **API Format** | Custom REST |
| **Modalities** | audio_tts, audio_stt, voice_clone, sfx |
| **Notable Models** | `eleven_multilingual_v2`, `eleven_turbo_v2_5`, `eleven_monolingual_v1`, `eleven_flash_v2_5`, `scribe` (STT) |
| **Rate Limits** | Character-based per plan (free: 10K chars/mo) |
| **Pricing** | Subscription + character-based. Starter: $5/mo (30K chars). Scale: $99/mo |
| **Streaming** | Yes (WebSocket and HTTP streaming) |
| **Tool/Function Calling** | N/A |
| **Notes** | Industry-leading voice cloning and TTS quality. Supports 29+ languages. Sound effects generation available. |

---

### 3.2 Deepgram

| Field | Value |
|---|---|
| **API Base** | `https://api.deepgram.com/v1` |
| **Auth** | `Authorization: Token <key>` |
| **API Format** | Custom REST and WebSocket |
| **Modalities** | audio_stt, audio_tts, audio_intelligence |
| **Notable Models** | `nova-2`, `nova-2-medical`, `whisper-large`, `aura` (TTS) |
| **Rate Limits** | Pay-per-use, no hard RPM limits |
| **Pricing** | Per-second of audio. Nova-2: ~$0.0043/min (Pay-as-you-go) |
| **Streaming** | Yes (WebSocket for real-time STT) |
| **Tool/Function Calling** | N/A |
| **Notes** | Very fast STT. Supports real-time streaming, diarization, summarization. |

---

### 3.3 AssemblyAI

| Field | Value |
|---|---|
| **API Base** | `https://api.assemblyai.com/v2` |
| **Auth** | `Authorization: <key>` (no "Bearer" prefix) |
| **API Format** | Custom REST |
| **Modalities** | audio_stt, audio_intelligence |
| **Notable Models** | `Universal-2`, `Universal-1`, `slam` (streaming) |
| **Rate Limits** | Pay-per-use |
| **Pricing** | Per-second. ~$0.015/min (LeMUR extra for LLM features) |
| **Streaming** | Yes (WebSocket real-time) |
| **Tool/Function Calling** | N/A |
| **Notes** | Strong at speaker diarization, content moderation, PII redaction. LeMUR for audio LLM features. |

---

### 3.4 PlayHT

| Field | Value |
|---|---|
| **API Base** | `https://api.play.ht/api/v2` |
| **Auth** | `Authorization: Bearer <key>` + `X-User-Id: <user-id>` |
| **API Format** | Custom REST |
| **Modalities** | audio_tts, voice_clone |
| **Notable Models** | `PlayHT2.0`, `PlayHT2.0-turbo`, `Play3.0-mini` |
| **Rate Limits** | Character-based per plan |
| **Pricing** | Subscription-based. Creator: $31/mo (3M chars/yr) |
| **Streaming** | Yes (WebSocket streaming TTS) |
| **Tool/Function Calling** | N/A |
| **Notes** | Good voice cloning. Supports many voices and languages. |

---

### 3.5 Resemble AI

| Field | Value |
|---|---|
| **API Base** | `https://app.resemble.ai/api/v2` |
| **Auth** | `Authorization: Bearer <key>` or `X-Api-Token: <key>` |
| **API Format** | Custom REST |
| **Modalities** | audio_tts, voice_clone, audio_stt (via partners) |
| **Notable Models** | `resemble-v2`, `resemble-v1` |
| **Rate Limits** | Per-character credits |
| **Pricing** | Pay-per-character |
| **Streaming** | Yes |
| **Tool/Function Calling** | N/A |
| **Notes** | Focused on enterprise voice cloning. Offers real-time voice conversion. |

---

### 3.6 OpenAI Whisper (STT)

| Field | Value |
|---|---|
| **API Base** | `https://api.openai.com/v1/audio` |
| **Auth** | `Authorization: Bearer <key>` (same as OpenAI) |
| **API Format** | Multipart form upload |
| **Modalities** | audio_stt |
| **Notable Models** | `whisper-1` (large-v3) |
| **Rate Limits** | Same as OpenAI tier limits |
| **Pricing** | Per-minute: ~$0.006/min |
| **Streaming** | No (batch file upload only) |
| **Tool/Function Calling** | N/A |
| **Notes** | Also available open-source for local deployment. Supports 97 languages. |

---

## 4. CLOUD VIDEO PROVIDERS

### 4.1 RunwayML (see also 2.4)

Video generation via Gen-3 Alpha. Async API with polling.

### 4.2 Pika Labs (see also 2.5)

Video generation with effects. Async API.

### 4.3 Synthesia

| Field | Value |
|---|---|
| **API Base** | `https://api.synthesia.io/v2` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | Custom REST |
| **Modalities** | video (avatar-based) |
| **Notable Models** | Proprietary avatar system |
| **Rate Limits** | Per-plan video minutes |
| **Pricing** | Subscription-based. Starter: $22/mo (10 min/mo) |
| **Streaming** | No (async generation, 10-15 min turnaround) |
| **Tool/Function Calling** | N/A |
| **Notes** | AI avatar video generation. Text-to-video with digital presenters. 230+ avatars, 140+ languages. |

---

### 4.4 HeyGen

| Field | Value |
|---|---|
| **API Base** | `https://api.heygen.com/v2` |
| **Auth** | `X-Api-Key: <key>` |
| **API Format** | Custom REST |
| **Modalities** | video (avatar-based), voice_clone |
| **Notable Models** | Proprietary (Avatar 3.0, Avatar v2) |
| **Rate Limits** | Credit-based per plan |
| **Pricing** | Subscription. Free: 1 min. Creator: $29/mo (15 min/mo) |
| **Streaming** | Yes (Streaming Avatar API for real-time) |
| **Tool/Function Calling** | N/A |
| **Notes** | Real-time streaming avatar API available. Video translation and lip-sync. |

---

## 5. CLOUD EMBEDDING PROVIDERS

### 5.1 OpenAI Embeddings (see also 1.1)

`text-embedding-3-small` (1536d), `text-embedding-3-large` (3072d). ~$0.02-0.13/1M tokens.

### 5.2 Cohere Embeddings (see also 1.6)

`embed-v4` (1024d), `embed-english-v3.0`, `embed-multilingual-v3.0`. Excellent for search and RAG. Supports `search_document`, `search_query`, `classification`, `clustering` input types.

### 5.3 Jina AI

| Field | Value |
|---|---|
| **API Base** | `https://api.jina.ai/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | OpenAI-compatible (embeddings endpoint) |
| **Modalities** | embedding, reranking, segment (long doc chunking) |
| **Notable Models** | `jina-embeddings-v3`, `jina-embeddings-v2-base-en`, `jina-reranker-v2-base-multilingual`, `jina-colbert-v2` |
| **Rate Limits** | ~200 RPM (free), higher on paid |
| **Pricing** | Per-token. Embeddings v3: ~$0.02/1M tokens |
| **Streaming** | N/A (embedding) |
| **Tool/Function Calling** | N/A |
| **Notes** | 8K token input length. Supports task-specific embedding (search, classification, etc.). ColBERT-style late interaction reranker. |

---

### 5.4 Voyage AI (see also 1.20)

Top-tier embeddings. `voyage-3` (1024d), `voyage-code-3`, domain-specific variants.

### 5.5 Nomic AI

| Field | Value |
|---|---|
| **API Base** | `https://api-atlas.nomic.ai/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | OpenAI-compatible |
| **Modalities** | embedding |
| **Notable Models** | `nomic-embed-text-v1.5`, `nomic-embed-text-v2-moe` |
| **Rate Limits** | ~5000 RPM |
| **Pricing** | Free tier (generous). Paid: ~$0.01/1M tokens |
| **Streaming** | N/A |
| **Tool/Function Calling** | N/A |
| **Notes** | Open-source embedding models. 768/1024d. Very long context (8K tokens). Also offers Nomic Atlas for data visualization. |

---

### 5.6 BGE (BAAI General Embedding)

| Field | Value |
|---|---|
| **API Base** | No hosted API. Open-source models hosted via HuggingFace, TEI, vLLM, etc. |
| **Auth** | Varies by host |
| **API Format** | OpenAI-compatible when hosted via TEI/vLLM |
| **Modalities** | embedding, reranking |
| **Notable Models** | `bge-large-en-v1.5` (1024d), `bge-m3` (multilingual, multi-granularity), `bge-reranker-v2-m3` |
| **Rate Limits** | Self-hosted, configurable |
| **Pricing** | Free (open-weight). Hosting costs only |
| **Streaming** | N/A |
| **Tool/Function Calling** | N/A |
| **Notes** | Strong open-source models from BAAI. BGE-M3 supports multi-function (dense, sparse, ColBERT) in one model. |

---

## 6. CLOUD RERANKING PROVIDERS

### 6.1 Cohere Reranking (see also 1.6)

`rerank-v3.5`, `rerank-english-v3.0`, `rerank-multilingual-v3.0`. Best-in-class reranking. ~$1/1000 searches.

### 6.2 Jina Reranker (see also 5.3)

`jina-reranker-v2-base-multilingual`. ColBERT late interaction. OpenAI-compatible reranking endpoint.

### 6.3 Voyage Reranker (see also 1.20)

`rerank-2`. Custom format. High quality domain-specific reranking.

---

## 7. LOCAL MODEL PLATFORMS

### 7.1 Ollama

| Field | Value |
|---|---|
| **API Base** | `http://localhost:11434/v1` (OpenAI-compat) or `http://localhost:11434/api` (native) |
| **Auth** | None (local). Optional `Authorization: Bearer <key>` for remote |
| **API Format** | OpenAI-compatible (`/v1/chat/completions`) + native API |
| **Modalities** | llm, vision, embedding |
| **Notable Models** | Any GGUF model: `llama3.3`, `mistral`, `qwen2.5`, `phi-4`, `deepseek-r1`, `gemma3`, etc. |
| **Rate Limits** | None (local) |
| **Pricing** | Free (self-hosted) |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (for models that support it) |
| **Notes** | `ollama pull <model>` to download. Supports model quantization (Q4_K_M, etc.). Runs on CPU and GPU. |

---

### 7.2 vLLM

| Field | Value |
|---|---|
| **API Base** | `http://localhost:8000/v1` |
| **Auth** | Configurable (`--api-key` flag) |
| **API Format** | OpenAI-compatible |
| **Modalities** | llm, vision, embedding |
| **Notable Models** | Any HuggingFace model (HF Transformers format) |
| **Rate Limits** | Self-hosted, configurable |
| **Pricing** | Free (self-hosted) |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (for supported models) |
| **Notes** | High-performance inference engine. PagedAttention for efficient memory. Supports tensor parallelism, continuous batching. Production-grade. |

---

### 7.3 llama.cpp

| Field | Value |
|---|---|
| **API Base** | `http://localhost:8080/v1` (server mode) |
| **Auth** | `--api-key <key>` (optional) |
| **API Format** | OpenAI-compatible |
| **Modalities** | llm, vision (with LLaVA), embedding, audio_stt (Whisper) |
| **Notable Models** | Any GGUF model |
| **Rate Limits** | None (local) |
| **Pricing** | Free (self-hosted) |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (for supported models) |
| **Notes** | Lightweight C/C++ inference. Runs on CPU (AVX2, Metal, CUDA). GGUF quantization format. Very portable. |

---

### 7.4 LocalAI

| Field | Value |
|---|---|
| **API Base** | `http://localhost:8080/v1` |
| **Auth** | Optional API key |
| **API Format** | OpenAI-compatible (drop-in replacement) |
| **Modalities** | llm, embedding, audio_stt, audio_tts, image_gen |
| **Notable Models** | Any GGUF/HuggingFace model |
| **Rate Limits** | None (local) |
| **Pricing** | Free (self-hosted) |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes |
| **Notes** | Aims to be a full local OpenAI API replacement. Supports many backends (llama.cpp, stablediffusion.cpp, whisper). Docker-friendly. |

---

### 7.5 LM Studio

| Field | Value |
|---|---|
| **API Base** | `http://localhost:1234/v1` |
| **Auth** | None (local) |
| **API Format** | OpenAI-compatible |
| **Modalities** | llm, vision, embedding |
| **Notable Models** | Any GGUF model from HuggingFace |
| **Rate Limits** | None (local) |
| **Pricing** | Free (desktop app) |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (for supported models) |
| **Notes** | Desktop GUI for running local models. Built-in model discovery and download. Mac/Windows/Linux. |

---

### 7.6 Text Generation Inference (TGI) by HuggingFace

| Field | Value |
|---|---|
| **API Base** | `http://localhost:8080/v1` or `http://localhost:8080/generate` |
| **Auth** | Optional (`--api-key`) |
| **API Format** | OpenAI-compatible (`/v1`) + custom endpoints |
| **Modalities** | llm, embedding |
| **Notable Models** | Any HuggingFace Transformers model |
| **Rate Limits** | Self-hosted, configurable |
| **Pricing** | Free (self-hosted). Also available via HuggingFace Inference Endpoints (paid) |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (for supported models) |
| **Notes** | Production-grade Rust inference server. Supports Flash Attention, quantization (GPTQ, AWQ, bitsandbytes). Tensor parallelism. |

---

## 8. MODEL HOSTING / AGGREGATION

### 8.1 Replicate

| Field | Value |
|---|---|
| **API Base** | `https://api.replicate.com/v1` |
| **Auth** | `Authorization: Bearer <key>` or `Authorization: Token <key>` |
| **API Format** | Custom REST (prediction-based) |
| **Modalities** | llm, image_gen, video, audio_tts, audio_stt, embedding (varies by model) |
| **Notable Models** | Thousands of community models: `meta/llama-3.3-70b`, `black-forest-labs/flux-schnell`, `stability-ai/sdxl`, `openai/whisper`, etc. |
| **Rate Limits** | Concurrent prediction limits per plan |
| **Pricing** | Per-second of compute. ~$0.0032/sec for A40 GPU |
| **Streaming** | Yes (SSE for streaming models) |
| **Tool/Function Calling** | Depends on model |
| **Notes** | Run any model with a simple API. Async predictions with webhooks. Also supports model deployment and custom models. |

---

### 8.2 Together AI

| Field | Value |
|---|---|
| **API Base** | `https://api.together.xyz/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | OpenAI-compatible |
| **Modalities** | llm, vision, embedding, image_gen, audio_stt |
| **Notable Models** | `meta-llama/Llama-3.3-70B-Instruct-Turbo`, `mistralai/Mixtral-8x7B-Instruct-v0.1`, `Qwen/Qwen2.5-72B-Instruct-Turbo`, `deepseek-ai/DeepSeek-V3`, `black-forest-labs/FLUX.1-schnell-Free` |
| **Rate Limits** | Tier-based (free: 60 RPM) |
| **Pricing** | Per-token (LLM) or per-image. Llama 3.3 70B: ~$0.88/$0.88 per 1M tokens |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (for supported models) |
| **Notes** | Wide model selection. Competitive pricing. Supports fine-tuning. OpenAI drop-in compatible. |

---

### 8.3 Fireworks AI

| Field | Value |
|---|---|
| **API Base** | `https://api.fireworks.ai/inference/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | OpenAI-compatible |
| **Modalities** | llm, vision, embedding, image_gen |
| **Notable Models** | `accounts/fireworks/models/llama-v3p3-70b-instruct`, `accounts/fireworks/models/deepseek-v3`, `accounts/fireworks/models/qwen2p5-72b-instruct`, `accounts/fireworks/models/flux-1-schnell` |
| **Rate Limits** | ~600 RPM (free), higher on paid |
| **Pricing** | Per-token. Llama 70B: ~$0.90/$0.90 per 1M. DeepSeek V3: ~$0.90/$0.90 |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (function calling support) |
| **Notes** | Very fast inference (low TTFT). FireAttention engine. Also offers fine-tuning. |

---

### 8.4 Anyscale / Ray Serve

| Field | Value |
|---|---|
| **API Base** | `https://api.endpoints.anyscale.com/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | OpenAI-compatible |
| **Modalities** | llm |
| **Notable Models** | `meta-llama/Llama-3.3-70B-Instruct`, `mistralai/Mixtral-8x7B-Instruct-v0.1` |
| **Rate Limits** | Provisioned throughput |
| **Pricing** | Per-token or provisioned throughput |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (for supported models) |
| **Notes** | Built on Ray. Focus on scalable model serving. Also self-host via Ray Serve. |

---

### 8.5 Modal

| Field | Value |
|---|---|
| **API Base** | Custom (serverless functions, not a fixed API endpoint) |
| **Auth** | Modal token (CLI auth) |
| **API Format** | Python SDK (not REST API per se) |
| **Modalities** | Any (compute platform for running any model) |
| **Notable Models** | User-defined (run any HuggingFace/GGUF model) |
| **Rate Limits** | Per-account GPU limits |
| **Pricing** | Per-second GPU compute. A10G: ~$1.10/hr. H100: ~$4.89/hr |
| **Streaming** | Yes (depends on implementation) |
| **Tool/Function Calling** | N/A (platform) |
| **Notes** | Serverless GPU platform. Write Python, run on GPUs. Great for custom inference pipelines. |

---

### 8.6 RunPod

| Field | Value |
|---|---|
| **API Base** | `https://api.runpod.ai/v2/<endpoint-id>` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | Custom REST (serverless) or direct GPU access |
| **Modalities** | Any (GPU cloud) |
| **Notable Models** | User-defined (templates for Stable Diffusion, LLMs, etc.) |
| **Rate Limits** | Per-endpoint, configurable |
| **Pricing** | Per-second GPU. RTX 4090: ~$0.44/hr. A100 80GB: ~$1.89/hr |
| **Streaming** | Yes (for streaming endpoints) |
| **Tool/Function Calling** | N/A (platform) |
| **Notes** | GPU cloud with serverless and persistent pods. Good for inference and training. |

---

### 8.7 Hugging Face Inference API

| Field | Value |
|---|---|
| **API Base** | `https://api-inference.huggingface.co/models/<model-id>` or `https://router.huggingface.co/hf-inference/v1` (new unified) |
| **Auth** | `Authorization: Bearer <hf_token>` |
| **API Format** | Custom REST (legacy) or OpenAI-compatible (new router) |
| **Modalities** | llm, embedding, image_gen, audio_stt, audio_tts, vision |
| **Notable Models** | Any model on HuggingFace Hub (popular: `meta-llama/Llama-3.3-70B-Instruct`, `mistralai/Mistral-7B-Instruct-v0.3`) |
| **Rate Limits** | Free: ~10 RPM (shared). Pro: higher. Dedicated: unlimited |
| **Pricing** | Free (rate-limited). Pro: $9/mo (faster). Inference Endpoints: per-hour GPU |
| **Streaming** | Yes |
| **Tool/Function Calling** | Depends on model |
| **Notes** | Access to 500K+ models. New unified router provides OpenAI-compatible API. Also offers Inference Endpoints for dedicated compute. |

---

### 8.8 Groq

| Field | Value |
|---|---|
| **API Base** | `https://api.groq.com/openai/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | OpenAI-compatible |
| **Modalities** | llm, audio_stt (Whisper), audio_tts |
| **Notable Models** | `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `mixtral-8x7b-32768`, `gemma2-9b-it`, `whisper-large-v3`, `whisper-large-v3-turbo`, `distil-whisper-large-v3-en` |
| **Rate Limits** | ~30 RPM (free), ~1000 RPM (paid). Token limits per model |
| **Pricing** | Per-token. Llama 3.3 70B: ~$0.59/$0.79 per 1M. Whisper: ~$0.04/hr |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes (for supported models) |
| **Notes** | Runs on Groq LPU (custom inference chip). Extremely fast inference (low latency). Very popular for real-time applications. |

---

### 8.9 Cerebras

| Field | Value |
|---|---|
| **API Base** | `https://api.cerebras.ai/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | OpenAI-compatible |
| **Modalities** | llm |
| **Notable Models** | `llama3.3-70b`, `llama-3.1-8b`, `qwen-2.5-32b` |
| **Rate Limits** | ~30 RPM free tier |
| **Pricing** | Per-token. Llama 70B: ~$0.85/$1.35 per 1M. Llama 8B: ~$0.10/$0.10 |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes |
| **Notes** | Runs on Cerebras WSE (Wafer-Scale Engine). Extremely fast inference. Limited model selection but very fast. |

---

### 8.10 SambaNova

| Field | Value |
|---|---|
| **API Base** | `https://api.sambanova.ai/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | OpenAI-compatible |
| **Modalities** | llm, embedding |
| **Notable Models** | `Meta-Llama-3.3-70B-Instruct`, `DeepSeek-R1-Distill-Llama-70B`, `QwQ-32B` |
| **Rate Limits** | ~100 RPM free tier |
| **Pricing** | Per-token. Free tier available. Llama 70B: ~$0.60/$1.20 per 1M (approximate) |
| **Streaming** | Yes |
| **Tool/Function Calling** | Yes |
| **Notes** | Runs on SambaNova RDU (Reconfigurable Dataflow Unit). Fast inference, free tier generous. |

---

## 9. SPECIALIZED PROVIDERS

### 9.1 Wolfram Alpha

| Field | Value |
|---|---|
| **API Base** | `https://api.wolframalpha.com/v2/query` (Full Results API) or `https://api.wolframalpha.com/v1/result` (Short Answers) |
| **Auth** | `appid=<key>` query parameter |
| **API Format** | Custom (returns XML/JSON) |
| **Modalities** | computation (math, science, data) |
| **Notable Models** | N/A (computational knowledge engine, not a model) |
| **Rate Limits** | ~2000 queries/month (free), higher on paid |
| **Pricing** | Free (2K/mo). Pro: $5/mo. Enterprise: custom |
| **Streaming** | N/A |
| **Tool/Function Calling** | N/A (but can be used as a tool by LLMs) |
| **Notes** | Computational knowledge engine. Math, science, statistics, real-time data. Used as a tool/plugin by GPT and others. |

---

### 9.2 SerpAPI

| Field | Value |
|---|---|
| **API Base** | `https://serpapi.com/search` |
| **Auth** | `api_key=<key>` query parameter |
| **API Format** | Custom REST (JSON response) |
| **Modalities** | search (web, images, news, shopping, etc.) |
| **Notable Models** | N/A (search API, not a model) |
| **Rate Limits** | ~100 searches/month (free), ~5000/mo (paid) |
| **Pricing** | Free (100/mo). Developer: $50/mo (5000 searches) |
| **Streaming** | N/A |
| **Tool/Function Calling** | N/A (but can be used as a tool by LLMs) |
| **Notes** | Google, Bing, Baidu search results as structured JSON. Useful as a tool for LLM agents. |

---

### 9.3 Pinecone

| Field | Value |
|---|---|
| **API Base** | `https://<index>-<project>.svc.<region>.pinecone.io` (query/upsert) or `https://api.pinecone.io` (management) |
| **Auth** | `Api-Key: <key>` header |
| **API Format** | Custom REST |
| **Modalities** | vector_db (storage, search, filtering) |
| **Notable Models** | N/A (vector database, not a model) |
| **Rate Limits** | ~100 QPS (Starter), ~2000 QPS (Enterprise) |
| **Pricing** | Free (Starter: 2GB, 100K vectors). Standard: ~$70/mo. Enterprise: custom |
| **Streaming** | N/A |
| **Tool/Function Calling** | N/A (but used as RAG backend) |
| **Notes** | Managed vector database. Serverless and pod-based indexes. Metadata filtering. Namespace support. Integrated with LangChain, LlamaIndex, etc. |

---

## 10. AUDIO SEPARATION PROVIDERS

### 10.1 AudioShake

| Field | Value |
|---|---|
| **API Base** | `https://api.audioshake.com/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | Custom REST |
| **Modalities** | audio_separation |
| **Notable Models** | `standard` (4-6 stems), `lite` (vocals/instrumental) |
| **Rate Limits** | Enterprise-tiered |
| **Pricing** | Per-minute of audio. ~$0.05-0.15/min depending on tier |
| **Streaming** | N/A (async processing) |
| **Notes** | Enterprise-grade stem separation. Supports webhook callbacks. CDN delivery for large files. MusicAI.ai parent company.

### 10.2 StemSplit

| Field | Value |
|---|---|
| **API Base** | `https://api.stemsplit.com/v1` |
| **Auth** | `Authorization: Bearer <key>` |
| **API Format** | Custom REST |
| **Modalities** | audio_separation |
| **Notable Models** | `2stem`, `4stem`, `6stem` |
| **Rate Limits** | Per-plan limits |
| **Pricing** | Pay-per-minute. ~$0.03/min |
| **Streaming** | N/A (async) |
| **Notes** | Webhook support for job completion. Good for real-time applications.

### 10.3 Demucs (Local)

| Field | Value |
|---|---|
| **API Base** | `http://localhost:8000` (HTTP wrapper service) |
| **Auth** | None (local) |
| **API Format** | Custom REST (wrapper) |
| **Modalities** | audio_separation |
| **Notable Models** | `htdemucs_ft` (6 stems), `htdemucs` (4 stems), `mdx` (2 stems) |
| **Rate Limits** | None (local) |
| **Pricing** | Free (self-hosted) |
| **Streaming** | N/A |
| **Notes** | Hybrid Transformer architecture. Requires GPU for fast processing. Open-source (Meta).

---

## 11. OCR PROVIDERS

### 11.1 PaddleOCR

| Field | Value |
|---|---|
| **API Base** | `http://localhost:8000` (local) or HuggingFace Inference API |
| **Auth** | None (local) or `Authorization: Bearer <hf_token>` (HF) |
| **API Format** | Custom REST (local) or HuggingFace Inference API |
| **Modalities** | ocr |
| **Notable Models** | `ch_ppocrv4` (80+ languages), `ch_ppocrv3` |
| **Rate Limits** | None (local) or ~30 RPM (HF free) |
| **Pricing** | Free (self-hosted) or ~$0.0001/request (HF Inference Endpoints) |
| **Streaming** | N/A |
| **Notes** | Excellent multilingual support. Lightweight. Structured output with bounding boxes.

### 11.2 Tesseract 5

| Field | Value |
|---|---|
| **API Base** | `http://localhost:8000` (HTTP wrapper) |
| **Auth** | None |
| **API Format** | Custom REST |
| **Modalities** | ocr |
| **Notable Models** | `tesseract-5` (all languages) |
| **Rate Limits** | None (local) |
| **Pricing** | Free (open-source) |
| **Streaming** | N/A |
| **Notes** | Classic OCR engine. Lightweight. Good for embedded systems. Supports 100+ languages.

### 11.3 TrOCR (HuggingFace)

| Field | Value |
|---|---|
| **API Base** | `https://api-inference.huggingface.co/models/<model-id>` |
| **Auth** | `Authorization: Bearer <hf_token>` |
| **API Format** | HuggingFace Inference API |
| **Modalities** | ocr |
| **Notable Models** | `microsoft/trocr-base-printed`, `microsoft/trocr-large-printed`, `microsoft/trocr-base-handwritten` |
| **Rate Limits** | ~30 RPM (free), higher on paid |
| **Pricing** | Free (rate-limited) or Inference Endpoints (pay-as-you-go) |
| **Streaming** | N/A |
| **Notes** | Transformer-based OCR. Excellent for printed and handwritten text.

---

## QUICK REFERENCE: API FORMAT COMPATIBILITY

### OpenAI-Compatible Providers (drop-in `openai` SDK)
| Provider | Endpoint |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| Mistral | `https://api.mistral.ai/v1` |
| xAI (Grok) | `https://api.x.ai/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| Moonshot | `https://api.moonshot.cn/v1` |
| 01.AI (Yi) | `https://api.01.ai/v1` |
| Zhipu (GLM) | `https://open.bigmodel.cn/api/paas/v4` |
| Together AI | `https://api.together.xyz/v1` |
| Fireworks AI | `https://api.fireworks.ai/inference/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Cerebras | `https://api.cerebras.ai/v1` |
| SambaNova | `https://api.sambanova.ai/v1` |
| Ollama | `http://localhost:11434/v1` |
| vLLM | `http://localhost:8000/v1` |
| llama.cpp | `http://localhost:8080/v1` |
| LM Studio | `http://localhost:1234/v1` |
| LocalAI | `http://localhost:8080/v1` |
| TGI | `http://localhost:8080/v1` |
| HuggingFace (new) | `https://router.huggingface.co/hf-inference/v1` |

### Custom API Format Providers
| Provider | Notes |
|---|---|
| Anthropic | Messages API with `system` as top-level, `x-api-key` auth |
| Google Gemini | `generateContent` endpoints, API key in URL param |
| Cohere | v2 API format (also has OpenAI-compat endpoint) |
| AI21 Labs | Custom (also OpenAI-compat) |
| Stability AI | REST with multipart form |
| ElevenLabs | REST with `xi-api-key` header |
| Replicate | Prediction-based async API |

---

## AUTH HEADER QUICK REFERENCE

| Header | Providers |
|---|---|
| `Authorization: Bearer <key>` | OpenAI, Mistral, xAI, DeepSeek, Moonshot, Yi, Fireworks, Together, Groq, Cerebras, SambaNova, Replicate, Writer, Stability, Leonardo, Midjourney, Synthesia |
| `x-api-key: <key>` | Anthropic |
| `xi-api-key: <key>` | ElevenLabs |
| `X-Api-Key: <key>` | HeyGen |
| `X-Key: <key>` | Black Forest Labs (Flux) |
| `Authorization: Token <key>` | Deepgram |
| `Api-Key: <key>` | Pinecone, AssemblyAI (no "Bearer") |
| `appid=<key>` (query param) | Wolfram Alpha |
| `api_key=<key>` (query param) | SerpAPI |
| API key in URL `?key=` | Google Gemini |
| JWT token | Zhipu (GLM), Snowflake |
| Custom signature | Baichuan |

---

## MODALITY MATRIX

| Provider | LLM | Vision | Image Gen | Embedding | Reranking | TTS | STT | Video | Audio Separation | OCR |
|---|---|---|---|---|---|---|---|---|---|---|
| OpenAI | x | x | x | x | | x | x | | | |
| Anthropic | x | x | | | | | | | | |
| Google Gemini | x | x | x | x | | | x | | | |
| Mistral | x | x | | x | | | | | | |
| Cohere | x | | | x | x | | | | | |
| xAI (Grok) | x | x | x | | | | | | | |
| DeepSeek | x | | | | | | | | | |
| ElevenLabs | | | | | | x | x | | stem-separation | |
| Deepgram | | | | | | x | x | | diarization | |
| Stability AI | | | x | | | | | x | | |
| RunwayML | | | x | | | | | x | | |
| Replicate | x | x | x | | | x | x | x | | ocr-via-trocr |
| Together AI | x | x | x | x | | | x | | | |
| Groq | x | | | | | | x | | | |
| HuggingFace | x | x | x | x | | x | x | | | trocr, paddleocr |
| Ollama | x | x | | x | | | | | | |
| vLLM | x | x | | x | | | | | | |
| AudioShake | | | | | | | | | x | |
| StemSplit | | | | | | | | | x | |
| Demucs | | | | | | | | | x (local) | |
| Tesseract | | | | | | | | | | x |
| PaddleOCR | | | | | | | | | | x (local/hf) |

---

## NOTES FOR ADAPTER IMPLEMENTATION

1. **OpenAI-compatible providers** can share a single adapter with configurable base URL and model mapping.
2. **Anthropic** needs its own adapter due to the distinct message format (`system` as top-level param, content blocks with types).
3. **Google Gemini** needs its own adapter (different endpoint structure, API key in URL).
4. **Image/video providers** use async patterns (submit job, poll for result) rather than streaming.
5. **Audio providers** vary widely: some use WebSocket (Deepgram, ElevenLabs), some use multipart form (Whisper).
6. **Audio Separation** uses async job pattern (processing takes 30s-3min). Demucs is local-only; AudioShake/StemSplit are cloud APIs.
7. **OCR** can be synchronous (fast) or async depending on image size. Tesseract/PaddleOCR run locally; HuggingFace/Trocr via Inference API.
8. **Local platforms** (Ollama, vLLM, llama.cpp, etc.) are mostly OpenAI-compatible, simplifying integration.
9. **Rate limiting**: Most use RPM-based limits. Audio providers may use per-second/per-minute limits. Image providers use per-generation or credit-based limits.
10. **Authentication** should be configurable per-adapter to support the variety of header formats listed above.
