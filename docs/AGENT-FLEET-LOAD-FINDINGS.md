# DMR-X Agent Fleet Load Test — Findings

Measured by delegating **role-appropriate work** to the 271-agent fleet via
`POST /v1/agents/:instanceId/chat` and instrumenting the gateway throughout.
Harness: `scripts/agent_fleet_workload.py`.

Work was matched to each agent's actual specialty (a Test Automation Engineer
gets a test-design brief, a Legal Compliance Checker gets a retention question).
A uniform prompt would not exercise routing and classification the way real use
does.

## Headline: 75% → 92% success after two fixes

| Run | Agents | Concurrency | Success | Empty replies | Throughput |
|-----|--------|-------------|---------|---------------|------------|
| Pilot (before) | 6 | 3 | 67% | **3 of 4** | 0.08 req/s |
| Baseline (before) | 24 | 6 | 75% | 0 (parser fixed) | 0.18 req/s |
| After both fixes | 40 | 8 | **92%** | **0** | **0.31 req/s** |

## Bug 1 — every agent that used a tool returned an EMPTY reply

**Severity: HIGH.** Silent data loss: the caller pays for the tokens, the agent
does the work, and the response body is `""`.

`agent-chat-loop.ts` overwrote `lastResponseText` on **every** turn with that
turn's `message.content`. Providers send `content: ''` (or null) on a pure
tool-call turn, and the loop breaks at `turn === maxSteps - 1` — so any
step-limited run ended on exactly such a turn and wiped whatever the agent had
already said.

Evidence — the correlation was total:

```
Tool Evaluator            tools=0  reply_len=727
Test Results Analyzer     tools=2  reply_len=0
Reality Checker           tools=2  reply_len=0
Performance Benchmarker   tools=2  reply_len=0
```

**Fix:** only overwrite when the turn actually produced prose, plus a final
guard that synthesises an honest summary ("Reached the N-step limit after
calling: X") rather than returning empty. An empty string is indistinguishable
from a crash at the API boundary.

**Why tests missed it:** the existing suite's `toolCallResponse()` fixture set
`content: 'I will use a tool'` — non-empty, so the overwrite was harmless.
`tests/unit/agent-chat-loop-empty-reply.test.ts` uses `''` and `null`, which is
what providers actually send.

## Bug 2 — transport timeout shorter than the work budget

**Severity: HIGH.** 6 of 24 tasks died at **~58s**, every one clustered at the
ceiling rather than randomly distributed — the signature of a fixed limit, not
flaky upstreams.

`requestTimeout` was 60s while the agentic loop allows
`DMRX_AGENTIC_TURN_TIMEOUT_MS` (default **120s**) **per turn**, across up to
`maxSteps` turns. The transport could never outlive the work it was fronting.
The client sees `RemoteDisconnected` — a dropped socket, not an error response —
so there is nothing to retry on and no error body to read.

**Fix:** default `requestTimeout` 60s → 300s, `keepAliveTimeout` → 305s.
`connectionTimeout` deliberately left at 10s: it guards handshakes, and raising
it would open a slowloris foothold.

`tests/unit/gateway-timeout-budget.test.ts` asserts the invariant
*relationally* (`requestTimeout >= 2 × turn timeout`), so raising the per-turn
ceiling without raising the transport ceiling fails the build.

**NOTE:** `.env` pins `DMRX_REQUEST_TIMEOUT=120000`, which overrides the new
default. 3 of 40 tasks still fail at ~56s. Raising that line to `300000` should
clear the remainder — a config change for the operator, not a code change.

## Not bugs — corrected during the run

**"Empty replies" in the first pilot were partly MY harness.** The route returns
the reply at top-level `content`, not an OpenAI-shaped `choices[]`. Reading
`choices[]` made every success look empty. Fixed before drawing conclusions;
the *real* empty-reply bug was then isolated by its exact correlation with tool
use.

## Open optimisation targets (measured, not speculative)

### 1. 81% of the routing pool is on cooldown

```
"skipped":632,"remaining":145
```

632 of 777 candidates excluded, leaving 145. Selection quality is badly
degraded and one provider dominates. `cohere` alone logged 73 consecutive
health-check failures while still being probed every 30s.

**Suggested:** exponential backoff on repeatedly-failing providers instead of a
fixed 30s retry, and drop a provider out of the health-probe rotation entirely
after N consecutive failures. Currently the gateway spends real time
rediscovering that a dead provider is dead.

### 2. ~9,700 tokens per request on trivial prompts

```
TOKENS: total 360097 | mean 9732/req | max 27539
```

A one-line question should not cost 9.7k tokens. The agent system prompt is
resent in full on every call. **Prompt caching here is the single biggest cost
lever** — most providers bill cached prefixes at a fraction of the rate.

### 3. Latency is model-bound, not queue-bound — good news

```
QUEUE OVERHEAD: p50 0.0s | p95 0.2s | max 0.2s
```

Wall clock minus server `durationMs` is essentially zero, so requests are not
queueing. Raising concurrency will scale throughput; the gateway itself is not
the bottleneck. Confirmed: 8 concurrent gave 0.31 req/s vs 0.18 at 6.

### 4. Memory is stable under fleet load

`232.9MB → 227.0MB` across 40 concurrent agent tasks — RSS went *down*. The
session-leak fix from earlier holds under this workload too.

### 5. Migration checksum mismatch (unrelated, but noisy)

```
Migration 059_session_steps_tool_calls.sql checksum mismatch.
The migration file has been modified after being applied.
```

Logged on every gateway boot. Harmless today but it means migration 059 no
longer matches what was applied — worth reconciling before it masks a real
schema drift.

## Reproduce

```bash
python scripts/agent_fleet_workload.py --agents 40 --concurrency 8 \
  --max-steps 4 --timeout 320 --out fleet.json
```

Reports per-request latency, routed model, fallback reason, error class,
queue overhead, token spend, and gateway RSS delta. Exit code is non-zero if
any task failed, so it works as a regression gate.
