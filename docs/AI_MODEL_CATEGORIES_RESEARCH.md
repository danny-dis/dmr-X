# AI Model Categories Research (2024-2026)

**Date:** June 8, 2026
**Purpose:** Comprehensive catalog of ALL AI model categories with 4-tier system mapping for DMR-X

---

## Executive Summary

The AI landscape has evolved from "big models do everything" to a **heterogeneous ecosystem** of specialized, purpose-built models. This research identifies **18 distinct model categories** and maps them to a proposed 4-tier system (Brain/Thinker/Executor/Worker). Key finding: **several categories DON'T fit neatly into any single tier** — they are cross-cutting or serve as infrastructure layers.

---

## The 4-Tier System (Proposed)

| Tier | Name | Role | Characteristics |
|------|------|------|----------------|
| **T1** | **Brain** | Strategic reasoning, frontier intelligence | Highest capability, most expensive, slowest, handles novel/complex problems |
| **T2** | **Thinker** | Reasoning, planning, code generation | Strong reasoning with better cost/latency, handles structured multi-step tasks |
| **T3** | **Executor** | Task execution, API calls, tool use | Fast, reliable, follows instructions precisely, handles well-defined workflows |
| **T4** | **Worker** | Simple tasks, classification, extraction | Cheapest, fastest, smallest, handles repetitive/high-volume tasks |

---

## COMPLETE MODEL CATEGORY CATALOG

### CATEGORY 1: General-Purpose LLMs (Chat Models)

**What:** Foundation models trained on broad web data for general conversation, Q&A, and text generation.

**Tier Mapping:** Spans ALL tiers (T1-T4) depending on size/capability

| Sub-tier | Examples | Size | Use Case |
|----------|----------|------|----------|
| **T1 (Brain)** | GPT-5.2, Claude Opus 4.7, Gemini 3.1 Pro | Undisclosed (est. 400B+) | Frontier reasoning, novel problems |
| **T2 (Thinker)** | GPT-5.4, Claude Sonnet 4.6, Gemini 2.5 Pro, Llama 4 Maverick | 100B-400B | Daily driver, analysis, complex tasks |
| **T3 (Executor)** | GPT-5 mini, Claude Haiku 4.5, Gemini 2.5 Flash, Llama 3.3 70B | 7B-70B | High-volume processing, routing |
| **T4 (Worker)** | GPT-5 nano, Gemini Flash Lite, Phi-4 Mini, Gemma 3 4B | <7B | Classification, extraction, simple chat |

**Key Models (2026):**
- OpenAI: GPT-5.2 ($1.75/$14/1M), GPT-5.4 ($2.50/$15/1M), GPT-5 nano ($0.05/$0.40/1M)
- Anthropic: Opus 4.7 ($5/$25/1M), Sonnet 4.6 ($3/$15/1M), Haiku 4.5 ($1/$5/1M)
- Google: Gemini 3.1 Pro ($2-4/$12-18/1M), Gemini 2.5 Flash ($0.15/$0.60/1M)
- Meta: Llama 4 Scout (109B, 10M context), Llama 4 Maverick (400B)
- DeepSeek: V3.2 ($0.14/$0.28/1M), R1 ($0.55/$2.19/1M)
- Open-weight: Qwen3-235B, Mistral Large 3, MiniMax-M2

---

### CATEGORY 2: Reasoning Models (Chain-of-Thought)

**What:** Models that "think step-by-step" before answering. Use test-time compute scaling — they spend more tokens reasoning to produce better answers on complex problems.

**Tier Mapping:** Primarily **T1 (Brain)** and **T2 (Thinker)**

| Sub-tier | Examples | Key Trait |
|----------|----------|-----------|
| **T1 (Brain)** | o3, o1-pro, Claude Opus 4.7 (extended thinking), Gemini 3.1 Pro (deep think) | Deep reasoning, most expensive |
| **T2 (Thinker)** | o4-mini, DeepSeek R1, Gemini 2.5 Flash (thinking), Qwen3-Thinking | Strong reasoning, better cost |

