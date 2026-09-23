# DMR-X Free Provider Rate Catalog — 2026-09-06

This is a **baseline research snapshot**, not a promise that a user's account has these exact limits. Provider limits can vary by account, project, model, region, traffic and time. DMR-X must always prefer live response headers and provider-specific account telemetry when available.

## Catalog rules

- Official provider documentation is authoritative for published limits.
- Live headers are authoritative for the current request's observed remaining capacity.
- Account dashboards can override generic documentation when the provider exposes account-specific limits.
- Community lists are discovery aids only.
- Every record must carry `sourceLastVerified` and `confidence`.
- Unknown values remain unknown; they must not be converted into unlimited capacity.

## Current baseline

| Provider | Free access model | Published baseline | Important dimensions | DMR-X treatment |
|---|---|---|---|---|
| Google Gemini API | Free tier for eligible models | Limits vary by model/project; Google documents RPM, input TPM and RPD dimensions | RPM, TPM, RPD, model-specific restrictions | Read account/project limits; treat exact quota as dynamic |
| Groq | Free plan | Limits vary by model; official docs expose RPM/RPD/TPM/TPD and response headers | RPM, RPD, TPM, TPD, sometimes input/output token limits | Header-driven token/request admission |
| Cerebras | Free tier | `gpt-oss-120b`: 30 RPM, 64K TPM, 900 RPH, 14.4K RPD, 1M TPD in published free-tier table; other models differ | RPM, RPH, RPD, TPM, TPD | Token-bucket model + model-specific limits; reserve estimated tokens |
| SambaNova | Free tier | Free tier examples show 20 RPM, 20 RPD, 200K TPD for listed production/preview models | RPM, RPD, TPD | Must parse both minute and day request headers plus daily token limits |
| OpenRouter | Free models | Free account: 50 requests/day and 20 requests/minute; purchased credits can raise free-model daily ceiling to 1,000 while remaining 20 RPM | account RPD, RPM + upstream model/provider limits | Treat OpenRouter as a provider *and* upstream pool; never assume its quota equals downstream model capacity |
| Cloudflare Workers AI | Workers Free allocation | 10,000 Neurons/day; some models require Workers Paid | daily Neurons + model eligibility | Model eligibility must be cataloged separately from generic free allocation |
| Hugging Face Inference Providers | Free user credits | $0.10 monthly credit for Free users, subject to change | credit balance + underlying provider limits | Credit is not the same as a provider free tier; route only while budget remains |
| NVIDIA hosted NIM | Free Developer access | Free hosted endpoints have account/model-dependent limits; a commonly documented hosted baseline is 40 RPM and 5 concurrent requests, but current account limits can vary | RPM, concurrency, signup/free credits, model restrictions | Use live/account-specific values; never rely on the baseline as a guarantee |

## Provider-specific observations

### Google Gemini

Google states that limits are applied per project rather than per API key and are generally measured using RPM, input TPM and RPD. Limits vary by model and experimental/preview models can be more restrictive. RPD resets at midnight Pacific time. Actual capacity can vary from published values.

**DMR-X requirement:** the Google adapter must model project scope and daily reset timezone rather than treating each API key as an independent quota bucket.

### Groq

Groq exposes rate-limit headers including request and token limits, remaining capacity and reset times. The applicable dimension is whichever threshold is reached first.

**DMR-X requirement:** use headers after every response and keep separate request and token capacity predictions.

### Cerebras

Cerebras documents RPM/RPH/RPD and TPM/TPH/TPD dimensions. It uses token-bucket replenishment rather than a simple fixed-window reset. It also estimates token consumption before processing a request based on input plus the configured maximum completion budget.

**DMR-X requirement:** reserve estimated input + output capacity before admission and model continuous replenishment.

### SambaNova

SambaNova documents RPM, RPD and TPD on the free tier and sends quota state in every response. It uses distinct daily request headers such as `x-ratelimit-limit-requests-day` and `x-ratelimit-remaining-requests-day` in addition to minute-level request headers.

