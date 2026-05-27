# Exhaustive AI API Provider Research

**Date:** 2026-05-21
**Sources:** OpenRouter live API (80+ models), cool-ai-stuff GitHub (15+ free APIs), DMR-X catalog (37 providers), training knowledge

---

## Summary Stats

- **Total unique providers identified:** 100+
- **Tier 1 (Major Labs):** 12
- **Tier 2 (Established Cloud/Hosting):** 18
- **Tier 3 (Regional - China):** 14
- **Tier 4 (Regional - Korea/Japan/India/EU/ME):** 12
- **Tier 5 (Free/Aggregator/Community):** 18
- **Tier 6 (Specialized - Code/Vision/Audio/Embedding/Moderation):** 20+
- **Tier 7 (New Startups / Emerging):** 10+

---

## TIER 1: MAJOR AI LABS (Direct API Access)

### 1. OpenAI
- **Website:** https://openai.com
- **API Base:** `https://api.openai.com/v1`
- **Format:** OpenAI native
- **Auth:** Bearer token
- **Models:** GPT-5.5, GPT-5.5-pro, GPT-5.4, GPT-5.4-pro, GPT-5.4-mini, GPT-5.4-nano, GPT-5.4-image-2, GPT-5.3-chat, GPT-4.1, GPT-4.1-mini, GPT-4o, GPT-4o-mini, o3, o3-mini, o4-mini, DALL-E 3, GPT-IMAGE-1, Whisper, TTS, text-embedding-3-small/large
- **Free tier:** None (pay-as-you-go)
- **Notes:** Industry standard. 1M context on GPT-4.1.

### 2. Anthropic
- **Website:** https://anthropic.com
- **API Base:** `https://api.anthropic.com/v1`
- **Format:** Anthropic native
- **Auth:** `x-api-key` header
- **Models:** Claude Opus 4.7, Claude Opus 4.7-fast, Claude Opus 4.6-fast, Claude Sonnet 4, Claude Haiku 3.5, Claude Haiku latest
- **Free tier:** None
- **Notes:** 200K context. Best for code, reasoning, safety.

### 3. Google (Gemini)
- **Website:** https://ai.google.dev
- **API Base:** `https://generativelanguage.googleapis.com/v1beta`
- **Format:** Google native (also OpenAI-compatible via `https://generativelanguage.googleapis.com/v1beta/openai/`)
- **Auth:** API key query param (`?key=`)
- **Models:** Gemini 3.5 Flash, Gemini 3.1 Flash Lite, Gemini 3.1 Flash Image Preview, Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.0 Flash, Gemma 4-31b, Gemma 4-26b, Lyria 3 (audio), text-embedding-004, Imagen 3.0
- **Free tier:** YES - Generous free tier in Google AI Studio:
  - Gemini 2.5 Flash: 15 RPM, 1M TPD, 1500 RPD
  - Gemini 2.0 Flash: 15 RPM, 1M TPD, 1500 RPD
  - Gemma models: Free on AI Studio
- **Notes:** 1M+ context. Free tier is one of the most generous.

### 4. xAI (Grok)
- **Website:** https://x.ai
- **API Base:** `https://api.x.ai/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Grok 4.3, Grok 4.20, Grok 4.20-multi-agent, Grok 3, Grok 3-mini, Grok Build 0.1
- **Free tier:** $25/month free credits for new accounts
- **Notes:** Real-time X/Twitter data access.

### 5. Mistral AI
- **Website:** https://mistral.ai
- **API Base:** `https://api.mistral.ai/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Mistral Medium 3.5, Mistral Large 3 (675B), Mistral Small (2603), Codestral, Pixtral Large, Mistral Embed
- **Free tier:** Free tier on La Plateforme (limited RPM)
- **Notes:** European (French) lab. Strong code models.

### 6. DeepSeek
- **Website:** https://deepseek.com
- **API Base:** `https://api.deepseek.com/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** DeepSeek V4 Pro, DeepSeek V4 Flash, DeepSeek V3.2, DeepSeek R1, DeepSeek Chat
- **Free tier:** Very cheap pricing. Some models free on OpenRouter.
- **Notes:** Chinese lab. Extremely cost-effective. Strong reasoning.

### 7. Cohere
- **Website:** https://cohere.com
- **API Base:** `https://api.cohere.com/v2`
- **Format:** Custom (Cohere native)
- **Auth:** Bearer token
- **Models:** Command R+, Command R, Embed English/Multilingual v3.0, Rerank English/Multilingual v3.0
- **Free tier:** Free trial key with rate limits
- **Notes:** Best for enterprise search, reranking, RAG.

### 8. Amazon Bedrock
- **Website:** https://aws.amazon.com/bedrock/
- **API Base:** `https://bedrock-runtime.{region}.amazonaws.com`
- **Format:** AWS SDK (also OpenAI-compatible via proxy)
- **Auth:** AWS IAM (SigV4)
- **Models:** Claude, Llama, Mistral, Titan, Cohere, AI21, Stability, DeepSeek (via marketplace)
- **Free tier:** Free tier for some models during evaluation
- **Notes:** Multi-model gateway. AWS ecosystem.

### 9. Azure OpenAI
- **Website:** https://azure.microsoft.com/en-us/products/ai-services/openai-service
- **API Base:** `https://{resource}.openai.azure.com/openai`
- **Format:** OpenAI-compatible
- **Auth:** API key or Azure AD token
- **Models:** GPT-4o, GPT-4, GPT-3.5-Turbo, DALL-E, Whisper, Embeddings
- **Free tier:** Azure free tier includes some credits
- **Notes:** Enterprise-grade. Regional deployments.

### 10. Vertex AI (Google Cloud)
- **Website:** https://cloud.google.com/vertex-ai
- **API Base:** `https://{region}-aiplatform.googleapis.com/v1`
- **Format:** Google SDK (also OpenAI-compatible via proxy)
- **Auth:** Google Cloud IAM / Service Account
- **Models:** Gemini, PaLM, Claude (via Model Garden), Llama, Mistral, Gemma
- **Free tier:** $300 free credits for new GCP accounts
- **Notes:** Enterprise Google Cloud AI platform.