**Key Models:**
- OpenAI o3: $2/$8/1M (reasoning tokens)
- OpenAI o4-mini: $1.10/$4.40/1M
- DeepSeek R1: $0.55/$2.19/1M (open-weight, 1/27th cost of o1)
- Gemini 2.5 Flash thinking: $0.15/$0.60/1M

**Why it's distinct:** Reasoning models fundamentally change the inference paradigm. They produce 3-10x more output tokens (internal reasoning traces) before giving an answer, dramatically improving accuracy on math, science, and complex logic.

---

### CATEGORY 3: Code-Specialized Models

**What:** Models fine-tuned specifically for code generation, completion, debugging, and software engineering tasks.

**Tier Mapping:** **T2 (Thinker)** and **T3 (Executor)**

| Sub-tier | Examples | Use Case |
|----------|----------|----------|
| **T2 (Thinker)** | Claude Opus 4.7 (best code), GPT-5 Codex, DeepSeek Coder V2 | Complex multi-file coding, architecture |
| **T3 (Executor)** | Codestral, DeepSeek Coder, Qwen2.5-Coder, StarCoder2 | Code completion, refactoring, snippets |

**Key Models:**
- Codestral (Mistral): $0.20/$0.60/1M — fill-in-the-middle specialist
- DeepSeek Coder: Open-weight, strong at code
- Qwen2.5-Coder: 7B-32B variants, competitive
- GitHub Copilot (GPT-4o based): IDE integration

---

### CATEGORY 4: Multimodal Models (Vision + Text + Audio)

**What:** Models that can process and/or generate across multiple modalities — text, images, audio, video.

**Tier Mapping:** **T1 (Brain)** and **T2 (Thinker)** — multimodal remains a premium capability

| Sub-tier | Examples | Modalities |
|----------|----------|------------|
| **T1 (Brain)** | GPT-5.2, Claude Opus 4.7, Gemini 3.1 Pro | Text+Image+Audio+Video |
| **T2 (Thinker)** | GPT-4o, Gemini 2.5 Flash, Llama 4 Scout, Qwen3-Omni | Text+Image+Audio |

**Key Models:**
- GPT-4o: Native multimodal (text, image, audio, video) — $2.50/$10/1M
- Gemini 2.0 Flash: Multimodal with 1M context
- Claude 3.5 Sonnet: Vision + text (no audio)
- Qwen3-Omni: Open-weight multimodal
- Pixtral (Mistral): Vision specialist

**Note:** In 2026, multimodal is becoming "table stakes" — every frontier model handles images. Audio/video output remains premium.

---

### CATEGORY 5: Embedding Models

**What:** Models that convert text (or images) into dense vector representations for search, retrieval, clustering, and RAG.

**Tier Mapping:** **Does NOT fit any of the 4 tiers** — this is a **cross-cutting infrastructure category**

These aren't "workers" or "thinkers" — they're **enablers** that other tiers depend on. They perform a fundamentally different operation (encoding → vectors, not generation).

| Use Case | Examples | Dims |
|----------|----------|------|
| **General embedding** | text-embedding-3-large, Cohere embed-v4, Jina v3 | 1024-3072 |
| **RAG/retrieval** | Voyage-3, BGE-M3, GTE-Qwen1.5-7B | 1024 |
| **Code embedding** | Voyage-Code-3, Nomic v2 | 1024 |
| **Law/Finance** | Voyage-Law-2, Voyage-Finance-2 | 1024 |
| **Multilingual** | Cohere embed-multilingual, BGE-M3 | 1024 |

**Pricing:** ~$0.02-$0.10 per 1M tokens (very cheap)
**Free options:** Jina (1M tokens/month), Nomic (free tier), Cohere (trial)

---

### CATEGORY 6: Reranking Models

**What:** Models that take a query + list of documents and re-order them by relevance. Used as a second pass after embedding retrieval.

**Tier Mapping:** **Cross-cutting infrastructure** — like embeddings, these are enablers

| Provider | Model | Notes |
|----------|-------|-------|
| Cohere | rerank-v3.5 | Best-in-class, $1/1000 searches |
| Jina | jina-reranker-v2 | ColBERT late interaction |
| Voyage | rerank-2 | Domain-specific variants |

**Pricing:** ~$1 per 1000 searches