**DMR-X requirement:** daily request and daily token capacity must be first-class dimensions.

### OpenRouter

OpenRouter's free account currently has 50 requests/day and 20 requests/minute for free models. Free-model availability is additionally affected by upstream provider capacity. OpenRouter explicitly warns that free models can be rate-limited by the underlying provider.

**DMR-X requirement:** model the chain:

`DMR-X quota → OpenRouter account quota → OpenRouter model availability → upstream provider quota`

A 429 at any layer must update the correct layer rather than poisoning every OpenRouter model equally.

### Cloudflare Workers AI

Workers AI currently includes 10,000 Neurons/day on the Workers Free plan. Some resource-intensive models have moved to Workers Paid, while other models remain on the free allocation.

**DMR-X requirement:** catalog model-level free eligibility and the Neurons budget independently.

### Hugging Face

Hugging Face Inference Providers currently provide Free users with $0.10/month in inference credits, subject to change. Routed requests can use Hugging Face credits, while custom provider keys use the underlying provider's billing/quota.

**DMR-X requirement:** distinguish `hf-routed-credit` from `provider-owned-free-tier` so the economics engine does not double-count free capacity.

### NVIDIA NIM

NVIDIA-hosted free endpoints are dynamic and account/model dependent. Third-party tracking currently records a 40 RPM hosted developer baseline and 5 concurrent requests, but NVIDIA states that hosted free limits can depend on model and current traffic and are not generally increased through a public request path.

**DMR-X requirement:** treat published values as low-confidence seed data and learn live capacity aggressively.

## Required schema evolution

The current quota model should evolve from scalar limits to dimensioned policies:

```yaml
provider: cerebras
scope: organization
model: gpt-oss-120b
plan: free
limits:
  - dimension: requests
    window: minute
    limit: 30
  - dimension: tokens
    window: minute
    limit: 64000
  - dimension: requests
    window: hour
    limit: 900
  - dimension: requests
    window: day
    limit: 14400
  - dimension: tokens
    window: day
    limit: 1000000
replenishment: token_bucket
headers:
  requests_day_limit: x-ratelimit-limit-requests-day
  requests_day_remaining: x-ratelimit-remaining-requests-day
  tokens_minute_limit: x-ratelimit-limit-tokens-minute
  tokens_minute_remaining: x-ratelimit-remaining-tokens-minute
source_last_verified: 2026-09-06
confidence: high
```

## Catalog lifecycle

`discovered → verified → imported → observed → reconciled → stale → reverified`

A provider change should create a versioned catalog revision. Existing requests continue using the policy snapshot under which they were admitted; new requests use the latest valid revision.

## Research sources

- Google Gemini API rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Google Gemini pricing/free tier: https://ai.google.dev/gemini-api/docs/pricing
- Groq rate limits: https://console.groq.com/docs/rate-limits
- Cerebras rate limits: https://inference-docs.cerebras.ai/support/rate-limits
- Cerebras pricing: https://inference-docs.cerebras.ai/support/pricing
- SambaNova rate limits: https://docs.sambanova.ai/docs/en/models/rate-limits
- OpenRouter rate limits: https://openrouter.zendesk.com/hc/en-us/articles/39501163636379-OpenRouter-Rate-Limits-What-You-Need-to-Know
- OpenRouter free inference: https://openrouter.ai/blog/tutorials/free-llm-apis-compared/
- Cloudflare Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Hugging Face Inference Providers pricing: https://huggingface.co/docs/inference-providers/en/pricing
- NVIDIA NIM hosted limits: https://docs.api.nvidia.com/nim/reference/limits

## Do not treat these as permanent guarantees

Free inference is an external resource market. Models disappear, providers change limits, traffic changes, and free plans are often deliberately capacity-limited. DMR-X's competitive advantage should therefore be the **control plane that learns and adapts**, not a hard-coded list of providers.
