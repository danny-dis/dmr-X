# DMR-X context, Caveman, recovery and cache audit

## Latest verified implementation

The status in this section supersedes the original audit record below. This is a verified hardening batch in the working tree, **not a production release or certification**.

### Implemented
- Compression settings/retrieval routes enforce global-admin versus tenant/API-key ownership, redact the global credential, and reject cross-owner/expired originals. Padded credential comparisons also require equal byte lengths.
- Reversible originals carry tenant/API-key ownership through migration `089_compression_ownership.sql` and the normal embedded migration registry. If reversibility cannot be guaranteed, compression returns original messages rather than advertising a recoverable transformation.
- Validated engine/options settings persist globally and by tenant/API key. Effective precedence is global → tenant → API key → explicit request control. Undefined partial flags do not override inherited values. `X-Compression: off` disables compression; invalid controls are rejected. API-key identity is read from authenticated tenant metadata.
- Exact cache lookup precedes optional semantic embedding work. Cache identity retains uncompressed input and effective quality/free-tier/cost/provider controls without forwarding internal cache metadata upstream. Cached outputs are revalidated against the request's declared output requirements.
- Semantic caching uses bounded real-only embeddings, provider/model/dimension identity, finite/nonzero vector validation and driver-safe SQLite BLOB handling. The memory service's legacy hash fallback is not accepted as a semantic-response vector.
- Non-streaming fallback execution validates JSON-object mode, declared text/section/minimum-length contracts, and the shape/name/arguments of returned tool calls before accepting provider output. Recovery remains bounded by the existing fallback budget; accounting/deadline regression coverage is included.
- Persistent tests cover long-context retention, structured/image/tool metadata, ownership, config persistence, embedding timeouts, output recovery and cache correctness.

### Verified evidence
- One final combined report: **278 tests passed across 31 files; zero failures**. Counts were checked against every assertion in `reports/dmrx-context-implementation-tests.json`; earlier overlapping runs are not additive.
- Builds exited 0 in dependency order: memory → cache → router → gateway. `git diff --check` also exited 0 (pre-existing Windows line-ending warning remains).
- `compression-http-canary.test.ts` exercises actual loopback HTTP plus SQLite, with explicitly fixture-provided authentication principals—not real credential issuance or live inference.
- `compression-migrations.test.ts` applies actual migration 001, then 025 and 089 to fresh in-memory SQLite; verifies API/tenant columns, owner index, legacy unowned records and SQL/bundle equality.
- Fresh independent Terra read-only review found no actionable scoped security/logic defects: `reports/dmrx-context-review.json`. Its migration-level integration-test suggestion was implemented and included in the final run.
- Pattern-based added-source security scan found no matches for the scanned hardcoded-secret/dangerous-execution patterns. This is not a comprehensive security audit.
- GitNexus combined working-tree diagnostic reports CRITICAL risk and 19 affected indexed flows. It includes pre-existing tracked changes; untracked additions and a stale index mean it is not a complete release-scope certificate.

### Limits and delivery state
- Implementation/review used Terra and Luna through Hermes's `openai-codex` subscription route. Standalone Codex CLI authentication/allowance is separate.
- User changes and unrelated artifacts were retained. Nothing was staged, committed, restarted or deployed, and the live database was not migrated.
- This does not certify full JSON Schema conformance, factual correctness, semantic preservation by a lossy compressor, every adapter/fast-path/streaming surface, global routing-configuration revision invalidation, model-aware evidence selection, full fresh installation or production load/abort behavior. Semantic response reuse remains opt-in.
- Some negative-path test fixtures intentionally log failed accounting/absent test DB warnings; Vitest also emits existing poolOptions deprecation warnings. Passing assertions are not proof of warning-free production operation.

## Original audit record (historical)

The sections below preserve the initial investigation and its earlier evidence. Their implementation-status statements are superseded by the verified batch above.

### Original verdict

**Useful components exist; this is not yet production-certified.** The priority context-fidelity and cache-correctness fixes are implemented and exercised in the working tree. They have not been committed, deployed or verified after a gateway restart. Live smoke probes found one HTTP 503 as well as three correct answers. A healthy `/healthz` does not prove inference reliability.

The word “catch” was investigated in both senses: response validation/fallback and exact/semantic response caching.

## What actually exists