---

### CATEGORY 7: Content Moderation / Safety Models

**What:** Specialized classifiers that detect harmful, toxic, or policy-violating content in LLM inputs and outputs.

**Tier Mapping:** **T4 (Worker)** — lightweight classifiers, high-volume, low-latency

| Model | Provider | Size | Notes |
|-------|----------|------|-------|
| Llama Guard 3 | Meta | 8B | Open-weight safety classifier |
| ShieldGemma 2/9/27B | Google | 2B-27B | Built on Gemma2, best AU-PRC |
| Nemotron-Content-Safety | NVIDIA | 4B | Custom policy enforcement |
| Aegis Safety Experts | NVIDIA | Multiple | Ensemble of LLM safety models |
| STAND-Guard | Research | 7B | Task-adaptive, 40+ datasets |
| OpenAI Moderation | OpenAI | - | API-based, binary classification |

**Key insight:** These are fine-tuned classifiers, not generative models. They're "workers" that run on every input/output.

---

### CATEGORY 8: Tool-Use / Function-Calling Models

**What:** Models specifically trained or optimized for calling external APIs, tools, and executing structured function calls.

**Tier Mapping:** **T2 (Thinker)** and **T3 (Executor)**

| Sub-tier | Examples | Notes |
|----------|----------|-------|
| **T2 (Thinker)** | GPT-5.4, Claude Opus 4.7, Gemini 2.5 Pro | Complex multi-step tool orchestration |
| **T3 (Executor)** | Tool-Llama, Gorilla, ToolR1 | Specialized single-tool calling |

**Key Research:**
- Tool-R1: RL framework for tool-use via Python code generation
- MATRIX: Multimodal agent tuning for tool reasoning
- DeepAgent: Autonomous tool discovery + execution
- ToolOmni: Open-world tool retrieval + grounded execution

**Key models with native tool use:**
- All GPT-5.x models (native structured outputs)
- Claude models (tool_use blocks)
- Gemini models (function calling with JSON schema)
- Llama 3.1+ (tool_use support)
- Qwen3 (native tool calling)

---

### CATEGORY 9: Agentic Models / AI Agents

**What:** Models designed to autonomously plan, execute multi-step tasks, use tools, browse web, write and execute code, and interact with environments.

**Tier Mapping:** **T1 (Brain)** and **T2 (Thinker)** — agentic = reasoning + planning + execution

| Sub-tier | Examples | Notes |
|----------|----------|-------|
| **T1 (Brain)** | OpenAI Deep Research, Grok 3 Deep Search, Gemini Deep Research | Multi-hour autonomous research |
| **T2 (Thinker)** | Claude Sonnet 4.6 (computer use), GPT-5 Codex (agentic coding) | Task-specific agents |

**Key models/frameworks:**
- OpenAI Codex agent (May 2025): Agentic code generation
- Claude 4.5+ with computer use
- GPT-5.4 with native computer use
- DeepAgent: End-to-end reasoning + tool discovery
- Grok 4.20-multi-agent: Multi-agent coordination

**Agentic ≠ a model type** — it's an architectural paradigm. Any sufficiently capable LLM can be "agentic" when wrapped in the right framework (ReAct, Plan-and-Solve, etc.).

---

### CATEGORY 10: Small Language Models (SLMs) / Edge Models

**What:** Models under ~5B parameters designed to run on-device (phones, IoT, edge hardware) with minimal compute.

**Tier Mapping:** **T4 (Worker)** — optimized for specific, simple tasks on constrained hardware

| Model | Size | Hardware | Use Case |
|-------|------|----------|----------|
| Phi-4 Mini | 3.8B | Phone (1.8GB RAM) | On-device chat, classification |
| Phi-4 Multimodal | ~5B | Phone | Vision + text on-device |
| Gemma 3 4B | 4B | Phone/tablet | General SLM tasks |
| Qwen2.5 0.5B-3B | 0.5B-3B | IoT/mobile | Translation, extraction |
| Apple Intelligence 3B | 3B | iPhone/iPad | Summarization, emoji gen |
| Gemini Nano | 1.8B/3.25B | Android | On-device AI, 128K context |
| SmolLM | 135M-1.7B | Wearables | Ultra-lightweight tasks |
| StableLM 2 | 1.6B | Laptop | Text generation |

