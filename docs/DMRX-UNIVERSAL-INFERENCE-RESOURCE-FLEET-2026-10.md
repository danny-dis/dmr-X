# DMR-X Universal Inference Resource Fleet — October 2026

## What changed

DMR-X is moving from a free LLM router toward a universal inference-resource gateway.

The scheduler should treat every usable inference resource as a schedulable cell:

    provider + account + credential + quota pool + endpoint + model + capability

That same abstraction covers cloud APIs, free trials, credit balances, queued media jobs, local runtimes, browser WebGPU, and future EEG/BCI/neural resources.

## Why the old "free provider" model was too small

A zero-price API response does not tell DMR-X how capacity behaves.

| Resource | Example economic shape | Correct DMR-X representation |
|---|---|---|
| recurring token quota | Cerebras | token/request dimensions + refill/reset |
| account-level request pool | Groq | shared organization/account quota |
| monthly credit | Hugging Face | credit balance |
| one-time promo | Fireworks | expiring credit pool |
| new-user trial | Z.ai Coding | account trial + expiry + daily token split |
| neural budget | Cloudflare Workers AI | Neurons/day |
| search allowance | Cloudflare AI Search | separate semantic/full-text pools |
| queued generation | image/video/music providers | job/concurrency/seconds resource |
| local inference | Ollama/vLLM/llama.cpp | device capacity with zero API cost |
| browser inference | WebGPU / Transformers.js / WebLLM | device/session capacity, local privacy |
| neural signal | future EEG/BCI models | samples/sec + channels + latency |

The scheduler therefore must optimize resource economics and capacity, not merely token price.

## Free/promo offers researched in this pass

The verified offer registry records current observations for Cerebras, Z.ai Coding, Fireworks, AWS Free Tier/Bedrock, Cloudflare AI Search, Cloudflare Workers AI, Hugging Face, OpenRouter, Groq TTS, ElevenLabs, Jina, Voyage, Stability, Deepgram, AssemblyAI and Google Cloud Speech.

Important examples from current provider documentation:

- Cerebras publishes multi-dimensional token/request limits and token-bucket refill behavior. Current free limits vary by model and can be reduced temporarily during demand spikes.
- Z.ai's current Coding Plan documentation describes an 8M-token/day new-user trial for five days, split across GLM-5.3 and GLM-5.3-Flash.
- Fireworks currently advertises $1 in free serverless credits for new accounts; startup/partner credits are a separate economic class.
- AWS Free Tier gives new customers up to $200 in credits, with the broader Free account plan lasting up to six months; this is promotional account capacity, not a perpetual free inference API.
- Cloudflare Workers AI currently gives 10,000 Neurons/day on the Free allocation, while AI Search provides separate monthly semantic and full-text allowances.
- Hugging Face currently provides a small monthly Inference Provider credit allocation for free users.
- OpenRouter's free tier is request-limited and is separate from paid higher-limit access.
- Groq exposes organization-level request/token/audio dimensions; the current free plan includes dedicated Orpheus TTS and Whisper limits.
- ElevenLabs, Deepgram, AssemblyAI, Stability and Google Cloud expose free credits/minutes/units with different expiration and billing semantics.

The values above are intentionally stored as observations with provenance and freshness, not compiled into irreversible global assumptions.

## Provider/lab discovery rules

DMR-X should use three evidence levels:

1. Official entitlement — provider docs/pricing/usage API.
2. Live observation — response headers, usage endpoints, probes and failure signals.
3. Directory discovery — community/directory catalogs such as FreeLLMAPI and other free-model indexes.

A directory can discover a resource, but it must not make the final economic decision. DMR-X should verify the route before promoting it to an active free resource.

## Resource lifecycle

    discovered
      -> candidate
      -> verified
      -> observed
      -> active
      -> degraded
      -> stale
      -> retired

Temporary promotions and trials also carry an expiresAt.

A provider becoming paid must be representable without a software release.

## Safety invariants

- free_only rejects paid and unknown-priced candidates.
- Credentials and quota pools are different identities.
- Shared quotas must not be multiplied simply because DMR-X owns more API keys.
- Expiring credits are never treated as recurring capacity.
- Keyless/IP-limited endpoints are modeled separately from credentialed pools.
- Unknown or stale capacity never becomes infinite capacity.
- Local/device inference has API cost 0 but finite physical capacity.
- Provider data-use and production restrictions are policy metadata, not comments hidden in adapter code.

## Current implementation

This PR adds:

- ResourceCell, ResourceEconomics, ResourcePolicy and EconomicUnit contracts.
- Expanded quota units for credits, neurons, jobs, seconds, characters, GPU time and IP-scoped requests.
- QuotaPool identity independent of credentials.
- Strict free_only routing enforcement across the normal pipeline and direct/composite boundaries.
- Conservative pricing inference: missing pricing is unknown, never implicitly free.
- A versionable verified free-offer registry.
- A distinct zai-coding provider surface for the Z.ai Coding endpoint.
- Atomic SQLite admission checks inside the write transaction.
- Stable reservation identifiers shared between CapacityManager and distributed stores.
- Tests covering resource identity, free/promo/trial classification, unknown pricing and reservation identity.

## Next research frontier

The next iteration should make the ResourceCell executable rather than just descriptive.

    Resource Observatory
      -> capability probe
      -> entitlement probe
      -> quota observation
      -> data-policy observation
      -> capacity prediction
      -> atomic reservation
      -> execution
      -> usage reconciliation
      -> scheduler learning

For media and compute, the same pipeline must account for non-token units such as seconds, jobs, GPU-seconds and concurrency.

For browser/local execution, DMR-X should expose the device as a provider-like resource while keeping the model physically local.

For future neural/BCI resources, adapters should report stream dimensions such as sample rate, channel count, inference latency and device occupancy without changing the scheduler itself.

## Sources

Provider source URLs are also stored with every offer in packages/provider-catalog/src/verified-free-labs.ts.

Primary sources used in this research pass include:

- https://inference-docs.cerebras.ai/support/rate-limits
- https://docs.z.ai/guides/develop/coding-plan
- https://fireworks.ai/pricing
- https://aws.amazon.com/free/free-tier-faqs/
- https://developers.cloudflare.com/ai-search/reference/pricing/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://huggingface.co/docs/inference-providers/en/pricing
- https://openrouter.ai/pricing
- https://console.groq.com/docs/rate-limits
- https://elevenlabs.io/pricing/api
- https://jina.ai/pricing
- https://www.voyageai.com/pricing/
- https://platform.stability.ai/pricing
- https://deepgram.com/pricing
- https://www.assemblyai.com/pricing
- https://cloud.google.com/free