### 11. IBM watsonx.ai
- **Website:** https://www.ibm.com/products/watsonx-ai
- **API Base:** `https://{region}.ml.cloud.ibm.com/ml/v1`
- **Format:** Custom (IBM SDK)
- **Auth:** IAM token or API key
- **Models:** Granite 4.1-8b, Granite 4.0-micro, Granite 3.x series, Llama (hosted)
- **Free tier:** Lite plan with limited usage
- **Notes:** Enterprise AI. Granite is IBM's own model family.

### 12. Databricks (DBRX)
- **Website:** https://www.databricks.com/product/generative-ai
- **API Base:** `https://{workspace}.databricks.com/serving-endpoints`
- **Format:** OpenAI-compatible
- **Auth:** Databricks token
- **Models:** DBRX, Llama, Mistral, Mixtral (hosted), custom fine-tuned models
- **Free tier:** Free trial available
- **Notes:** Lakehouse AI platform. Strong for enterprise data + AI.

---

## TIER 2: ESTABLISHED CLOUD/HOSTING PROVIDERS

### 13. OpenRouter
- **Website:** https://openrouter.ai
- **API Base:** `https://openrouter.ai/api/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** 200+ models from 40+ providers (all major labs + open source)
- **Free tier:** YES - ~19+ free models:
  - Free models include: DeepSeek V4 Flash, Gemma 4-26b/31b, Nemotron variants, Poolside Laguna, Baidu CoBuddy, GPT-OSS-20b
  - Rate limits: ~20 RPM for free tier
- **Notes:** Meta-aggregator. Routes to best provider. One API key for everything.

### 14. Together AI
- **Website:** https://together.ai
- **API Base:** `https://api.together.xyz/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Llama 4 Maverick, Llama 3.3-70B, Qwen 2.5-72B, Mixtral, DeepSeek, FLUX, SDXL, Whisper
- **Free tier:** $5 free credits on signup
- **Notes:** Best for open-source model hosting. Also does diffusion/audio.

### 15. Fireworks AI
- **Website:** https://fireworks.ai
- **API Base:** `https://api.fireworks.ai/inference/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Llama 3.3-70B, DeepSeek V3, Mixtral, function calling models
- **Free tier:** Free tier with rate limits
- **Notes:** Fast inference. Good for function calling.

### 16. Groq
- **Website:** https://groq.com
- **API Base:** `https://api.groq.com/openai/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Llama 3.3-70B, Llama 3.1-8B, Mixtral 8x7B, Gemma, Llama Guard
- **Free tier:** YES - Free tier with rate limits:
  - 30 RPM, ~14,400 RPD, varies by model
  - Generous for small-scale use
- **Notes:** LPU-based inference. Fastest API responses in the industry.

### 17. Cerebras
- **Website:** https://cerebras.ai
- **API Base:** `https://api.cerebras.ai/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Llama 3.3-70B, Llama 3.1-8B
- **Free tier:** Free tier available with rate limits
- **Notes:** Wafer-scale chip. Extremely fast inference.

### 18. SambaNova
- **Website:** https://sambanova.ai
- **API Base:** `https://api.sambanova.ai/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Llama 3.3-70B, DeepSeek R1, Llama 3.1-8B
- **Free tier:** Free tier available
- **Notes:** RDU-based inference. Fast and cost-effective.

### 19. Replicate
- **Website:** https://replicate.com
- **API Base:** `https://api.replicate.com/v1`
- **Format:** Custom (Replicate native)
- **Auth:** Bearer token
- **Models:** SDXL, FLUX Schnell/Pro, MusicGen, Llama, Whisper, thousands of community models
- **Free tier:** Free tier with limited compute
- **Notes:** Run any open-source model. Great for diffusion/video/audio.

### 20. Hugging Face Inference
- **Website:** https://huggingface.co/inference-api
- **API Base:** `https://router.huggingface.co/v1` (HF Inference Providers) or `https://api-inference.huggingface.co/models/{model}`
- **Format:** OpenAI-compatible (via router) or HF native
- **Auth:** Bearer token (HF_TOKEN)
- **Models:** 200,000+ models on Hub. Key: Llama, Mistral, FLUX, Whisper, BGE embeddings
- **Free tier:** YES - Free tier for many models:
  - Rate limits vary by model (typically 3-10 RPM)
  - Some models always free, others time-limited
- **Notes:** Access 20+ inference backends with one token. Largest model hub.

### 21. Lepton AI
- **Website:** https://lepton.ai
- **API Base:** `https://api.lepton.ai/v1` (or per-deployment URL)
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Llama, Mixtral, custom deployments
- **Free tier:** Free credits on signup
- **Notes:** Serverless GPU inference platform.

### 22. Modal
- **Website:** https://modal.com
- **API Base:** Custom (serverless functions)
- **Format:** Python SDK (can serve OpenAI-compatible endpoints)
- **Auth:** Token-based
- **Models:** Any model you deploy
- **Free tier:** $30/month free compute
- **Notes:** Serverless GPU. Deploy any model as API.

### 23. Banana.dev
- **Website:** https://banana.dev
- **API Base:** Custom (per-deployment)
- **Format:** Custom SDK
- **Auth:** API key
- **Models:** Any model you deploy (Llama, Mistral, SDXL, etc.)
- **Free tier:** Free tier available
- **Notes:** Serverless GPU for ML models.

### 24. RunPod
- **Website:** https://runpod.io
- **API Base:** `https://api.runpod.io` (serverless endpoints)
- **Format:** Custom (can deploy OpenAI-compatible via vLLM/TGI)
- **Auth:** API key
- **Models:** Any model you deploy
- **Free tier:** No free tier (pay-per-use, very cheap)
- **Notes:** GPU cloud for inference. Cheapest GPU rental.

### 25. Lambda Labs
- **Website:** https://lambdalabs.com
- **API Base:** `https://api.lambdalabs.com/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Llama, Mistral (hosted)
- **Free tier:** No free tier
- **Notes:** GPU cloud. Competitive pricing.

### 26. Anyscale / Ray Serve
- **Website:** https://www.anyscale.com
- **API Base:** Custom per endpoint
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Llama, Mistral, Mixtral (hosted)
- **Free tier:** Free trial credits
- **Notes:** Ray-based inference platform.

### 27. Baseten
- **Website:** https://baseten.co
- **API Base:** `https://model-{id}.api.baseten.co/production`
- **Format:** OpenAI-compatible (for LLM models)
- **Auth:** API key
- **Models:** Llama, Mistral, FLUX, custom models
- **Free tier:** Free tier available
- **Notes:** Model deployment platform. Truss framework.