**Key insight:** SLMs are NOT just "small LLMs" — they're often trained on curated/synthetic data to punch above their weight. Phi-3-mini (3.8B) matches Mixtral 8x7B (45B total) on many benchmarks.

---

### CATEGORY 11: Image Generation Models (Diffusion)

**What:** Models that generate images from text prompts (or edit existing images). Based on diffusion architectures.

**Tier Mapping:** **Cross-cutting** — not a text tier, but a parallel modality

| Provider | Model | Type | Cost |
|----------|-------|------|------|
| Stability AI | SD3.5 Large | Open-weight | Credits |
| Midjourney | V7 | Subscription | $10-60/mo |
| Black Forest Labs | Flux Pro 1.1 | API | $0.05/image |
| OpenAI | GPT-Image-1 | API | Per-token |
| Google | Imagen 3.0 | API | Per-image |
| Ideogram | V_2A | API | $0.08/image |

**Pricing:** $0.02-$0.08 per image (API) or $10-60/mo subscription

---

### CATEGORY 12: Video Generation Models

**What:** Models that generate video from text prompts or image inputs.

**Tier Mapping:** **Cross-cutting** — emerging modality, premium pricing

| Provider | Model | Type | Notes |
|----------|-------|------|-------|
| RunwayML | Gen-3 Alpha | API | Image-to-video, text-to-video |
| Pika Labs | Pika 2.0 | API | Video with special effects |
| Google | Veo 2 | API | Video generation |
| Sora (OpenAI) | Sora | API | Text-to-video |
| Synthesia | Avatar system | Subscription | AI avatar videos |

**Pricing:** Credit-based, $0.50-$5 per video clip

---

### CATEGORY 13: Audio Models (TTS/STT)

**What:** Models that convert between text and speech — text-to-speech (TTS) and speech-to-text (STT/ASR).

**Tier Mapping:** **T3 (Executor)** and **T4 (Worker)** — task-specific, high-volume

| Type | Provider | Model | Cost |
|------|----------|-------|------|
| **TTS** | ElevenLabs | eleven_multilingual_v2 | $5-99/mo |
| **TTS** | OpenAI | tts-1, tts-1-hd | $15/1M chars |
| **TTS** | Cartesia | Sonic | ~$0.01/1K chars |
| **STT** | Deepgram | Nova-2 | $0.0043/min |
| **STT** | AssemblyAI | Universal-2 | $0.015/min |
| **STT** | OpenAI | Whisper | $0.006/min |
| **STT** | Groq | Whisper (fast) | Free tier |

**Key insight:** Audio models are NOT generative LLMs — they're specialized encoder/decoder architectures. Whisper runs locally for free.

---

### CATEGORY 14: Math-Specialized Models

**What:** Models fine-tuned for mathematical reasoning, theorem proving, and quantitative analysis.

**Tier Mapping:** **T2 (Thinker)** — reasoning-heavy, specialized

| Model | Size | Notes |
|-------|------|-------|
| DeepSeek R1 | 671B MoE | Strong math reasoning |
| Qwen-Max | Large | Math benchmarks |
| Gemini (thinking modes) | Large | Math via CoT |
| Phi-4 (math variants) | Small | Surprisingly capable |

**Note:** Math capability is increasingly a feature of reasoning models (Category 2) rather than standalone models.

---

### CATEGORY 15: Translation / Multilingual Models

**What:** Models optimized for cross-lingual tasks and translation across many languages.

**Tier Mapping:** **T3 (Executor)** and **T4 (Worker)** — high-volume, well-defined task

| Model | Languages | Notes |
|-------|-----------|-------|
| Qwen3 (various) | 140+ | Strong multilingual |
| Command A Translate | 23 | Fine-tuned for translation |
| Aya Vision (Cohere) | 23 | Multimodal + multilingual |
| Tiny Aya | 70+ | 3.35B, edge deployment |
| NLLB (Meta) | 200 | Open-weight translation |

---

### CATEGORY 16: RAG-Specialized Models