- Incoming OpenAI, Anthropic and Gemini requests are validated, converted into a unified request, then routed to providers. Compression happens in the API routes before routing.
- `apps/gateway/src/services/compression.ts` provides Headroom, RTK, Caveman, comment stripping and automatic engine selection; configuration merges global, tenant and API-key settings. OpenAI also accepts an `X-Compression` override. Reversible compression stores originals in SQLite.
- **Caveman is an inbound prompt transformation, not a requested output style.** Its original regex rules removed words and phrases such as `actually`, `in the event that` and `prior to`, and could apply contractions/abbreviations. These rules are not a comprehension model or a proof of semantic equivalence.
- `services/cache/src/cache.service.ts` is a namespaced exact response cache. `services/cache/src/semantic-cache.ts` stores SQLite responses and embedding vectors, uses a configurable similarity threshold and has cleanup/eviction timers. Semantic caching defaults off.
- `services/router/src/fallback/fallback-executor.ts` already provides ranked fallback, failure categorization, provider/model cooldowns and an overall timeout budget. This is not a system without recovery.
- The guardrail engine supports regex/webhook/moderation plugins and input/output checks. Its code default is `enableOutput: false`; that is not proof of the effective live configuration. The router's output-check path is conditional. Safety scanning is not the same as verifying that an answer satisfies the user's request.
- Existing Google adapter tests exercise empty responses and invalid JSON-mode output. Comparable acceptance guarantees must be verified across every adapter and streaming surface rather than inferred from one provider.

## Verified bugs and changes implemented

### 1. Compression could destroy the context envelope

Routes previously reduced rich provider messages to plain text for compression. This could drop OpenAI tool-call metadata, Anthropic content/tool blocks and Gemini non-text/function parts.

**Change:** pass original messages through the compression service and preserve their metadata. Gemini keeps multi-part and non-text frames opaque, including thought-bearing frames. A shared eligibility rule excludes system/developer/user messages, current final messages, tool exchanges and detected code/structured content. Only historical plain-text assistant prose is eligible for lossy engines.

**Evidence:** `tests/unit/compression-wire-fidelity.test.ts` compares routed messages/tools with compression off versus on for OpenAI image/tool context, Anthropic tool blocks and Gemini image/function parts. It uses a controlled router fixture, not a real provider; it proves gateway-envelope preservation, not model reasoning quality.

### 2. Caveman's default rewriting was not fidelity-safe

Deleting a conditional or a timing phrase is not merely reducing tokens. Earlier technical protection was insufficient to shield literals from all stages of rewriting.

**Change:** `allowLossy` defaults to false. Default Caveman behavior returns the original text unchanged. Explicitly opted-in legacy mode protects detected literal/technical content before any rewrite, with `preserveTechnical` defaulting true. Opt-in lossy mode is still lossy and is not certified for factual or instruction fidelity.

**Evidence:** `tests/unit/caveman-fidelity.test.ts` and the compression-service regressions. The trade-off is intentional: default Caveman compression may save zero tokens. Correctness beats a hollow compression ratio.

### 3. External compression could corrupt message structure

**Change:** Headroom receives only eligible history. Its reply must have the expected count, matching roles, nonblank string content and no expansion in character length. The gateway restores original metadata, leaving protected messages unchanged. Invalid replies or thrown errors return original messages.

**Limit:** structural validation does not establish semantic equivalence. Headroom timeout/cancellation and faithful summary evaluation remain work to do.

### 4. Semantic cache matched prompts without sufficient context

A similar latest query is not a sufficient cache key when system instructions, previous messages, generation settings or user identity differ.

**Change:** a canonicalized full-body context digest defines a `context-v2` namespace, while tenant isolation remains enforced separately in the SQL query. Plain-text chat is the only eligible shape; streams, tools/tool history and structured messages are bypassed. The latest user message is included by default. Different wording can share a scope only with explicit `metadata.semanticCache: "approximate"`; all other request context remains in the partition. Old context-blind namespaces are unreachable by the new lookups, without resetting the database.

**Evidence:** SQLite-backed regressions cover instructions/history/tenant changes, model, response format, output budget, sampling/stop/seed settings, supplied user identifiers, streaming/tool bypass and expired entries. A caller-supplied `user` field is key partitioning, not authentication or an authorization boundary.

**Limit:** opt-in approximate similarity is not a guarantee that two questions are interchangeable. Disable it for personal, changing, numeric, security-sensitive or high-consequence answers unless application-specific equivalence tests prove it safe.

### 5. Expiry comparison could replay stale entries

ISO timestamps and SQLite's space-separated `datetime('now')` representation were compared as text.

**Change:** candidate selection and cleanup compare parsed times with `julianday`. Full prompt text is stored instead of truncating it to 2,048 characters.

**Evidence:** an expired ISO-timestamp regression treats the row as a miss and verifies cleanup.