### 28. Novita AI
- **Website:** https://novita.ai
- **API Base:** `https://api.novita.ai/v3/openai`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Llama, Mistral, DeepSeek, SDXL, FLUX
- **Free tier:** Free credits on signup
- **Notes:** Cheap inference. Good for diffusion models.

### 29. Featherless AI
- **Website:** https://featherless.ai
- **API Base:** `https://api.featherless.ai/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** 4000+ open-source models (Llama, Mistral, Qwen, DeepSeek, etc.)
- **Free tier:** Free tier available
- **Notes:** Serverless access to thousands of open-source models.

---

## TIER 3: CHINESE AI PROVIDERS

### 30. Alibaba (Qwen / Tongyi)
- **Website:** https://dashscope.aliyun.com
- **API Base:** `https://dashscope.aliyuncs.com/compatible-mode/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Qwen 3.6 Max Preview, Qwen 3.6 Flash, Qwen 3.6 Plus, Qwen 3.6-27b, Qwen 3.6-35b-a3b, Qwen 3.5 Plus, Qwen 3.5-122b-a10b, Qwen 3.5-9b, Qwen 3.5-35b-a3b, Qwen 3.5-27b, Qwen 3 Coder (480B)
- **Free tier:** YES - Free tier on DashScope:
  - Qwen Turbo: 1M tokens free/month
  - Some models completely free
- **Notes:** Alibaba Cloud. Strong multilingual. Qwen is top-tier open source.

### 31. Baidu (Ernie / Qianfan)
- **Website:** https://cloud.baidu.com/product/wenxinworkshop
- **API Base:** `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop`
- **Format:** Custom (Baidu native), also OpenAI-compatible via Qianfan
- **Auth:** Access token (OAuth)
- **Models:** ERNIE 4.5, ERNIE 4.0, ERNIE 3.5, ERNIE Speed, ERNIE Lite, CoBuddy (OCR), Qianfan OCR
- **Free tier:** YES - Free tier available:
  - ERNIE Speed/Lite: Free with rate limits
  - CoBuddy: Free on OpenRouter
- **Notes:** China's largest search engine. Strong Chinese language.

### 32. Zhipu (GLM / Z.ai)
- **Website:** https://open.bigmodel.cn
- **API Base:** `https://open.bigmodel.cn/api/paas/v4`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token (JWT)
- **Models:** GLM-5.1, GLM-5 Turbo, GLM-5v Turbo, GLM-4.7, GLM-4.7-flash, GLM-4.6V-flash, GLM-4.5-flash, GLM-4
- **Free tier:** YES - Free tier:
  - GLM-4.5-flash/4.7-flash: FREE (10 RPM, ~5M tokens/month)
  - Paid models available at low cost
- **Notes:** Tsinghua-backed. Strong multimodal. GLM-5 is competitive.

### 33. ByteDance (Doubao / Seed)
- **Website:** https://www.volcengine.com/product/doubao
- **API Base:** `https://ark.cn-beijing.volces.com/api/v3`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Seed 2.0 Lite, Seed 2.0 Mini, Doubao Pro, Doubao Lite, Seed-Music
- **Free tier:** Free tier available on Volcano Engine
- **Notes:** TikTok parent. Cheap pricing. Strong multimodal.

### 34. Moonshot (Kimi)
- **Website:** https://platform.moonshot.cn
- **API Base:** `https://api.moonshot.cn/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Kimi K2.6, Kimi K2 Thinking, Moonshot v1-128k, Moonshot v1-32k
- **Free tier:** Free tier with token limits
- **Notes:** Long context specialist (up to 200K). Good for orchestration.

### 35. Xiaomi (MiMo)
- **Website:** https://dev.mi.com
- **API Base:** `https://api.xiaomi.com/v1` (via OpenRouter)
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** MiMo V2.5 Pro, MiMo V2.5, MiMo V2 Omni, MiMo V2 Pro
- **Free tier:** Available via OpenRouter free tier
- **Notes:** Strong at database, structured data, multimodal.

### 36. Tencent (Hunyuan)
- **Website:** https://cloud.tencent.com/product/hunyuan
- **API Base:** `https://hunyuan.tencentcloudapi.com`
- **Format:** Tencent SDK (also OpenAI-compatible)
- **Auth:** SecretId/SecretKey (HMAC)
- **Models:** Hunyuan Pro, Hunyuan Standard, Hunyuan Lite, HY3 Preview
- **Free tier:** Free tier available
- **Notes:** WeChat ecosystem integration.

### 37. Baichuan
- **Website:** https://platform.baichuan-ai.com
- **API Base:** `https://api.baichuan-ai.com/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Baichuan 4, Baichuan 3 Turbo, Baichuan 2
- **Free tier:** Free trial credits
- **Notes:** Chinese LLM specialist. Good at Chinese NLP.

### 38. 01.AI (Yi)
- **Website:** https://platform.lingyiwanwu.com
- **API Base:** `https://api.lingyiwanwu.com/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Yi-Lightning, Yi-Large, Yi-Medium, Yi-Spark, Yi-Vision
- **Free tier:** Free tier available (Yi-Spark is free)
- **Notes:** Founded by Kai-Fu Lee. Strong multimodal.

### 39. iFlytek (Spark)
- **Website:** https://xinghuo.xfyun.cn
- **API Base:** `https://spark-api-open.xf-yun.com/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token (JWT)
- **Models:** Spark Max, Spark Pro, Spark Lite, Spark 4.0
- **Free tier:** YES - Spark Lite is free
- **Notes:** China's leading speech AI company. Strong STT/TTS.

### 40. SenseTime (SenseNova)
- **Website:** https://platform.sensenova.cn
- **API Base:** `https://api.sensenova.cn/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token (JWT)
- **Models:** SenseChat 5, SenseChat 4, SenseNova
- **Free tier:** Free trial available
- **Notes:** Computer vision leader. Strong multimodal.