**What:** Models specifically designed or optimized for Retrieval-Augmented Generation — combining retrieval with generation.

**Tier Mapping:** **Cross-cutting** — RAG is a system pattern, not a model type

RAG systems combine:
- **Embedding models** (Category 5) for retrieval
- **Reranking models** (Category 6) for precision
- **LLMs** (Categories 1-4) for generation
- **Vector databases** (Pinecone, Weaviate) for storage

**Key RAG-optimized models:**
- Cohere Command R+ ($2.50/$10/1M) — native RAG with citation
- Cohere Command R — lighter RAG model
- Google Gemini (grounding with Google Search)
- Perplexity Sonar — search-augmented generation

---

### CATEGORY 17: Specialized Enterprise Models

**What:** Models fine-tuned for specific industries or regulatory domains.

**Tier Mapping:** **T2-T3** depending on capability

| Domain | Model | Provider | Notes |
|--------|-------|----------|-------|
| **Legal** | Voyage-Law-2 | Voyage AI | Legal document embedding |
| **Finance** | Voyage-Finance-2 | Voyage AI | Financial document embedding |
| **Medical** | HuatuoGPT | Research | Medical dialogue |
| **Biomedical** | BioMistral | Research | Biomedical NLP |
| **Medical STT** | Nova-2-Medical | Deepgram | Medical transcription |
| **Financial** | Amazon Nova Pro | AWS | Financial document analysis |
| **Enterprise Search** | Snowflake Arctic | Snowflake | SQL/enterprise optimized |

---

### CATEGORY 18: Mixture-of-Experts (MoE) Models

**What:** Architecture where only a subset of parameters is activated per input, reducing inference cost while maintaining large total capacity.

**Tier Mapping:** **Cross-cutting** — MoE is an architecture, not a capability tier

| Model | Total Params | Active Params | Notes |
|-------|-------------|---------------|-------|
| DeepSeek V3 | 671B | 37B | Cheapest frontier |
| Qwen3-235B-A22B | 235B | 22B | Open-weight |
| Llama 4 Scout | 109B | 17B | 10M context |
| Llama 4 Maverick | 400B | 17B | Meta flagship |
| Mistral Large 3 | 675B | 41B | European flagship |
| Mixtral 8x22B | 176B | 44B | Open-weight |
| Kimi-K2 | 1T total | 32B active | Top coding |

**Key insight:** MoE is what makes "open-weight beats proprietary" possible — you get GPT-4 class quality at 1/10th the inference cost.

---

### CATEGORY 19: Domain-Specific / Vertical Models

**What:** Models fine-tuned for narrow, specific tasks rather than general capabilities.

**Tier Mapping:** **T3 (Executor)** and **T4 (Worker)** — specialized, high-volume

| Task | Examples | Size |
|------|----------|------|
| **OCR / Document** | Upstage Document AI, Mistral OCR | Varies |
| **Summarization** | Any 7B+ model with fine-tuning | 7B+ |
| **Classification** | Fine-tuned BERT, RoBERTa, Phi-4 | 100M-3B |
| **Sentiment** | DistilBERT, fine-tuned SLMs | 66M-3B |
| **Named Entity** | SpaCy + LLM hybrid | Varies |
| **Spam Detection** | Fine-tuned BERT classifiers | 100M-3B |

---

### CATEGORY 20: World Models / Simulation Models

**What:** Models that learn the dynamics of the physical world for planning and simulation. Still emerging.

**Tier Mapping:** **T1 (Brain)** — experimental, cutting-edge

| Model | Provider | Notes |
|-------|----------|-------|
| World models (various) | Research | Video prediction + planning |
| GAIA-1 | Wayve | Autonomous driving |
| UniSim | Google DeepMind | Universal simulator |

**Status:** Largely experimental as of 2026.

---

## CATEGORIES THAT DON'T FIT THE 4-TIER SYSTEM

The following categories are **cross-cutting concerns** that don't map cleanly to any single tier:

### 1. Embedding Models (Category 5)
- **Why:** They produce vectors, not text. They're infrastructure, not "workers" or "thinkers."
- **Better mapping:** Infrastructure layer (like databases or search engines)

