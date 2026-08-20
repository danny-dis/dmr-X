# DMR-X Agent Fleet Load Test — Findings

Measured by delegating **role-appropriate work** to the 271-agent fleet via
`POST /v1/agents/:instanceId/chat` and instrumenting the gateway throughout.
Harness: `scripts/agent_fleet_workload.py`.

Work was matched to each agent's actual specialty (a Test Automation Engineer
gets a test-design brief, a Legal Compliance Checker gets a retention question).
A uniform prompt would not exercise routing and classification the way real use
does.

## Headline: 71% → 96% success, and the reply metric was wrong

| Run | Agents | Conc. | HTTP success | **Real agent replies** | Throughput |
|-----|--------|-------|--------------|------------------------|------------|
| Pilot (before) | 6 | 3 | 67% | 1 of 4 | 0.08 req/s |
| Baseline (before) | 24 | 6 | 71% | **7 of 24 (29%)** | 0.14 req/s |
| After the fixes below | 24 | 6 | **96%** | **23 of 24 (96%)** | 0.09 req/s |

> **Correction to an earlier version of this document.** It reported "0 empty
> replies" as a fix landing. That was a measurement artifact. The gateway had
> been changed to substitute placeholder text ("Reached the N-step limit after
> calling: ...") whenever the loop produced no prose, and the harness counted any
> non-empty string as a success. In the 24-agent baseline **all 10 tool-using
> agents returned 128-144 characters — every one of them that placeholder** —
> while the 7 agents that answered directly returned 972-7479 characters. The
> reply rate was 29%, not 100%. Bug 3 below covers the root cause and the fix;
> throughput went *down* because real work now actually runs to completion
> instead of being severed at 60s.

Evidence for the post-fix row: 5 runs report `steps_completed: 3` — the new
summarisation turn firing — and return 1127-3513 characters of the agent's own
analysis where they previously returned the 128-char placeholder. The gateway
logged **zero** placeholders across the whole run.

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

`tests/unit/gateway-timeout-budget.test.ts` asserts the invariant
*relationally* (`requestTimeout >= 2 × turn timeout`), so raising the per-turn
ceiling without raising the transport ceiling fails the build.

## Bug 2b — the real killer was `connectionTimeout`, not `requestTimeout`

**Severity: HIGH.** Raising `requestTimeout` did **not** fix it. The next
24-agent run still lost **7 of 24** tasks in a tight **56.5-60.4s** band with
`RemoteDisconnected`, with `DMRX_REQUEST_TIMEOUT` already at 120s. Something
else owned the 60s boundary: `DMRX_CONNECTION_TIMEOUT=60000`.

Bug 2 above asserted `connectionTimeout` "guards handshakes, and raising it
would open a slowloris foothold." **That is wrong**, and the test suite encoded
the mistake as `connectionTimeout <= 30_000`. Per fastify's docs it maps to
Node's [`server.timeout`](https://nodejs.org/api/http.html#servertimeout) — a
**socket inactivity** timeout that fires with no regard for a handler still
legitimately running. Slow-loris defence is `requestTimeout` (which bounds
request *receipt*) plus `headersTimeout`. An agent turn sends no bytes while
waiting on a provider, so the socket looks idle and gets destroyed mid-request.
The socket layer always wins, so **ordering** is the invariant, not magnitude:

```
connectionTimeout >= keepAliveTimeout >= requestTimeout >= (per-turn budget × maxSteps)
```

**Fix:** `connectionTimeout` default 10s → 310s, and `validateStartupConfig()`
now **refuses to boot** on an inversion, naming the offending pair. `.env` and
`.env.example` both shipped the inverted values; both corrected. Verified the
guard rejects the exact old config:

```
DMRX_CONNECTION_TIMEOUT (60000ms) must be >= DMRX_REQUEST_TIMEOUT (120000ms).
connectionTimeout is a socket-level timeout and will sever in-flight requests
before the request timeout can return a proper error.
```

**Result:** `RemoteDisconnected` went 7/24 → 1/24, and runs at 58.8s, 86.8s and
91.7s — all previously impossible — now complete.

## Bug 3 — the step limit discards the agent's answer, and a placeholder hid it

**Severity: HIGH.** The ReAct loop breaks the instant `turn === maxSteps - 1`.
When that final turn carries tool calls, the calls are discarded *and* the model
never gets a turn to speak about work it already did — so the run ends with no
prose at all. At `maxSteps=2` this hits **every** agent that uses a tool on its
first turn, which is the common case.

The earlier "fix" made the gateway synthesise `Reached the N-step limit after
calling: ...`. That converted a visible failure into an invisible one: the
harness saw a non-empty string and scored a success, producing the bogus
"0 empty replies" headline while 10 of 10 tool-using agents said nothing.

**Fix, three parts:**

1. **`apps/gateway/src/routes/agent-chat-loop.ts`** — on a step-limited exit with
   pending tool calls, issue **one final summarisation turn** with `tools`
   withheld (so it cannot emit another tool-call turn) asking the model to state
   its findings. Its tokens and cost are counted; failure is non-fatal.
2. The placeholder is now last-resort only and prefixed **`[dmr-x] No agent
   output produced`** — impossible to mistake for an agent's answer in a
   benchmark or UI.
3. **`scripts/agent_fleet_workload.py`** — scores `real_reply` and `placeholder`
   separately and prints `REAL AGENT REPLIES` as the headline, so the harness can
   no longer credit the gateway's apology as agent output.

Regression tests in `tests/unit/agent-chat-loop-final-summary.test.ts` pin that
the summary turn fires, withholds tools, counts its tokens, is **skipped** when
prose already exists or no tools were used, and falls back to the marked
placeholder when the provider fails.

**Result:** real replies 7/24 → 23/24. The 5 tool-using agents now return
1127-3513 characters of their own analysis instead of 128 characters of
placeholder; zero placeholders logged across the run.

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