### 41. Minimax
- **Website:** https://platform.minimaxi.com
- **API Base:** `https://api.minimax.chat/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** MiniMax M2.7, MiniMax M2.5, MiniMax Text-01
- **Free tier:** Free credits on signup
- **Notes:** Strong at long context and multimodal.

### 42. Inception (Mercury)
- **Website:** https://inception.ai
- **API Base:** Via OpenRouter
- **Format:** OpenAI-compatible
- **Auth:** Via OpenRouter
- **Models:** Mercury 2
- **Free tier:** Available via OpenRouter
- **Notes:** Newer Chinese lab.

### 43. Kuaishou (Kwaipilot / Kat)
- **Website:** https://kwaipilot.com
- **API Base:** Via OpenRouter
- **Format:** OpenAI-compatible
- **Models:** Kat Coder Pro V2
- **Free tier:** Available via OpenRouter
- **Notes:** Code-specialized model from Kuaishou (short video company).

---

## TIER 4: REGIONAL PROVIDERS (Korea, Japan, India, Europe, Middle East)

### 44. Naver (HyperCLOVA X) - KOREA
- **Website:** https://clova.ai
- **API Base:** `https://clovastudio.apigw.ntruss.com`
- **Format:** Custom (Naver SDK)
- **Auth:** API key header
- **Models:** HyperCLOVA X, CLOVA Studio models
- **Free tier:** Free tier available for Korean developers
- **Notes:** Korea's dominant search/AI company. Best Korean language.

### 45. LG AI Research (EXAONE) - KOREA
- **Website:** https://exaone.ai
- **API Base:** Via various platforms
- **Format:** OpenAI-compatible (via adapters)
- **Models:** EXAONE 3.5, EXAONE 3.0
- **Free tier:** Research access available
- **Notes:** LG's AI research arm. Strong bilingual (EN/KR).

### 46. Samsung (Samsung AI) - KOREA
- **Website:** https://research.samsung.com
- **Models:** Samsung Gauss, various on-device models
- **API access:** Limited / enterprise
- **Notes:** On-device AI focus. Galaxy AI integration.

### 47. Sakana AI - JAPAN
- **Website:** https://sakana.ai
- **Models:** Evolutionary AI models, research models
- **API access:** Research/partnership
- **Notes:** Tokyo-based. Founded by ex-Google researchers.

### 48. Preferred Networks (PFN) - JAPAN
- **Website:** https://preferred.jp
- **API Access:** Enterprise/partnership
- **Models:** PLaMo (Japanese LLM)
- **Notes:** Japan's leading deep learning company.

### 49. rinna - JAPAN
- **Website:** https://rinna.co.jp
- **Models:** Japanese-language models (various sizes)
- **API access:** Via Hugging Face
- **Notes:** Japanese NLP specialist.

### 50. Kotoba Tech - JAPAN
- **Website:** https://kotoba.tech
- **Models:** Japanese speech/TTS models
- **API access:** Available
- **Notes:** Japanese TTS specialist.

### 51. Sarvam AI - INDIA
- **Website:** https://sarvam.ai
- **API Base:** `https://api.sarvam.ai`
- **Format:** Custom
- **Models:** Sarvam 2B (Indian languages), Saaras (STT), Mayura (TTS)
- **Free tier:** Free tier available
- **Notes:** India's leading AI startup. 10+ Indian languages.

### 52. Krutrim (Ola) - INDIA
- **Website:** https://krutrim.ai
- **Models:** Krutrim LLM (multilingual Indian)
- **API access:** Available
- **Free tier:** Free tier planned
- **Notes:** Ola's AI venture. Indian language focus.

### 53. Tech Mahindra (Project Indus) - INDIA
- **Website:** https://techmahindra.com
- **Models:** Indus LLM (Hindi/regional)
- **API access:** Enterprise
- **Notes:** Enterprise AI for Indian market.

### 54. Aleph Alpha - EUROPE (Germany)
- **Website:** https://aleph-alpha.com
- **API Base:** `https://api.aleph-alpha.com`
- **Format:** Custom
- **Auth:** API key
- **Models:** Luminous Supreme, Luminous Base, Luminous Extended
- **Free tier:** Free trial available
- **Notes:** European sovereignty AI. GDPR-compliant.