### 2. Reranking Models (Category 6)
- **Why:** Same as embeddings — they're retrieval components, not generative.
- **Better mapping:** Infrastructure layer

### 3. Content Moderation (Category 7)
- **Why:** They're classifiers that run as middleware/guardrails. They're "security systems," not workers.
- **Better mapping:** Guardrail/middleware layer

### 4. Image/Video Generation (Categories 11, 12)
- **Why:** These are parallel modalities. A 4-tier text LLM system doesn't capture image generation.
- **Better mapping:** Separate modality system (or "Creative tier")

### 5. Audio Models (Category 13)
- **Why:** TTS/STT are I/O adapters, not reasoning systems.
- **Better mapping:** I/O adapter layer

### 6. MoE Architecture (Category 18)
- **Why:** MoE is an architecture choice, not a capability level. A MoE model can be T1-T4.
- **Better mapping:** Implementation detail, not a tier

### 7. Agentic Systems (Category 9)
- **Why:** Agents are SYSTEMS, not models. An agent wraps a model with tools, memory, and planning.
- **Better mapping:** Orchestration layer (above all tiers)

---

## TIER MAPPING SUMMARY

### T1 — Brain (Strategic Intelligence)
- Frontier general-purpose LLMs (GPT-5.2, Claude Opus 4.7, Gemini 3.1 Pro)
- Frontier reasoning models (o3, o1-pro)
- Research agents (Deep Research, Grok Deep Search)
- World models (experimental)

**Use when:** Novel problems, complex multi-domain reasoning, highest accuracy needed
**Cost:** $5-$30/1M tokens (output)
**Latency:** 2-30 seconds per response

### T2 — Thinker (Operational Intelligence)
- Mid-tier general LLMs (GPT-5.4, Claude Sonnet 4.6, Gemini 2.5 Pro)
- Reasoning models (o4-mini, DeepSeek R1, Gemini Flash thinking)
- Code specialists (Codestral, DeepSeek Coder)
- Tool-use orchestrators
- Enterprise domain models

**Use when:** Multi-step tasks, code generation, analysis, tool orchestration
**Cost:** $0.55-$15/1M tokens (output)
**Latency:** 1-10 seconds per response

### T3 — Executor (Task Execution)
- Small general LLMs (GPT-5 mini, Claude Haiku, Gemini Flash)
- Open-weight models (Llama 3.3 70B, Qwen2.5-72B)
- Multilingual/translation models
- RAG-optimized models (Command R)
- Audio I/O (TTS/STT)

**Use when:** High-volume processing, well-defined tasks, cost-sensitive
**Cost:** $0.10-$5/1M tokens (output)
**Latency:** 200ms-2 seconds

### T4 — Worker (Simple Tasks)
- Nano/small models (GPT-5 nano, Gemini Flash Lite, Phi-4 Mini, Gemma 3 4B)
- Edge models (<3B parameters)
- Classification/extraction models
- Content moderation classifiers
- Simple routing/recommendation

**Use when:** Classification, extraction, routing, high-volume simple tasks
**Cost:** $0.00-$0.50/1M tokens (output)
**Latency:** 50-500ms

---

## PRICING LANDSCAPE (2026)

### Budget Tier (<$0.50/1M output tokens)
| Model | Provider | Cost |
|-------|----------|------|
| DeepSeek V3.2 | DeepSeek | $0.28 |
| Yi-Lightning | 01.AI | $0.14 |
| Gemini Flash Lite | Google | ~$0.10 |
| GPT-5 nano | OpenAI | $0.40 |
| Llama 4 Scout (hosted) | Meta/partners | ~$0.59 |

### Mid Tier ($0.50-$5/1M output tokens)
| Model | Provider | Cost |
|-------|----------|------|
| Gemini 2.5 Flash | Google | $0.60 |
| DeepSeek R1 | DeepSeek | $2.19 |
| Grok 4 Mini | xAI | $0.50 |
| GPT-5 mini | OpenAI | $2.00 |
| Claude Haiku 4.5 | Anthropic | $5.00 |