### 6. Exact and semantic caches could retain incomplete answers

**Change:** both caches apply a deterministic chat-response acceptance policy. Empty/error/refusal/tool-call/truncated responses are rejected for storage and rechecked before replay. The exact key preserves the supplied `user` identifier. Non-chat exact caching remains supported. Malformed envelopes, including null choice/content entries, fail closed rather than throwing.

**Evidence:** `response-cache-safety.test.ts`, `response-cache-policy.test.ts` and the semantic-cache regression file. This prevents bad replay; it does not itself add a generic retry or prove an answer is correct.

## Real verification and limitations

- The **final integrated regression run passed 149 tests in 14 files**, recorded in `reports/dmrx-context-cache-tests.json` (no failed tests). This supersedes the initial broader run of 141 tests in 13 files.
- After adding malformed-envelope coverage, the focused cache run also passed **28 tests in 3 files**. It overlaps the integrated run; do not add those counts together.
- Cache package build (`tsc -b`) and gateway build (`tsc`) passed. `git diff --check` passed. The test runner emits existing deprecated `poolOptions` warnings; this is not warning-free verification.
- `reports/dmrx-context-live-probes.json` records four small real requests against the **existing live gateway**: literal preservation and conditional-negation JSON, each with and without an `X-Compression: caveman` header. Three returned the expected answers; the first returned HTTP 503. Providers varied between successful calls. No root cause for the 503 was established by these probes.
- Those live requests are short, lack eligible assistant history and are **not** a long-context compression benchmark or deployment verification of the edited code.
- Live GET `/healthz` returned 200 and status `ok`. Live GET `/v1/compression/config` returned 200 without supplied credentials and reported `enabled: false`, `engine: auto`, `reversible: true`, `minTokensToCompress: 100`. Global compression being off does not exclude tenant/key/request overrides. Never expose an unauthenticated local-mode gateway as a production service.
- GitNexus `detect_changes --scope unstaged` reported **critical risk** and 19 affected processes across 8 tracked changed files. Its snapshot includes the unrelated `agents-checklist.md` change and does not fully index new helper/test files. This is a blast-radius warning, not a defect count. The newly created cache-policy symbol has UNKNOWN indexed impact because it was not found. Treat shared API changes as high-impact and require staged rollout.
- Existing unrelated work was left alone. No global reset, database reset, gateway restart or commit was performed. There was no clean-clone installation, complete repository test run, load/chaos test or sustained provider reliability assessment.

## Research: what should replace blind shortening

LLMLingua-2 formulates compression as learned token classification using bidirectional context and evaluates it on multiple tasks. That makes it a candidate for a controlled experiment, not evidence that a regex can safely delete natural-language conditions.[1]

“Lost in the Middle” demonstrates that relevant-information position can materially affect long-context performance. DMR-X should evaluate retrieval at the beginning, middle and end, not equate accepted context length with comprehension.[2]

Anthropic's context-engineering guidance treats context as a finite resource and describes targeted retrieval rather than loading entire data objects. Apply that principle by selecting relevant material and retaining provenance.[3]

Anthropic's context editing offers selective tool-result clearing separately from thinking-block clearing and compaction. DMR-X should preserve tool-use relationships and use capability-specific provider features rather than flattening every provider's frames into prose.[6]

OpenAI prompt caching reuses work for unchanged rendered prefixes but still generates a new response for the new input. It is a different optimization from replaying an old answer; prefer provider-native prefix reuse when the goal is cheaper repeated context without approximate-answer risk.[5]

OpenAI's evaluation guidance explicitly calls out input variability, including multilingual input, formats such as JSON/XML/CSV and non-text modalities. The acceptance set needs these cases instead of a few English prose examples.[4]

## Production-grade target design (recommendation, not implemented)

### A. Context contract

Maintain an immutable canonical request, ordered role/message frames, stable identifiers and typed attachments. Separate protected instructions/current intent from compressible historic evidence. Budget for provider-specific input, tools, output and reasoning; the current `length / 4` estimate is not authoritative token accounting. A fallback model must fit the same protected context rather than silently receiving a different task.

Use a task-aware context builder: relevant retrieval, deduplicated re-fetchable tool evidence, explicit source pointers, protected recent exchanges and a versioned summary of older history. Store the summary's provenance and uncertainties. Do not promote an untrusted tool result into system-level authority.

### B. Output contract / “catch” system

Before non-streaming success or cache storage, apply cheap universal checks (valid envelope, nonblank appropriate answer, valid finish reason, tool-call schema) plus checks requested by the caller (JSON schema, exact literals, language, required fields/sections and source presence). A short answer is not inherently bad: “yes”, an identifier or a JSON boolean may be exactly correct. Penalize missing required content, not merely low word count.