### 55. Mistral AI - EUROPE (France)
- **(See Tier 1 #5)**

### 56. Stability AI - EUROPE (UK)
- **(See Specialized/Diffusion section)**

### 57. Synthesia - EUROPE (UK)
- **Website:** https://synthesia.io
- **API access:** Enterprise API
- **Models:** AI avatar video generation
- **Notes:** AI video generation for enterprise.

### 58. Tabnine - EUROPE (Israel)
- **Website:** https://tabnine.com
- **Models:** Code completion models
- **API access:** IDE plugin + API
- **Notes:** Code AI. Privacy-focused.

### 59. AI21 Labs - MIDDLE EAST (Israel)
- **Website:** https://ai21.com
- **API Base:** `https://api.ai21.com/v1`
- **Format:** Custom (also OpenAI-compatible)
- **Auth:** API key header
- **Models:** Jamba 1.5, Jurassic-2, Maestro
- **Free tier:** Free tier with rate limits
- **Notes:** Strong at long context (Jamba is Mamba-based hybrid).

### 60. Cohere - (See Tier 1 #7, HQ in Canada/Toronto)

### 61. Technology Innovation Institute (TII) - UAE
- **Website:** https://tii.ae
- **Models:** Falcon 2, Falcon 180B, Falcon 40B
- **API access:** Via Hugging Face, Together, etc.
- **Free tier:** Models are open source (free to deploy)
- **Notes:** Abu Dhabi government research. Falcon was top open-source.

---

## TIER 5: FREE / AGGREGATOR / COMMUNITY PROVIDERS

### 62. NVIDIA NIM
- **Website:** https://build.nvidia.com
- **API Base:** `https://integrate.api.nvidia.com/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Free tier:** YES - Free tier:
  - 3 RPM, 1000 RPD, 4000 TPM, 500K TPD
  - Models: Llama 3.3-70B, Llama 4 Maverick, DeepSeek R1, Mistral Large 3 (675B), Nemotron variants
- **Notes:** NVIDIA's inference platform. Free tier for experimentation.

### 63. GitHub Models
- **Website:** https://github.com/marketplace/models
- **API Base:** `https://models.inference.ai.azure.com`
- **Format:** OpenAI-compatible
- **Auth:** GitHub Personal Access Token (Bearer)
- **Free tier:** YES - Free tier:
  - 15 RPM, 150 RPD, 8000 TPM
  - Models: GPT-4o, GPT-4o-mini, GPT-4.1, text-embedding-3-small
- **Notes:** Free with GitHub account. Uses Azure backend.

### 64. Cloudflare Workers AI
- **Website:** https://developers.cloudflare.com/workers-ai/
- **API Base:** `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1`
- **Format:** OpenAI-compatible
- **Auth:** Cloudflare API token (Bearer)
- **Free tier:** YES - Free tier:
  - 300 RPM, 10M tokens/month free
  - Models: Llama 3.3-70B, Llama 4 Scout, DeepSeek R1 Distill, Qwen 3-30b, Granite 4.0 Micro
- **Notes:** Edge inference. Extremely generous free tier.

### 65. Pollinations
- **Website:** https://pollinations.ai
- **API Base:** `https://text.pollinations.ai/openai`
- **Format:** OpenAI-compatible
- **Auth:** None (anonymous access)
- **Free tier:** YES - Completely free:
  - No API key required
  - Models: GPT-OSS-20b and others
  - Rate limits: ~10 RPM
- **Notes:** Anonymous free AI. Also does image generation.

### 66. LLM7
- **Website:** https://llm7.io
- **API Base:** `https://api.llm7.io/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token (optional)
- **Free tier:** YES - Free tier:
  - 10 RPM
  - Models: GPT-OSS-20b, Llama 3.1-8B, Codestral, GLM-4.6V-flash
- **Notes:** Free multi-model API.

### 67. Kilo Gateway
- **Website:** https://kilo.ai
- **API Base:** `https://api.kilo.ai/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Free tier:** YES - Free tier:
  - 10 RPM
  - Models: Nemotron Super 120B
- **Notes:** Free Nemotron access.

### 68. Ollama Cloud
- **Website:** https://ollama.com
- **API Base:** `https://api.ollama.com/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Free tier:** YES - Free tier:
  - 10 RPM
  - Models: Qwen3 Coder 480B, Mistral Large 3 (675B), DeepSeek V3.2, Kimi K2 Thinking, GLM-4.7, GPT-OSS-120B
- **Notes:** Ollama's cloud offering. Large models for free.

### 69. GROQ (See Tier 2 #16) - also has generous free tier

### Community/Grey-area providers (from cool-ai-stuff):

### 70. zukijourney
- **API Base:** `https://api.zukijourney.com/v1`
- **Format:** OpenAI-compatible
- **Models:** GPT-4.1, Claude 3.5, Gemini 2.5, DeepSeek R1, GPT-IMAGE-1, FLUX-Kontext
- **Free tier:** Free tier available (8000+ users)
- **Notes:** Largest community API. Also offers TTS, STT, embeddings, moderations.

### 71. ElectronHub
- **API Base:** `https://api.electronhub.ai/v1` (or playground.electronhub.ai)
- **Format:** OpenAI-compatible
- **Models:** GPT-4.1, Claude 3.5, Gemini 2.5, DeepSeek R1, FLUX-Kontext
- **Free tier:** Free tier available (5800+ users)
- **Notes:** RP-friendly. Ex Poe API wrapper maintainer.

### 72. VoidAI
- **API Base:** `https://api.voidai.app/v1`
- **Format:** OpenAI-compatible
- **Models:** GPT-4.1, Claude 3.5, Gemini 2.5, DeepSeek R1
- **Free tier:** Free tier available (paid NSFW)
- **Notes:** 2000+ users.

### 73. NagaAI
- **API Base:** `https://api.naga.ac/v1`
- **Format:** OpenAI-compatible
- **Models:** Claude 3.5, various paid models
- **Free tier:** Free tier available (3500+ users)
- **Notes:** Successor to ChimeraGPT.

### 74. NavyAPI
- **API Base:** `https://api.navy/v1`
- **Format:** OpenAI-compatible
- **Models:** GPT-4.1, Gemini 2.5, DeepSeek R1, FLUX-Kontext
- **Free tier:** Free tier available (1500+ users)

### 75. MNN
- **API Base:** `https://api.mnnai.ru/v1`
- **Format:** OpenAI-compatible
- **Models:** GPT-4.1, Gemini 2.5, DeepSeek R1, GPT-IMAGE-1, FLUX-Kontext
- **Free tier:** Free tier available

### 76. Kimetsu
- **API Base:** `https://api.kimetsu.ai/v1`
- **Format:** OpenAI-compatible
- **Models:** Claude 3.5, DeepSeek R1
- **Free tier:** Free tier available (2000+ users)

### 77. HelixMind
- **API Base:** `https://helixmind.online` (check docs for API endpoint)
- **Format:** OpenAI-compatible
- **Models:** Various (subscription-based with free tier)
- **Free tier:** Limited free tier (2600+ users)

### 78. VoltAI
- **API Base:** `https://api.voltapi.online/v1`
- **Format:** OpenAI-compatible
- **Models:** DeepSeek R1, FLUX-Kontext
- **Free tier:** Free tier available

### 79. hcap.ai
- **API Base:** `https://hcap.ai/v1`
- **Format:** OpenAI-compatible
- **Models:** GPT-4.1, DeepSeek R1, GPT-IMAGE-1
- **Free tier:** Free tier available

### 80. WebraftAI
- **API Base:** `https://api.webraft.in/freeapi`
- **Format:** OpenAI-compatible
- **Models:** Various
- **Free tier:** Free tier available

### 81. NexeonAI
- **API Base:** `https://nexeonai.com/v1`
- **Format:** OpenAI-compatible
- **Models:** Various
- **Free tier:** Free tier available
- **Notes:** Controversial (owner DDOSing competition). Use with caution.

### 82. ZanityAI
- **API Base:** `https://api.zanity.xyz/v1`
- **Format:** OpenAI-compatible
- **Models:** GPT-4.1, DeepSeek R1
- **Free tier:** Free tier (paid for some models). 1600+ users.

---

## TIER 6: SPECIALIZED PROVIDERS

### Code AI

### 83. Sourcegraph (Cody)
- **Website:** https://sourcegraph.com
- **API access:** Via Cody IDE extension + API
- **Models:** Various (Claude, Gemini, GPT via BYOK)
- **Notes:** Code intelligence. Context-aware code completions.

### 84. Codeium / Windsurf
- **Website:** https://codeium.com / https://windsurf.ai
- **Models:** Custom code models
- **API access:** IDE plugin
- **Notes:** Free code completion. Acquired by OpenAI.

### 85. Tabnine
- **Website:** https://tabnine.com
- **Models:** Custom code models (privacy-focused)
- **API access:** IDE plugin + API
- **Notes:** Privacy-first code AI. Self-hosted option.

### 86. Replit
- **Website:** https://replit.com
- **Models:** Replit Code models
- **API access:** Via Replit platform
- **Notes:** Cloud IDE with built-in AI.

### Vision / Image AI

### 87. Stability AI
- **Website:** https://stability.ai
- **API Base:** `https://api.stability.ai/v1`
- **Format:** Custom
- **Auth:** Bearer token
- **Models:** Stable Diffusion 3, SDXL, Stable Image, Stable Video
- **Free tier:** Free credits on signup
- **Notes:** Open-source diffusion leader.

### 88. Leonardo AI
- **Website:** https://leonardo.ai
- **API Base:** `https://cloud.leonardo.ai/api/rest/v1`
- **Format:** Custom
- **Auth:** Bearer token
- **Models:** Leonardo Phoenix, Leonardo Alchemy
- **Free tier:** 150 free tokens/day
- **Notes:** Fine-grained image control.

### 89. Ideogram
- **Website:** https://ideogram.ai
- **API Base:** `https://api.ideogram.ai/v1`
- **Format:** Custom
- **Auth:** Bearer token
- **Models:** Ideogram 2.0
- **Free tier:** Limited free tier
- **Notes:** Best at text-in-image generation.

### 90. Midjourney
- **Website:** https://midjourney.com
- **API access:** No official API (Discord bot + unofficial wrappers)
- **Models:** Midjourney v6, v7
- **Notes:** Highest quality image generation. No official API yet.

### 91. Black Forest Labs (FLUX)
- **Website:** https://blackforestlabs.ai
- **API access:** Via Replicate, Together, FAL, etc.
- **Models:** FLUX Pro, FLUX Schnell, FLUX Kontext, FLUX Dev
- **Free tier:** Open-source models (Schnell/Dev) free to self-host
- **Notes:** Creators of FLUX. Best open-source diffusion.

### 92. FAL.ai
- **Website:** https://fal.ai
- **API Base:** `https://fal.run/{model}`
- **Format:** Custom
- **Auth:** API key
- **Models:** FLUX, SDXL, various diffusion/video/audio models
- **Free tier:** Free tier available
- **Notes:** Fast inference for diffusion models.

### Audio AI (STT/TTS/Music)

### 93. ElevenLabs
- **Website:** https://elevenlabs.io
- **API Base:** `https://api.elevenlabs.io/v1`
- **Format:** Custom
- **Auth:** `xi-api-key` header
- **Models:** Eleven Multilingual v2, Eleven Turbo v2, Eleven Flash
- **Free tier:** 10,000 characters/month free
- **Notes:** Highest quality TTS. Voice cloning.

### 94. Deepgram
- **Website:** https://deepgram.com
- **API Base:** `https://api.deepgram.com/v1`
- **Format:** Custom
- **Auth:** Bearer token
- **Models:** Nova-2, Nova-3, Aura (TTS)
- **Free tier:** $200 free credits
- **Notes:** Fastest STT. Real-time transcription.

### 95. AssemblyAI
- **Website:** https://assemblyai.com
- **API Base:** `https://api.assemblyai.com/v2`
- **Format:** Custom
- **Auth:** Bearer token
- **Models:** Best, Nano (STT), LeMUR (audio understanding)
- **Free tier:** Free tier with limits
- **Notes:** Accurate STT with speaker diarization.

### 96. PlayHT
- **Website:** https://play.ht
- **API Base:** `https://api.play.ht/api/v2`
- **Format:** Custom
- **Auth:** Bearer token
- **Models:** PlayHT2.0, PlayHT3.0
- **Free tier:** Free tier with character limits
- **Notes:** TTS with voice cloning.

### 97. Resemble AI
- **Website:** https://resemble.ai
- **API access:** Available
- **Models:** Custom TTS, voice cloning
- **Free tier:** Free trial
- **Notes:** Enterprise TTS/voice cloning.

### 98. Coqui TTS (XTTS)
- **Website:** https://coqui.ai (shutting down, but XTTS is open source)
- **Models:** XTTS v2 (open source)
- **Free tier:** Open source (free to deploy)
- **Notes:** Open-source TTS. Community maintained.

### 99. Suno AI (Music)
- **Website:** https://suno.com
- **API access:** Limited (via unofficial)
- **Models:** Suno v3, v4
- **Notes:** AI music generation.

### 100. Udio (Music)
- **Website:** https://udio.com
- **API access:** Limited
- **Notes:** AI music generation. Competitor to Suno.

### Embedding / Reranking Specialists

### 101. Jina AI
- **Website:** https://jina.ai
- **API Base:** `https://api.jina.ai/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Jina Embeddings v3, Jina Reranker v2
- **Free tier:** 1M tokens free/month
- **Notes:** Best multilingual embeddings. Also does reader/search.

### 102. Voyage AI
- **Website:** https://voyageai.com
- **API Base:** `https://api.voyageai.com/v1`
- **Format:** OpenAI-compatible
- **Auth:** Bearer token
- **Models:** Voyage 3, Voyage 3-Lite, Voyage Code 3, Rerank 2
- **Free tier:** Free tier with token limits
- **Notes:** Best-in-class embeddings for code and text.

### 103. Weaviate (Embeddings)
- **Website:** https://weaviate.io
- **Models:** Various embedding models via Weaviate Cloud
- **API access:** Via Weaviate SDK
- **Notes:** Vector database with built-in embedding generation.

### 104. Nomic AI
- **Website:** https://nomic.ai
- **API Base:** `https://api-atlas.nomic.ai/v1`
- **Format:** OpenAI-compatible
- **Models:** Nomic Embed Text v1.5
- **Free tier:** Free tier available
- **Notes:** Open-source embeddings. Atlas platform.

### Moderation / Safety

### 105. OpenAI Moderation
- **API Base:** `https://api.openai.com/v1/moderations`
- **Free tier:** YES - Free (included with API key)
- **Models:** text-moderation-latest, text-moderation-stable
- **Notes:** Industry standard content moderation.

### 106. Anthropic Moderation
- **Via:** Claude's built-in safety
- **Notes:** Integrated into Claude API

### 107. Azure AI Content Safety
- **Website:** https://azure.microsoft.com/en-us/products/ai-services/content-safety
- **Models:** Content Safety (text + image)
- **Free tier:** Free tier available
- **Notes:** Microsoft's content moderation service.

### Video AI

### 108. RunwayML
- **Website:** https://runwayml.com
- **API Base:** `https://api.runwayml.com/v1`
- **Format:** Custom
- **Auth:** Bearer token
- **Models:** Gen-3 Alpha, Gen-4
- **Free tier:** Limited free credits
- **Notes:** AI video generation leader.

### 109. Pika Labs
- **Website:** https://pika.art
- **API Base:** `https://api.pika.art/v1`
- **Format:** Custom
- **Auth:** Bearer token
- **Models:** Pika 2.0
- **Free tier:** Limited free generation
- **Notes:** AI video generation and editing.

### 110. Kling AI (Kuaishou)
- **Website:** https://klingai.com
- **API access:** Available
- **Models:** Kling 1.5, Kling 1.0
- **Notes:** Chinese video AI. High quality.

### 111. Sora (OpenAI)
- **Website:** https://sora.com
- **API access:** Via OpenAI API (limited)
- **Models:** Sora
- **Notes:** Text-to-video. High quality but limited access.

---

## TIER 7: NEW / EMERGING STARTUPS

### 112. Arcee AI
- **Website:** https://arcee.ai
- **Models:** Trinity Large Thinking (via OpenRouter, free)
- **Notes:** Enterprise model customization.

### 113. Reka AI
- **Website:** https://reka.ai
- **Models:** Reka Edge (via OpenRouter)
- **Notes:** Founded by ex-Google DeepMind researchers.

### 114. Perceptron
- **Website:** https://perceptron.ai
- **Models:** Perceptron MK1 (via OpenRouter)
- **Notes:** New entrant on OpenRouter.

### 115. Inclusion AI
- **Website:** https://inclusion.ai
- **Models:** Ring 2.6-1T, Ling 2.6-1T, Ling 2.6 Flash (via OpenRouter)
- **Notes:** Large context models (1T tokens).

### 116. Poolside
- **Website:** https://poolside.ai
- **Models:** Laguna XS.2, Laguna M.1 (via OpenRouter, free)
- **Notes:** Code-focused AI startup.

### 117. Cognition (Devin)
- **Website:** https://cognition.ai
- **Models:** Devin (AI software engineer)
- **API access:** Waitlist/partnership
- **Notes:** Autonomous coding agent.

### 118. Adept AI
- **Website:** https://adept.ai
- **Models:** ACT-1 (computer use agent)
- **API access:** Partnership
- **Notes:** AI that uses computers.

### 119. Imbue
- **Website:** https://imbue.com
- **Models:** Research models
- **Notes:** Reasoning-focused AI.

### 120. Magic AI
- **Website:** https://magic.dev
- **Models:** LTM (Long-Term Memory) models
- **Notes:** Ultra-long context (100M+ tokens). Code-focused.

### 121. Essential AI
- **Website:** https://essential.ai
- **Models:** Enterprise AI models
- **Notes:** Founded by ex-Googlers (Transformer inventors).

### 122. Mistral (Codestral) - Already covered in Tier 1

### 123. Nous Research
- **Website:** https://nousresearch.com
- **Models:** Hermes, various fine-tuned models
- **API access:** Via Together, Hugging Face
- **Free tier:** Open source models
- **Notes:** Open-source AI research. Popular fine-tunes.

### 124. Teknium
- **Website:** https://teknium.com
- **Models:** OpenHermes, various datasets
- **Notes:** Open-source AI community contributor.

---

## LOCAL / SELF-HOSTED PLATFORMS

### 125. Ollama
- **Website:** https://ollama.com
- **API Base:** `http://localhost:11434/v1`
- **Format:** OpenAI-compatible
- **Models:** Any GGUF model (auto-downloaded from Hub)
- **Notes:** Pull-and-run local models. CPU/GPU.

### 126. vLLM
- **Website:** https://github.com/vllm-project/vllm
- **API Base:** `http://localhost:8000/v1`
- **Format:** OpenAI-compatible
- **Models:** Any HuggingFace model
- **Notes:** High-throughput local inference. PagedAttention.

### 127. llama.cpp
- **Website:** https://github.com/ggerganov/llama.cpp
- **API Base:** `http://localhost:8080/v1`
- **Format:** OpenAI-compatible
- **Models:** Any GGUF model
- **Notes:** C/C++ inference. CPU, GPU, Metal, Vulkan.

### 128. LocalAI
- **Website:** https://localai.io
- **API Base:** `http://localhost:8080/v1`
- **Format:** OpenAI-compatible
- **Models:** Auto-downloads from HuggingFace
- **Notes:** Unified local API. Multi-model (LLM, embedding, diffusion, STT).

### 129. LM Studio
- **Website:** https://lmstudio.ai
- **API Base:** `http://localhost:1234/v1`
- **Format:** OpenAI-compatible
- **Models:** Any GGUF model
- **Notes:** Desktop app for local models. Beautiful UI.

### 130. Jan
- **Website:** https://jan.ai
- **API Base:** `http://localhost:1337/v1`
- **Format:** OpenAI-compatible
- **Models:** Various open-source models
- **Notes:** Open-source local AI. Desktop app.

### 131. text-generation-webui (oobabooga)
- **Website:** https://github.com/oobabooga/text-generation-webui
- **API Base:** `http://localhost:5000/v1`
- **Format:** OpenAI-compatible
- **Models:** Any model
- **Notes:** Feature-rich local LLM UI.

### 132. GPT4All
- **Website:** https://gpt4all.io
- **API Base:** `http://localhost:4891/v1`
- **Format:** OpenAI-compatible
- **Models:** Various quantized models
- **Notes:** Privacy-first local AI. Nomic AI product.

### 133. SGLang
- **Website:** https://github.com/sgl-project/sglang
- **Format:** OpenAI-compatible
- **Models:** Any HuggingFace model
- **Notes:** Fast serving framework. Structured generation.

### 134. TGI (Text Generation Inference)
- **Website:** https://huggingface.co/docs/text-generation-inference
- **Format:** OpenAI-compatible
- **Models:** Any HuggingFace model
- **Notes:** HuggingFace's inference server. Production-grade.

### 135. FastChat
- **Website:** https://github.com/lm-sys/FastChat
- **API Base:** `http://localhost:8000/v1`
- **Format:** OpenAI-compatible
- **Models:** Various
- **Notes:** Distributed multi-model serving.

### 136. MNN (Alibaba)
- **Website:** https://github.com/alibaba/MNN
- **Models:** On-device LLM inference
- **Notes:** Mobile/IoT inference framework.

---

## API GATEWAY / ROUTER PLATFORMS

### 137. LiteLLM
- **Website:** https://litellm.ai
- **API Base:** `http://localhost:4000/v1` (proxy)
- **Format:** OpenAI-compatible proxy
- **Notes:** Proxy that unifies 100+ LLM providers behind OpenAI format. Self-hosted.

### 138. Portkey AI Gateway
- **Website:** https://portkey.ai
- **API Base:** `https://api.portkey.ai/v1`
- **Format:** OpenAI-compatible
- **Notes:** Gateway for 100+ models. Caching, fallbacks, retries.

### 139. Helicone
- **Website:** https://helicone.ai
- **Format:** OpenAI-compatible proxy
- **Notes:** LLM observability + routing.

### 140. Martian
- **Website:** https://withmartian.com
- **Format:** OpenAI-compatible proxy
- **Notes:** Model routing. Auto-selects best model for each request.

### 141. Unify.ai
- **Website:** https://unify.ai
- **Format:** OpenAI-compatible
- **Notes:** Route to best provider/model combo. Dynamic routing.

### 142. Keywords AI
- **Website:** https://keywordsai.co
- **Format:** OpenAI-compatible proxy
- **Notes:** LLM monitoring + routing.

---

## OPENAI-COMPATIBLE FORMAT SUMMARY

Most providers support OpenAI-compatible API format. Here's the quick reference:

| Provider | OpenAI-Compatible? | Notes |
|----------|-------------------|-------|
| OpenAI | Native | - |
| Anthropic | NO | Custom format (x-api-key header) |
| Google Gemini | YES (via /openai/ path) | Also has native format |
| xAI (Grok) | YES | - |
| Mistral | YES | - |
| DeepSeek | YES | - |
| Cohere | NO | Custom format |
| Together AI | YES | - |
| Fireworks AI | YES | - |
| Groq | YES | - |
| Cerebras | YES | - |
| SambaNova | YES | - |
| OpenRouter | YES | Meta-aggregator |
| Hugging Face | YES (via router) | - |
| NVIDIA NIM | YES | - |
| GitHub Models | YES | - |
| Cloudflare AI | YES | - |
| Alibaba (Qwen) | YES | - |
| Zhipu (GLM) | YES | - |
| Baidu | Partial | Qianfan has OpenAI-compat mode |
| Moonshot | YES | - |
| Xiaomi | YES | - |
| ByteDance | YES | - |
| MiniMax | YES | - |
| iFlytek | YES | - |
| SenseTime | YES | - |
| Baichuan | YES | - |
| 01.AI (Yi) | YES | - |
| Replicate | NO | Custom |
| Stability AI | NO | Custom |
| ElevenLabs | NO | Custom (xi-api-key) |
| Deepgram | NO | Custom |
| AssemblyAI | NO | Custom |
| Cohere | NO | Custom (v2) |
| IBM watsonx | NO | Custom |
| AI21 Labs | Partial | Has OpenAI-compat mode |
| Jina AI | YES | - |
| Voyage AI | YES | - |

---

## FREE TIER COMPARISON (Best to Worst)

| Provider | Free RPM | Free RPD | Free TPM | Free TPD | Monthly Budget | Models |
|----------|---------|---------|---------|---------|---------------|--------|
| Cloudflare AI | 300 | - | - | - | 10M tokens | Llama, DeepSeek, Qwen, Granite |
| Google Gemini | 15 | 1500 | - | 1M TPD | ~30M tokens | Gemini Flash, Pro |
| Groq | 30 | ~14,400 | - | - | Generous | Llama, Mixtral, Gemma |
| Hugging Face | 3-10 | varies | varies | varies | Varies | 200K+ models |
| GitHub Models | 15 | 150 | 8000 | - | ~800K tokens | GPT-4o, GPT-4.1 |
| NVIDIA NIM | 3 | 1000 | 4000 | 500K | 500K tokens | Llama, DeepSeek, Mistral |
| Ollama Cloud | 10 | - | - | - | ~500K tokens | Qwen3 480B, Mistral Large 675B |
| Zhipu GLM | 10 | - | - | - | ~5M tokens | GLM-4.5/4.7-flash |
| Alibaba Qwen | varies | - | - | - | ~1M tokens | Qwen Turbo |
| Pollinations | 10 | - | - | - | Unlimited* | GPT-OSS-20b (no key needed) |
| LLM7 | 10 | - | - | - | ~500K tokens | Multiple open-source |
| Kilo Gateway | 10 | - | - | - | ~500K tokens | Nemotron 120B |
| OpenRouter Free | 20 | - | - | - | ~1M tokens | 19+ free models |
| Baidu Ernie | varies | - | - | - | Free Speed/Lite | ERNIE Speed, Lite |
| ElevenLabs | - | - | - | - | 10K chars | TTS |
| Deepgram | - | - | - | - | $200 credits | STT |
| Jina AI | - | - | - | - | 1M tokens | Embeddings |

---

## NOTES FOR DMR-X INTEGRATION

### Currently in DMR-X catalog: 37 providers
### Providers identified in this research: 140+

### HIGH PRIORITY additions (most useful, free, OpenAI-compatible):
1. **Cloudflare Workers AI** - 10M free tokens/month, 300 RPM
2. **Ollama Cloud** - Free access to massive models (480B Qwen3!)
3. **Zhipu GLM** - 5M free tokens/month
4. **Alibaba DashScope** - 1M free tokens/month
5. **Baidu Qianfan** - Free ERNIE Speed/Lite
6. **ByteDance Seed** - Cheap Chinese models
7. **MiniMax** - Long context, cheap
8. **01.AI Yi** - Free Yi-Spark
9. **iFlytek Spark** - Free Spark Lite, strong STT/TTS
10. **FAL.ai** - Fast diffusion inference
11. **Novita AI** - Cheap open-source hosting
12. **Featherless AI** - 4000+ open-source models
13. **AI21 Labs** - Jamba hybrid models
14. **Nomic AI** - Free embeddings
15. **Arcee AI** - Free Trinity Thinking on OpenRouter
