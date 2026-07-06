# Free AI API Access — Comprehensive Report

**Date:** July 5, 2026 (updated)
**Purpose:** Research all providers, labs, and aggregators offering free AI API access with detailed limits for DMR-X integration
**Status:** 56 providers · 187 free models · Verified rate limits

---

## Table of Contents

1. [Big Tech Providers](#1-big-tech-providers)
2. [API Aggregators](#2-api-aggregators)
3. [Niche & Specialized Providers](#3-niche--specialized-providers)
4. [Academic & Research Programs](#4-academic--research-programs)
5. [Self-Hosted (Truly Free)](#5-self-hosted-truly-free)
6. [Master Comparison Table](#6-master-comparison-table)
7. [DMR-X Integration Recommendations](#7-dmr-x-integration-recommendations)

---

## 1. Big Tech Providers

### Google Gemini API / AI Studio ⭐ BEST FREE TIER

- **URL:** https://aistudio.google.com
- **Cost:** Completely free, no credit card
- **Models:** Gemini 2.0 Flash, Gemini 1.5 Flash, Gemini 1.5 Pro, text-embedding-004
- **Rate Limits (Free Tier — "Tier 0"):**
  - Gemini 2.0 Flash: **15 RPM, 1M TPM, 1,500 RPD**
  - Gemini 1.5 Flash: **15 RPM, 1M TPM, 1,500 RPD**
  - Gemini 1.5 Pro: **2 RPM, 32K TPM, 50 RPD**
- **Credits:** No credit system — permanent free tier with rate limits
- **Restrictions:** Content filtering, no SLA, data may be used for model improvement (opt-out on paid)
- **Access:** Google account → generate API key instantly

### Anthropic (Claude)

- **URL:** https://console.anthropic.com
- **Cost:** No permanent free tier. Occasional ~$5 promo credits on new accounts
- **Models:** Claude 3.5 Haiku ($0.25/$1.25 M/tok), Claude 3.5 Sonnet ($3/$15), Claude 3 Opus ($15/$75)
- **Access:** Phone + credit card required
- **Verdict:** Not viable for free API access

### OpenAI

- **URL:** https://platform.openai.com
- **Cost:** No permanent free tier. ~$5 trial credits (expire in ~3 months)
- **Models:** GPT-4o-mini ($0.15/$0.60), GPT-4o ($2.50/$10), o1 ($15/$60)
- **Access:** Phone + credit card required
- **Verdict:** Trial credits only, not sustainable

### Meta / Llama

- **No direct hosted API** — Llama is open-weight, self-host only
- **Free hosted access via partners:**
  - Groq: Llama 3.3 70B, 30 RPM free
  - SambaNova: Llama 3.1 405B free
  - Cerebras: Llama 3.1/3.3 70B free
  - Cloudflare Workers AI: Llama 3.1 70B free
  - OpenRouter: Llama 3.3 70B `:free` models

### Mistral AI

- **URL:** https://console.mistral.ai
- **Cost:** Free tier exists for smaller models (Mistral NeMo, 7B)
- **Rate Limits:** ~2-5 RPM on free tier
- **Access:** No credit card for free tier
- **Restrictions:** Larger models (Large, Medium) require payment
- **Verdict:** Modest free tier, EU-based

### Microsoft Azure

- **Cost:** $200 credit for 30 days only. No permanent free LLM tier
- **Azure OpenAI:** Requires enterprise application approval, not self-serve
- **Verdict:** Not viable for free API access

### AWS Bedrock

- **Cost:** Free trial for ~2 months, limited tokens (~25K input + 50K output/month for Titan)
- **Models:** Amazon Titan, Llama (via Bedrock), limited Claude access
- **Access:** AWS account + model access request per model
- **Verdict:** Very limited, time-restricted

---

## 2. API Aggregators

### OpenRouter ⭐ BEST FREE VARIETY

- **URL:** https://openrouter.ai
- **How it works:** Models with `:free` suffix = $0 pricing. No credits needed.
- **29 free models verified (May 2026):**
  - `deepseek/deepseek-v4-flash:free` — 1M context
  - `qwen/qwen3-coder:free` — 480B A35B, 1M context
  - `nvidia/nemotron-3-super-120b-a12b:free` — 1M context
  - `nousresearch/hermes-3-llama-3.1-405b:free` — 131K context
  - `meta-llama/llama-3.3-70b-instruct:free` — 131K context
  - `openai/gpt-oss-120b:free` — 131K context
  - `openai/gpt-oss-20b:free` — 131K context
  - `google/gemma-4-31b-it:free` — 262K context
  - `google/gemma-4-26b-a4b-it:free` — 262K context
  - `minimax/minimax-m2.5:free` — 204K context
  - `nvidia/nemotron-3-nano-30b-a3b:free` — 256K context
  - `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` — 256K context
  - `nvidia/nemotron-nano-12b-v2-vl:free` — 128K (vision)
  - `nvidia/nemotron-nano-9b-v2:free` — 128K
  - `poolside/laguna-m.1:free` — 131K
  - `poolside/laguna-xs.2:free` — 131K
  - `qwen/qwen3-next-80b-a3b-instruct:free` — 262K
  - `z-ai/glm-4.5-air:free` — 131K
  - `arcee-ai/trinity-large-thinking:free` — 262K
  - `baidu/cobuddy:free` — 131K
  - `cognitivecomputations/dolphin-mistral-24b-venice-edition:free` — 32K
  - `liquid/lfm-2.5-1.2b-instruct:free` — 32K
  - `liquid/lfm-2.5-1.2b-thinking:free` — 32K
  - `meta-llama/llama-3.2-3b-instruct:free` — 131K
  - Plus meta-router `openrouter/free` (auto-selects best free model)
- **Rate Limits:** ~20 RPM, ~200 RPD, ~100K TPM (varies by model)
- **Restrictions:** Free models may have 503s during peak, no streaming guarantee, models can disappear
- **Access:** Create account → API key → OpenAI-compatible endpoint

### Groq ⭐ FASTEST FREE INFERENCE

- **URL:** https://console.groq.com
- **Cost:** Permanent free tier, no credit card
- **Models (verified July 2026):**
  - `llama-3.1-8b-instant` — 30 RPM, 14,400 RPD, 6K TPM, 500K TPD
  - `llama-3.3-70b-versatile` — 30 RPM, 1,000 RPD, 12K TPM, 100K TPD
  - `llama-4-scout-17b-16e-instruct` — 30 RPM, 1,000 RPD, 30K TPM, 500K TPD
  - `qwen/qwen3-32b` — 60 RPM, 1,000 RPD, 6K TPM, 500K TPD
  - `openai/gpt-oss-120b` — 30 RPM, 1,000 RPD, 8K TPM, 200K TPD
  - `openai/gpt-oss-20b` — 30 RPM, 1,000 RPD, 8K TPM, 200K TPD
  - `moonshotai/kimi-k2-instruct` — 60 RPM, 1,000 RPD, 10K TPM, 300K TPD
  - `groq/compound` — 30 RPM, 250 RPD, 70K TPM
  - `groq/compound-mini` — 30 RPM, 250 RPD, 70K TPM
  - `gemma2-9b-it` — 30 RPM, 14,400 RPD, 15K TPM, 500K TPD, 15M monthly budget
  - `allam-2-7b` — 30 RPM, 7,000 RPD, 6K TPM, 500K TPD
  - `whisper-large-v3` — 20 RPM, 2,000 RPD (STT)
- **Speed:** 500+ tokens/sec on Llama 70B (custom LPU hardware)
- **Restrictions:** Development/evaluation only, no SLA
- **Access:** Sign up → API key

### Cloudflare Workers AI

- **URL:** https://developers.cloudflare.com/workers-ai/
- **Cost:** **10,000 neurons/day free** (neurons = compute units)
- **Models:** Llama 3.1 8B/70B, Mistral 7B, Phi-2, CodeLlama, StarCoder, Stable Diffusion, Whisper
- **Rate Limits:** 100 RPM, 10K neurons/day (~10K-50K tokens depending on model)
- **Restrictions:** Edge-optimized (quantized), max tokens per request limited
- **Access:** Cloudflare account → Workers AI

### Cerebras ⭐ ULTRA-FAST

- **URL:** https://cerebras.ai
- **Cost:** Free tier, no credit card
- **Models:** Llama 3.1 8B/70B, Llama 3.3 70B
- **Speed:** 2,000+ tokens/sec (wafer-scale chip)
- **Rate Limits:** ~30 RPM, ~1,000-5,000 RPD
- **Restrictions:** Smaller model selection, queue times during peak
- **Access:** Sign up → API key

### SambaNova

- **URL:** https://sambanova.ai
- **Cost:** Free tier, no credit card
- **Models (verified July 2026):**
  - `Meta-Llama-3.3-70B-Instruct` — 80 RPM, 1,600 RPD
  - `DeepSeek-R1` — 20 RPM, 200 RPD, 200K TPD
  - `DeepSeek-V3.1` — 20 RPM, 200 RPD, 200K TPD
  - `DeepSeek-V3.2` — 20 RPM, 200 RPD, 200K TPD
  - `Llama-4-Maverick-17B-128E-Instruct` — 20 RPM, 200 RPD, 200K TPD
  - `Qwen2.5-72B-Instruct` — 20 RPM, 200 RPD, 200K TPD
  - `gemma-4-31B-it` — 20 RPM, 20 RPD, 200K TPD
- **Speed:** Fast 405B inference (RDU hardware)
- **Restrictions:** 200K TPD binding constraint for bulk usage
- **Access:** Sign up → API key

### Hugging Face Inference API

- **URL:** https://huggingface.co
- **Cost:** Free (rate-limited). $0.10/month free credits for all users
- **Models:** 200+ models from Cerebras, Cohere, DeepInfra, Fal, Fireworks, Groq, SambaNova, Together, Replicate
- **Rate Limits:** ~10 RPM, ~1,000 RPD, 1-2 concurrent requests
- **API:** OpenAI-compatible at `https://router.huggingface.co/v1`
- **Provider selection:** `:fastest`, `:cheapest`, `:preferred`, or specific provider
- **Restrictions:** Cold-start delay (30-60s), $0.10 runs out fast, large models may be unavailable
- **Access:** HF account → API token

### Together AI

- **URL:** https://together.ai
- **Cost:** $1-$5 free credit on signup (promotional, expires ~30 days)
- **Models:** Llama 3.1 8B/70B/405B, Mistral 7B, Mixtral 8x7B, Qwen 2.5 72B, DeepSeek
- **Rate Limits:** 100 RPM, 50K-500K TPM
- **Pricing after credits:** Llama 3.1 8B ~$0.10/M input, 70B ~$0.90/M input
- **Verdict:** No permanent free tier

### Fireworks AI

- **URL:** https://fireworks.ai
- **Cost:** $1 free credit on signup
- **Models:** Llama 3.1 8B/70B, Mixtral 8x7B, function-calling models
- **Rate Limits:** 200 RPM
- **Verdict:** No permanent free tier, credit-based

### Deepinfra

- **URL:** https://deepinfra.com
- **Cost:** $0.50-$1 free credit on signup
- **Models:** Llama 3.1 8B/70B/405B, Mixtral, Mistral, DeepSeek
- **Pricing:** Llama 3.1 8B ~$0.05/M input, 70B ~$0.35/M input (cheapest)
- **Rate Limits:** 60 RPM
- **Verdict:** No permanent free tier

### Replicate

- **URL:** https://replicate.com
- **Cost:** Some community models free to run, very limited
- **Models:** Mostly image gen (SD variants), some small LLMs
- **Rate Limits:** Very limited for free users
- **Verdict:** Not viable for free LLM API usage

---

## 3. Niche & Specialized Providers

### Cohere ⭐ BEST FREE EMBEDDINGS + RERANKING

- **URL:** https://cohere.com
- **Cost:** Free trial key on signup, no credit card
- **Models:** command-r (128K), embed-english-v3.0, embed-multilingual-v3.0 (1024 dims), rerank-english-v3.0, rerank-multilingual-v3.0
- **Rate Limits:** 100 API calls/min (Chat, Embed, Classify, Rerank)
- **Restrictions:** Trial key cannot go to production, ~4096 token output limit
- **Access:** Sign up → trial API key

### DeepSeek

- **URL:** https://platform.deepseek.com
- **Cost:** No free tier (pay-as-you-go, requires top-up)
- **Models:** deepseek-v4-flash (1M context, $0.14/M input), deepseek-v4-pro ($0.435/M input)
- **Note:** v4-flash at $0.14/M is near-free. Available free via OpenRouter `:free`
- **Verdict:** No direct free tier, but extremely cheap

### xAI / Grok

- **URL:** https://console.x.ai
- **Cost:** ~$25/month promotional credits (may vary)
- **Models:** grok-3 (131K), grok-3-mini, grok-3-fast, grok-2-vision-1212
- **Rate Limits (free):** ~5 RPM for grok-3, ~10 RPM for grok-3-mini
- **Access:** Requires X/Twitter account
- **Verdict:** Decent free credits for testing

### Stability AI

- **URL:** https://platform.stability.ai
- **Cost:** 25 credits on signup (~25 images)
- **Models:** SDXL, SD3.5, Stable Video Diffusion, Stable Audio
- **Verdict:** Tiny free allocation, testing only

### ElevenLabs (TTS)

- **URL:** https://elevenlabs.io
- **Cost:** Free Starter tier ($0/month)
- **Limits:** **10,000 characters/month** (~10 min audio), 3 custom voices
- **Models:** eleven_multilingual_v2 (29 languages), eleven_turbo_v2_5
- **Rate Limits:** ~5 RPM
- **Restrictions:** Attribution required, no commercial use
- **Verdict:** Tiny free tier, quality testing only

### Deepgram (STT) ⭐ BEST FREE STT

- **URL:** https://deepgram.com
- **Cost:** **$200 in free credits** on signup (no credit card initially)
- **Models:** nova-2 (STT), nova-2-medical, whisper (hosted), aura (TTS)
- **Pricing:** Nova-2: $0.0043/min (~$0.26/hr). **$200 = ~775 hours of free transcription**
- **Rate Limits:** ~100 concurrent streams
- **Verdict:** Excellent. Hundreds of hours of free STT.

### Voyage AI (Embeddings)

- **URL:** https://voyageai.com
- **Cost:** ~50M tokens free on signup (one-time)
- **Models:** voyage-3 (1024 dims), voyage-3-lite, voyage-code-3, voyage-law-2, voyage-finance-2
- **Paid:** voyage-3: $0.06/M, voyage-3-lite: $0.02/M
- **Verdict:** Highest quality embeddings (top MTEB). Trial is one-time.

### Jina AI (Embeddings + Reranking)

- **URL:** https://jina.ai
- **Cost:** **1M tokens/month free** for embeddings (no credit card, recurring)
- **Models:** jina-embeddings-v3 (1024 dims), jina-reranker-v2-base-multilingual, jina-clip-v2 (multimodal)
- **Rate Limits:** ~200 RPM on free tier
- **Bonus:** Reader API (URL → clean text) with free tier
- **Verdict:** Good monthly free quota, recurring

### Qwen / Alibaba Cloud (DashScope)

- **URL:** https://dashscope.aliyun.com
- **Cost:** Free tier with daily quotas
- **Models:** qwen-max (131K), qwen-plus, qwen-turbo, qwen-vl-max (vision), qwen-audio, qwen2.5-coder, qwen2.5-math
- **Rate Limits:** ~1M tokens/day for turbo, ~200K tokens/day for max
- **Restrictions:** Alibaba Cloud account, data may route through China
- **Verdict:** Generous daily quotas

### Moonshot AI / Kimi

- **Cost:** ~15M tokens on signup
- **Models:** moonshot-v1-8k/32k/128k
- **Restrictions:** Primarily Chinese market, limited international access
- **Verdict:** Best accessed via third-party aggregators

### Perplexity

- **URL:** https://docs.perplexity.ai
- **Cost:** ~$5 on signup
- **Models:** sonar ($0.20/M), sonar-pro ($0.60/M), sonar-reasoning, sonar-deep-research
- **Unique:** Search-augmented generation (live web results). Thinking tokens free on reasoning models
- **Verdict:** Unique capability, very cheap

### Upstage

- **Cost:** ~1M tokens trial for chat, ~100 pages/month for Document AI
- **Models:** solar-pro-2, solar-embedding-1-large (4096 dims), Document AI (OCR)
- **Verdict:** Document AI (OCR, table extraction) is the standout

### Cartesia (Real-time TTS)

- **Cost:** ~10,000 characters/month free
- **Models:** sonic (real-time, ~50ms latency)
- **Verdict:** Niche for real-time voice, small free tier

### Modal (GPU Compute)

- **URL:** https://modal.com
- **Cost:** **$30/month free compute credits** (no credit card to start)
- **GPU Pricing:** A10G: ~$0.59/hr, A100: ~$1.14/hr, H100: ~$2.12/hr
- **$30 = ~50 hours A10G or ~26 hours A100/month**
- **Verdict:** Excellent for self-hosting models. Monthly recurring.

### GitHub Models

- **URL:** https://github.com/marketplace/models
- **Cost:** Free for GitHub users (rate-limited)
- **Models:** GPT-4o, Llama, Mistral, Phi, and more
- **Verdict:** Good for prototyping

---

## 4. Academic & Research Programs

| Program | Credits | Requirements | URL |
|---------|---------|-------------|-----|
| Google Cloud Research | $5K-$100K+ | Academic affiliation, proposal | edu.google.com |
| Azure for Students | $100/year | .edu email, no credit card | azure.microsoft.com/education |
| AWS Cloud Credits for Research | Varies | Academic proposal | aws.amazon.com/research-credits |
| Google Colab (Free) | T4 GPU | Google account | colab.research.google.com |

---

## 5. Self-Hosted (Truly Free)

These cost nothing — you supply hardware and electricity.

| Tool | Description | Hardware Needed | API Compatible |
|------|-------------|----------------|----------------|
| **Ollama** | One-command LLM serving | 8GB+ RAM | OpenAI-compatible |
| **vLLM** | High-throughput serving (Apache 2.0) | NVIDIA GPU | OpenAI-compatible |
| **llama.cpp** | CPU-optimized inference (MIT) | Any CPU | OpenAI-compatible |
| **LocalAI** | Drop-in OpenAI replacement | CPU/GPU | OpenAI-compatible |
| **text-generation-webui** | Feature-rich web UI | CPU/GPU | Yes (API mode) |
| **Jan.ai** | Desktop app with local API | 8GB+ RAM | OpenAI-compatible |
| **LM Studio** | Desktop app, model discovery | 8GB+ RAM | OpenAI-compatible |
| **GPT4All** | Easy desktop app | CPU | Yes |
| **Tabby** | GitHub Copilot alternative | CPU/GPU | VS Code/JetBrains |
| **Continue** | AI coding assistant | CPU/GPU | VS Code/JetBrains |

---

## 6. Master Comparison Table

### Permanent Free Hosted APIs

| Provider | Free Mechanism | Best Models | Rate Limits | Credit Card? |
|----------|---------------|-------------|-------------|--------------|
| **Google AI Studio** | Unlimited free w/ limits | Gemini 3.5 Flash, 2.5 Pro | 5-30 RPM, 250K TPM | No |
| **OpenRouter Free** | 21+ $0 models | DeepSeek V4 Flash, Qwen3 Coder, Nemotron Ultra | 20 RPM, 200 RPD | No |
| **Groq** | Free tier (verified) | Llama 3.3 70B, GPT-OSS 120B, Kimi K2 | 30 RPM, 14.4K RPD (8B) | No |
| **Cloudflare** | 10K neurons/day | Llama 3.3 70B, Kimi K2.6, GPT-OSS 120B | Unlimited RPM | No |
| **Cerebras** | Free tier | Llama 3.1/3.3 70B, GPT-OSS 120B | 30 RPM, 1M TPD | No |
| **SambaNova** | Free tier (verified) | Llama 3.3 70B, DeepSeek R1/V3, Gemma 4 | 80 RPM (Llama), 20 RPM others | No |
| **GitHub Models** | Free for GH users | GPT-5, GPT-4.1, o3, DeepSeek R1 | 15 RPM, 150 RPD | No |
| **NVIDIA NIM** | Free tier | Llama 3.1/4, DeepSeek R1, Nemotron Ultra | 5-40 RPM | No |
| **SiliconFlow** | Free tier | DeepSeek V4, Qwen3, GLM, Kimi | 1000 RPM, 50K TPM | No |
| **Cohere** | Trial key | command-r, embed-v3, rerank-v3 | 20 RPM | No |
| **HuggingFace** | Rate-limited | 200+ models (cold start) | 10 RPM | No |
| **Jina AI** | 1M tok/month | embeddings-v3, reranker-v2 | 200 RPM | No |
| **Qwen/DashScope** | Daily quotas | qwen-turbo, qwen-coder-plus | 120 RPM, 1M tok/day | No |
| **Mistral** | Free tier | mistral-small-4, mistral-medium-3.5 | 60 RPM, 500K TPM | No |
| **Zhipu** | Free tier | GLM-4.5 Flash, GLM-4.7 Flash | 60 RPM, 10K RPD | No |
| **Scaleway** | 1M tokens/model | Qwen3 235B, GLM 5.2, Devstral 2 | 1M tokens/model | No |
| **OVHcloud** | Anonymous access | Qwen3.5 397B, Llama 3.3 70B, Mistral | 2 RPM | No |
| **LLM7** | 150M tok/month | Llama 3.3 70B, DeepSeek R1 | 10 RPM, 5K RPD | No |
| **Ollama Cloud** | Free tier | GPT-OSS 120B, Kimi K2.6, DeepSeek V4 | 10 RPM | No |
| **Kilo Gateway** | Free tier | auto:free routing | 10 RPM | No |
| **OpenCode Zen** | Free tier | DeepSeek V4 Flash, Nemotron Ultra | 10-20 RPM | No |
| **Pollinations** | No key needed | openai-fast, Mistral Large | 30 RPM, 1K RPD | No |
| **DeepInfra** | Free tier | Llama 3.3 70B | 5 RPM, 500 RPD | No |
| **Featherless** | Free tier | Llama 3.1 405B/70B, DeepSeek V3 | 10 RPM, 500 RPD | No |
| **Kluster AI** | Free tier | DeepSeek R1, Llama 4, Gemma 3 | Unlimited | No |
| **Aion Labs** | Free tier | aion-2.5, aion-2.0 | 15 RPM, 20K TPD | No |

### Trial Credit Providers

| Provider | Free Credits | Expiry | Best For |
|----------|-------------|--------|----------|
| **Modal** | $30/month | Monthly recurring | Self-host any model on GPU |
| **Baseten** | $30 | One-time | Model deployment |
| **Deepgram** | $200 | One-time | STT (~775 hours) |
| **xAI/Grok** | ~$25/month | Monthly | Grok models |
| **ElevenLabs** | 10K chars/month | Monthly | TTS |
| **AI21 Labs** | $10 | One-time | Jamba models |
| **Perplexity** | $5 | One-time | Search-augmented AI |
| **OpenAI** | ~$5 | 3 months | GPT-4o-mini |
| **Together AI** | $1-$5 | 30 days | Open models |
| **Fireworks AI** | $1 | ~30 days | Fast inference |
| **Nebius** | $1 | One-time | Open models |
| **Hyperbolic** | $1 | One-time | DeepSeek, Llama |
| **Stability AI** | 25 credits | Expires | Image generation |
| **Voyage AI** | 50M tokens | One-time | Best embeddings |

---

## 7. DMR-X Integration Recommendations

### Tier 1 — Must Integrate (Permanent Free, High Value)

1. **Google Gemini** — Best overall free tier (250K TPM, no card)
2. **OpenRouter Free** — 21+ free models, single API key
3. **Groq** — Fastest free inference (500+ tok/sec), verified limits
4. **GitHub Models** — GPT-5, o3, DeepSeek R1 free
5. **Cerebras** — Ultra-fast (2000+ tok/sec), 1M TPD
6. **SambaNova** — Fast inference, verified 80 RPM Llama
7. **SiliconFlow** — 1000 RPM, 6 free models
8. **Cohere** — Best free embeddings + reranking

### Tier 2 — Should Integrate (Good Free Value)

9. **Cloudflare Workers AI** — Edge inference, 10K neurons/day
10. **NVIDIA NIM** — Llama 4, DeepSeek R1, Nemotron Ultra
11. **HuggingFace** — 200+ models, good fallback
12. **Qwen/DashScope** — 120 RPM, generous daily quotas
13. **Scaleway** — 1M tokens/model, EU-hosted
14. **LLM7** — 150M tokens/month
15. **Ollama Cloud** — Large open-source models
16. **Modal** — $30/month for self-hosting any model

### Tier 3 — Nice to Have (Limited/One-Time)

17. **Deepgram** — $200 = 775 hours free STT
18. **ElevenLabs** — Free TTS (10K chars/mo)
19. **Mistral** — Free small models (60 RPM)
20. **Zhipu** — GLM-4 Flash, generous limits
21. **OVHcloud** — Anonymous access, no signup
22. **Perplexity** — Search-augmented, $5 free
23. **Voyage AI** — 50M tokens one-time (best embeddings)
24. **Stability AI** — 25 free images

### Community/Grey-Area (Use as Fallback)

25. **Pollinations** — No key needed, 30 RPM
26. **Kilo Gateway** — Auto-routing free models
27. **OpenCode Zen** — Curated free models
28. **Kluster AI** — Unlimited free inference
29. **AI Horde** — Community-powered, no key

### Self-Hosted Stack (Zero Cost)

- **Ollama** for local development
- **vLLM** for production self-hosting
- **llama.cpp** for CPU/edge deployment
- **Modal** for GPU compute ($30/month free)

---

*Report updated July 5, 2026. Verified rate limits from official documentation. 56 providers, 187 free models. Use `dmrx free` to browse all providers interactively.*