### Premium Tier ($5-$15/1M output tokens)
| Model | Provider | Cost |
|-------|----------|------|
| GPT-5.4 | OpenAI | $15.00 |
| Claude Sonnet 4.6 | Anthropic | $15.00 |
| Gemini 2.5 Pro | Google | $5-10 |
| Grok 4 | xAI | $15.00 |
| DeepSeek R1 | DeepSeek | $2.19 (still cheap!) |

### Ultra-Premium Tier ($15+/1M output tokens)
| Model | Provider | Cost |
|-------|----------|------|
| GPT-5.2 Pro | OpenAI | $168.00 |
| Claude Opus 4.7 | Anthropic | $25.00 |
| Gemini 3.1 Pro | Google | $12-18 |
| o1-pro | OpenAI | $600.00 |

### Free Options
| Provider | Models | Limits |
|----------|--------|--------|
| Google AI Studio | Gemini Flash | 15 RPM, 1M TPM |
| OpenRouter | 29 free models | ~20 RPM |
| Groq | Llama 3.3 70B | 30 RPM, 500+ tok/sec |
| Cerebras | Llama 70B | 30 RPM, 2000+ tok/sec |
| SambaNova | Llama 405B, DeepSeek | 100 RPM |

---

## LOCAL vs CLOUD DEPLOYMENT

### When to Run Locally
- **Privacy:** PII, medical, legal, financial data
- **Cost at scale:** >5M tokens/day → local pays for itself in 12-18 months
- **Latency:** Real-time applications needing <100ms TTFT
- **Compliance:** HIPAA, GDPR, data sovereignty
- **Offline:** Edge/IoT environments

### When to Use Cloud
- **Frontier capability:** GPT-5.2, Claude Opus 4.7 (no local equivalent)
- **Low volume:** <1M tokens/day
- **Multimodal:** Audio, video, complex vision
- **No infrastructure:** Quick prototyping
- **Scalability:** Burst traffic

### Hybrid Pattern (Recommended)
1. **Plan with frontier cloud model** (Brain tier)
2. **Execute with local/cheap models** (Worker tier)
3. **Route by data sensitivity** (PII → local, public → cloud)
4. **Route by complexity** (simple → local, complex → cloud)

---

## KEY TRENDS (2024-2026)

1. **Reasoning as a first-class capability** — Every provider now has a "thinking" model
2. **Multimodal table stakes** — Text-only models are deprecated
3. **MoE dominance** — Open-weight MoE models match proprietary at 1/10th cost
4. **Price collapse** — GPT-4 class quality now available at <$0.30/1M tokens
5. **Context window explosion** — From 4K (2023) to 10M+ (2026)
6. **Small model renaissance** — 3B models matching 70B from 18 months ago
7. **Agentic paradigm shift** — Models don't just answer, they act
8. **Heterogeneous systems** — Right-sized models for right-sized tasks
9. **On-device AI** — Apple Intelligence, Gemini Nano, Phi-4 on phones
10. **Test-time compute scaling** — Spending more tokens at inference for better answers

---

## RECOMMENDATIONS FOR DMR-X

### Model Routing Strategy
Based on this research, DMR-X should implement a **multi-tier routing system**:

1. **Tier detection** — Classify incoming requests by complexity and sensitivity
2. **Model selection** — Route to appropriate tier based on:
   - Task complexity (simple → T4, complex → T1)
   - Data sensitivity (PII → local, public → cloud)
   - Cost budget (high-volume → cheap models)
   - Latency requirements (real-time → fast models)

3. **Fallback chain** — If primary model fails or is rate-limited, fall back to next tier

### Integration Priority
1. **Embedding models** — Foundation for RAG (Cohere, Jina, Voyage)
2. **Reranking** — Second-pass retrieval (Cohere, Jina)
3. **Content moderation** — Safety guardrails (Llama Guard, ShieldGemma)
4. **Multi-tier LLMs** — Brain/Thinker/Executor/Worker routing
5. **Audio I/O** — TTS/STT adapters (Deepgram, ElevenLabs)
6. **Image generation** — Creative capabilities (Flux, Stable Diffusion)

---

*Research compiled from: HAI AI Index Report 2025, Springer LLM Taxonomy survey, LLM Evolution catalog, MTEB benchmarks, provider documentation, and web research.*