Separate deterministic validation from semantic evaluation. A sampled rubric/judge may help detect incomplete explanations or unsupported conclusions, but it should not be the sole release gate. For a retryable invalid response, allow a bounded same-provider correction or capable-provider fallback within one deadline; record what failed and which provider ultimately served the answer. Do not retry valid refusals indiscriminately.

For streams, validate framing/tool events incrementally. Retry only before user-visible output is committed; after commitment report an explicit terminal failure rather than silently blending two providers' answers. Verify identical principles on OpenAI, Anthropic and Gemini streaming routes.

### C. Cache contract

Order the hot path as exact lookup, then eligible optional semantic lookup, then inference. Use bounded cancellable embedding calls and cache-write work; a cache optimization must not hang a request. Tag vectors with provider/model/dimension/version. Reject hash fallback for semantic matching. Preserve output/settings/routing-policy identity and application dataset freshness. Put hard byte-size bounds on prompts/responses/rows and on per-tenant storage.

Default to safe misses. Maintain explicit opt-in approximate policies per use case, shorter freshness windows for changing data, invalidation when knowledge/auth policies change and diagnostics explaining why a cache candidate was rejected. Provider-native prompt caching should be measured separately from response-cache hit rate.

### D. Release evidence

Add a checked-in fixture corpus and CI gate covering exact IDs, numbers, negation, conditional ordering, user corrections, contradictory sources, beginning/middle/end retrieval, multilingual instructions, images, tool pairs, malformed/empty/truncated responses and both streaming/non-streaming formats. Evaluate against no-compression/no-response-cache baselines, hold providers constant for causal comparisons and report failures by case/provider. Measure end-to-end latency distributions, first-token latency, grounded-answer quality, invalid-result rates, cross-context false hits and cost; token savings alone are insufficient.

## Remaining blockers, in practical order

1. **Compression API authorization/retention:** `compression.routes.ts` has global/tenant/key config mutation and original retrieval without local ownership checks. Auth middleware reserves admin checks for `/v1/admin`; ordinary authenticated `/v1/compression/*` requests follow the tenant-key path. `retrieveOriginal` selects by ID without tenant or expiry predicates. Add admin gates for global mutation, tenant/key ownership checks, secret-redacted config replies, tenant-scoped originals and enforced expiry. Prove cross-tenant denial with tests. This is code evidence, not a demonstrated external attack.
2. **Live inference availability:** one of four tiny probes failed with 503. Capture the failing candidate chain, credential/admission state and budget exhaustion; repair the verified cause and repeat both completion and streaming probes. Do not simply inflate timeouts or invent a diagnosis.
3. **Cache deadlines/backend identity:** semantic lookup embeds before checking whether candidates exist; chat checks semantic before exact and awaits semantic storage on the response path. Embedding fetches lack an explicit deadline, and Ollama failure can produce hash vectors despite construction-time “real provider available” detection. Implement exact-first, cancellable budgets, real-vector-only matching and a versioned embedding fingerprint.
4. **Routing-header identity:** the chat cache bypass covers certain routing constraints, but `X-Quality-Target` is not included in body-derived identity or the displayed bypass condition. Requests with different quality targets must bypass or use a policy-scoped key; test this at the route level.
5. **Compression operational control:** route activation checks tenant/key flags rather than consistently resolving effective global configuration, and the OpenAI header is combined with API-key config using `apiKeyConfig ?? headerConfig`. Validate engine/header values and establish explicit precedence. Add token-accounting and persistence-error tests; `compressedId` must not imply recoverability when storing the original failed.
6. **Quality gate consistency:** prove response acceptance/retry semantics on every provider and streaming format, not just Google JSON/empty-output tests or optional safety plugins. Build the task-specific corpus before adopting a new compressor.
7. **Rollout:** clean build/install rehearsal, isolated canary of this working-tree patch, cold/warm cache probes, cache namespace migration behavior, load/abort/provider-failure tests, observability and rollback. Until then the correct label is **tested hardening patch plus audit**, not “world-class production-ready”.

## Sources

[1] https://aclanthology.org/2024.findings-acl.57
[2] https://transacl.org/index.php/tacl/article/view/5757
[3] https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
[4] https://platform.openai.com/docs/guides/evaluation-best-practices
[5] https://developers.openai.com/api/docs/guides/prompt-caching
[6] https://platform.claude.com/docs/en/build-with-claude/context-editing
