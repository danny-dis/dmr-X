# A2A Completion Report — 2026-10-03

**Worktree:** `C:/Users/pc/Documents/projects/DMR-X-workers-20261003/a2a`
**Branch:** `completion/a2a-20261003` (base commit `e09aff3`)
**Lane:** A2A only. `services/mcp-server/src/index.ts` and `auth-runtime.ts` were **not** touched (MCP lane).
**State:** changes left **uncommitted and unstaged**, as instructed.

---

## 1. Outcome summary

| Area | Result |
|---|---|
| Ownership suite (was 3 RED) | **3/3 GREEN** |
| New ownership-secrecy suite | **15/15 GREEN** |
| New webhook-egress security suite | **47/47 GREEN** |
| New protocol-contract suite | **7/7 GREEN** |
| Adjacent A2A suites (rpc-methods, agent-card, peer-probe) | **31/31 GREEN** |
| **All A2A suites together** | **103/103 GREEN, 7 files** |
| `tsc --noEmit` in A2A lane | **0 errors** |

Three genuine production defects were found by the new tests and fixed (see §6). One
pre-existing failure set in the gateway lane is unrelated and proven so (§7).

---

## 2. Changed files

### Modified (5 production files, +522 / −60)

| File | Change |
|---|---|
| `services/mcp-server/src/a2a/task-manager.ts` | Ownership stores, owner guards, owner-scoped API, in-flight dispatch registry |
| `services/mcp-server/src/a2a/jsonrpc.ts` | Owner resolution + enforcement on every method; new error codes; webhook registration gate |
| `services/mcp-server/src/a2a/handler.ts` | Legacy REST owner-scoped (`/a2a/tasks`, `/a2a/tasks/:id`); 401 for missing principal |
| `services/mcp-server/src/a2a/persistence.ts` | `a2a_owners` / `a2a_context_owners` tables, binding persistence/rehydration, pinned-IP webhook delivery |
| `services/mcp-server/src/a2a/dispatch.ts` | Cancellable dispatch (shared abort signal for timeout + cancel) |

### New (2 production files)

| File | Purpose |
|---|---|
| `services/mcp-server/src/a2a/owner.ts` | **The identity seam.** Bearer validation, non-reversible owner digest, tenant binding, pluggable resolver |
| `services/mcp-server/src/a2a/egress.ts` | SSRF policy: address classification, DNS pinning, bounded pinned-IP delivery |

### New / modified tests (4 files)

| File | Status |
|---|---|
| `tests/unit/a2a-production-ownership.test.ts` | **modified** — one assertion repaired (see §5) |
| `tests/unit/a2a-ownership-secrecy.test.ts` | new — 15 tests |
| `tests/unit/a2a-webhook-egress-security.test.ts` | new — 47 tests |
| `tests/unit/a2a-protocol-contract.test.ts` | new — 7 tests |

---

## 3. The identity seam (exact contract)

`services/mcp-server/src/a2a/owner.ts` → **`resolveOwnerId(headers): Promise<string | undefined>`**

1. If a resolver is installed via `setOwnerResolver()`, it is **authoritative** and its
   result is used verbatim. `undefined` means "no tenant-scoped principal" → **no access**.
   The resolver may return:
   - `OwnerIdentity` (`{ ownerId, tenantBinding }`) — passed through untouched, so a
     listener that already holds a stable opaque id keeps control of the namespace; or
   - `ResolvedPrincipal` (`{ subject, tenant? }`) — **hashed**, so the subject id itself
     is never persisted.
2. Otherwise `defaultResolveOwner()` reads `Authorization: Bearer <token>`, validates the
   shape (scheme, non-empty, ≤4096 chars, no whitespace/control chars), and derives
   `ownerId = sha256("dmrx.a2a.owner.v1" + "principal" + token + tenant)`.
3. Anything failing validation → `undefined`. There is **no permissive fall-through**.

**The tenant header never authorizes.** `x-dmr-tenant-key` is caller-supplied, so it is
only ever mixed into the digest of an already-bearer-authenticated request. Presenting
another tenant's key yields a different digest and is denied; a tenant key with no bearer
returns `undefined` (401 / empty list). Both are asserted in
`a2a-ownership-secrecy.test.ts`.

**Parent integration:** the MCP listener authenticates first, then calls
`setOwnerResolver(async (headers) => ({ subject: <validated sub>, tenant: <scoped tenant> }))`.
No parent file was modified. Where the parent passes no resolver, the default bearer path
applies.

**Credential safety:** only the 64-hex digest is stored (`a2a_owners.owner_id`). Verified
by test — the digest contains neither the token nor the tenant key, and neither string
appears in any outbound payload (task, get, list, push-config get).

---

## 4. GitNexus impact records (run before each edit)

All runs against the original index (`-r dmr-X`, upstream).

| Symbol | File | Direct | Processes | Risk |
|---|---|---|---|---|
| `createTask` | task-manager.ts | 2 | 1 (`handleRpcStream`) | LOW |
| `getTask` | task-manager.ts | 5 | 1 (`handleRpcStream`) | **MEDIUM** |
| `listTasks` | task-manager.ts | 2 | 0 | LOW |
| `cancelTask` | task-manager.ts | 1 | 0 | LOW |
| `setPushConfig` | task-manager.ts | 2 | 1 | LOW |
| `handleRpc` | jsonrpc.ts | 2 | 0 | LOW |
| `handleRpcStream` | jsonrpc.ts | 1 | 0 | LOW |
| `persistTask` | persistence.ts | 4 | 1 | LOW |
| `firePushNotification` | persistence.ts | 1 | 1 | LOW |
| `dispatchTask` | dispatch.ts | 2 | 1 | LOW |
| `handleA2ARoutes` | handler.ts | 0 | 0 | LOW |

**No HIGH or CRITICAL risk was returned**, so no stop-and-warn condition arose.
Every impacted symbol lives in the `A2a` module; the only affected execution flow is
`HandleRpcStream → IsTerminal`.

**New-symbol limitation:** `owner.ts`, `egress.ts`, and the new
`A2ATaskManager` owner-scoped methods are not in the original index, so they have no
upstream impact record. I impacted their enclosing/caller symbols instead
(`A2ATaskManager` via `createTask`/`getTask`/`listTasks`/`cancelTask`/`setPushConfig`,
and `handleRpc`/`handleRpcStream`/`handleA2ARoutes`/`dispatchTask`/`firePushNotification`),
which is recorded above. Repository rules were not disabled.

**`detect_changes()` (post-change):** 41 touched symbols, **all within
`services/mcp-server/src/a2a/*`**, 1 affected process, risk `medium` (volume of touches in
one module). **No cross-lane symbol is affected.** No symbol was renamed; `gitnexus_rename`
was therefore not needed and find/replace renaming was not used.

---

## 5. The one repaired assertion (equivalent intent, not weakened)

`a2a-production-ownership.test.ts:88` originally read:

```ts
expect(task.metadata).not.toHaveProperty('owner');
```

`metadata` is legitimately `undefined` for a task created without caller metadata, and
Vitest's `toHaveProperty` **throws on `undefined` before asserting anything** — the test
failed on the matcher, not on a leaked owner. This is the failure the brief flagged.

Repaired to:

```ts
expect(task.metadata ?? {}).not.toHaveProperty('owner');
expect(JSON.stringify(task)).not.toContain('production-owner-a');
expect(JSON.stringify(task)).not.toContain('fixture-gateway-key-a');
```

**Why intent is preserved and strengthened:** the property under test is "no ownership
marker is exposed on the outbound task". The repaired pair asserts it for both the
`undefined` and the metadata-present case, and I **added** a third assertion that the
tenant key is also absent — strictly stricter than the original two lines. No security
assertion was deleted, weakened, or skipped.

---

## 6. Real defects found and fixed

These were found by the new tests, not assumed:

1. **SSRF bypass — IPv4-mapped IPv6 in hex form (`egress.ts`).**
   `new URL()` normalizes `::ffff:169.254.169.254` to `::ffff:a9fe:a9fe`. My first
   IPv6 classifier only matched the *dotted* spelling, so the **cloud-metadata address
   `::ffff:a9fe:a9fe` passed as "public IPv6"**. Fixed by extracting the embedded IPv4
   from both spellings (shared helper now also used for 6to4). Regression-tested.

2. **Cross-principal task leak — unauthenticated `tasks/list` (`task-manager.ts`).**
   `listOwnedTasks(undefined)` fell through to the unfiltered store, so a `tasks/list`
   with no bearer credential returned **every task in the process**. Fixed by giving
   `listTasks` an explicit `authorized` predicate and defining the no-principal case
   explicitly (empty, or the opt-in unowned set only). Also moved the filter **before**
   the `limit` slice so an unauthorized task cannot displace an authorized one.

3. **Abort lost during DNS resolution (`egress.ts`).**
   A signal already aborted while `deliverWebhook` awaited DNS was missed, because the
   listener was attached after the await — the delivery then ran to its 10s timeout.
   Fixed by checking the latched `signal.aborted` state, placed **after** the request's
   error handlers so the `destroy()` cannot surface as an unhandled exception (this
   second half was itself caught by Vitest's unhandled-error detector).

A fourth issue — **authorization ordering** in `tasks/pushNotificationConfig/set` — was
caught by the pre-existing ownership test: validating the URL before checking ownership
returned `-32006` instead of `-32001`, leaking the webhook policy to non-owners and
making them trigger a DNS lookup. Corrected to authorize first, then validate.

---

## 7. Pre-existing failure proven unrelated

`tests/unit/agentic-cancel-inflight.test.ts` — **3 failures** (gateway lane).

- That file imports **only** `apps/gateway/src/routes/agentic.routes.js`; it contains no
  reference to `a2a` or `mcp-server`.
- Proven pre-existing by stashing **only** `services/mcp-server/src/a2a` and re-running:
  the **identical 3 tests fail on the pristine baseline**. The stash was restored
  immediately (`git stash pop`, confirmed via `git status`).

This is a real cancellation gap in the **gateway agentic** route, not A2A. It is named
here as a cross-lane blocker for whoever owns `apps/gateway`. The A2A equivalent gap is
fixed and covered (§8).

---

## 8. Cancellation

`dispatchTask` previously used `AbortSignal.timeout(...)`, so `tasks/cancel` only changed
the stored status — the provider call ran to completion and its result was then discarded.
The client paid for work nobody could receive.

Now one `AbortController` carries **both** the deadline and the cancel, registered with
the task manager (`registerDispatch` / `abortDispatch`). `cancelTask` sets the terminal
state **first**, then aborts, so the aborted dispatch's own error path observes an
already-terminal task and cannot resurrect it.

Covered by `a2a-protocol-contract.test.ts`:
- an in-flight dispatch's signal is observed aborted by the cancel;
- the dispatch **settles promptly** instead of running out its 60s timeout;
- the task stays `canceled` (not resurrected as `completed`/`failed`);
- a terminal task still correctly refuses cancellation (`-32002`).

One assertion I deliberately **did not** ship: that the upstream TCP socket is torn down.
That is undici's connection-pool policy (it keeps sockets for reuse by design), not a
property of this change; asserting it would have been a flaky test of the wrong thing.
The abort is asserted at the `AbortSignal` instead — the seam this lane owns.

---

## 9. Webhook egress

`egress.ts` is applied at **both** gates:

- **Registration** — `tasks/pushNotificationConfig/set` and the inline
  `params.configuration.pushNotificationConfig` on `message/send|stream`. A refused URL is
  **not stored**, and the caller gets `-32006 WEBHOOK_NOT_ALLOWED` instead of a config that
  would never fire.
- **Delivery** — `firePushNotification` re-resolves and re-validates immediately before
  connecting, closing the DNS-rebinding window left open by a registration-time-only check.

Policy: `http`/`https` only; no embedded credentials; no fragment; all loopback / RFC1918 /
link-local / CGNAT / multicast / reserved / unspecified ranges refused for IPv4 **and** IPv6
(including IPv4-mapped and 6to4 forms); **ambiguous IP encodings refused outright** rather
than normalized (decimal, octal, hex, short-dotted); internal-only names refused;
**every** DNS answer validated, not just the one dialled; the dialled IP is **pinned** and
the name is never resolved twice; **redirects not followed**; TLS hostname preserved via
`servername` while the socket targets the pinned IP, with `Host` carrying the original
host:port.

Delivery is bounded: connect/response timeout, 64KB response-body cap, and abort-signal
support.

**Operator escape hatch:** `DMRX_A2A_WEBHOOK_ALLOWED_IPS` (comma-separated literal IPs).
Explicit, documented, logged when used, and it matches **only** the listed address — a
neighbouring `127.0.0.2` is still refused. Loopback fixtures in tests are authorized this
way; **no test reaches an arbitrary network address.**

---

## 10. Version / capability truthfulness

No false 1.0 claim was introduced, and existing behaviour is preserved:
- legacy `protocolVersion: "0.3.0"` (0.3.0 consumers keep matching) and
  `supportedInterfaces[0].protocolVersion: "1.0"` (MAJOR.MINOR) are unchanged.
- `validateAgentCard`'s MAJOR.MINOR rule and both discovery paths untouched.

`a2a-protocol-contract.test.ts` asserts the card is **honest**, not just well-formed:
- every advertised blocking method answers and never `METHOD_NOT_FOUND`;
- `streaming: true` is backed by real SSE behaviour on `message/stream` + `tasks/resubscribe`;
- `pushNotifications: true` is backed by an **end-to-end** delivery to a policy-authorized
  loopback fixture, and the stored config round-trips;
- `stateTransitionHistory: true` is backed by `historyLength` actually trimming, with
  malformed values rejected rather than clamped;
- the v1.0-only method `tasks/sendSubscribe` still returns `METHOD_NOT_FOUND` (we implement
  the 0.3 shape only and do not pretend otherwise).

`a2a-rpc-methods.test.ts` (which calls `handleRpc` with **empty** headers) still passes
unchanged — an unauthenticated `tasks/list` returns an empty array, which remains
spec-legal.

---

## 11. Exact commands and results

```bash
# RED baseline (before changes)
bun x vitest run --config vitest.config.ts --project unit \
  tests/unit/a2a-production-ownership.test.ts --maxWorkers 1 --retry 0
# -> 3 failed (metadata undefined / -32001 expected / 404 expected)

# Ownership suite (after changes)
bun x vitest run --config vitest.config.ts --project unit \
  tests/unit/a2a-production-ownership.test.ts --maxWorkers 1 --retry 0
# -> Test Files 1 passed (1) | Tests 3 passed (3)

# Ownership secrecy
bun x vitest run --config vitest.config.ts --project unit \
  tests/unit/a2a-ownership-secrecy.test.ts --maxWorkers 1 --retry 0
# -> Test Files 1 passed (1) | Tests 15 passed (15)

# Webhook egress security
bun x vitest run --config vitest.config.ts --project unit \
  tests/unit/a2a-webhook-egress-security.test.ts --maxWorkers 1 --retry 0
# -> Test Files 1 passed (1) | Tests 47 passed (47)   (no unhandled errors)

# Protocol contract
bun x vitest run --config vitest.config.ts --project unit \
  tests/unit/a2a-protocol-contract.test.ts --maxWorkers 1 --retry 0
# -> Test Files 1 passed (1) | Tests 7 passed (7)

# Adjacent A2A
bun x vitest run --config vitest.config.ts --project unit \
  tests/unit/a2a-rpc-methods.test.ts tests/unit/a2a-agent-card.test.ts \
  tests/unit/a2a-peer-probe-security.test.ts --maxWorkers 1 --retry 0
# -> Test Files 3 passed (3) | Tests 31 passed (31)

# All A2A together (7 files)
bun x vitest run --config vitest.config.ts --project unit \
  tests/unit/a2a-production-ownership.test.ts tests/unit/a2a-ownership-secrecy.test.ts \
  tests/unit/a2a-protocol-contract.test.ts tests/unit/a2a-webhook-egress-security.test.ts \
  tests/unit/a2a-rpc-methods.test.ts tests/unit/a2a-agent-card.test.ts \
  tests/unit/a2a-peer-probe-security.test.ts --maxWorkers 1 --retry 0
# -> Test Files 7 passed (7) | Tests 103 passed (103)   Duration 21.34s

# Typecheck
bun x tsc --noEmit -p tsconfig.json
# -> A2A-lane errors: 0
# -> 70 pre-existing error lines in files this lane never touched:
#    apps/gateway/test/integration.test.ts (19), services/mcp-server/scripts/* (20),
#    vitest.config.ts (3), patches/* (2), scripts/* (7), services/agent-runtime (1),
#    services/plugin-loader-bootstrap (2), vitest.single.config.ts (1), plus a
#    missing @types declaration. Present on the untouched baseline.

# Pre-existing-failure proof (gateway lane)
git stash push -- services/mcp-server/src/a2a
bun x vitest run --config vitest.config.ts --project unit \
  tests/unit/agentic-cancel-inflight.test.ts --maxWorkers 1 --retry 0
# -> Tests 3 failed (3)   IDENTICAL failures without any A2A change present
git stash pop          # restored
```

Skipped: no tests were skipped or filtered. `bun x` (bundled vitest) was used rather than
`npx` per instruction; no packages were installed, no build or `clean:src` was run, no
files were emitted, `node_modules` was not modified, and no real provider was called.

---

## 12. Decisions worth the parent's attention

1. **New error codes.** `AUTH_REQUIRED = -32005` (no authenticated principal) and
   `WEBHOOK_NOT_ALLOWED = -32006` (egress policy refusal) were added to `A2A_ERR`. A
   cross-owner task still returns the existing `TASK_NOT_FOUND (-32001)` so existence is
   never disclosed. `-32005` is deliberately distinct: reporting "not authenticated" as
   "task does not exist" would misdescribe our own state. The legacy REST shim maps
   `-32005` → **401** and `-32001` → **404**.

2. **Unauthenticated `message/send` is now refused** (`-32005`). A task created without a
   principal would have no provable owner and would be permanently unreachable. In
   production the MCP listener authenticates first, so this only affects callers that were
   bypassing it. **This is the one intentional behavior change for an existing deployment
   that relied on A2A with no `Authorization` header** — flagging it explicitly because it
   is a compatibility edge, not a silent change.

3. **Ownership lives in its own tables, not columns on `a2a_tasks`.** Ownership is
   immutable and written once, so `INSERT … ON CONFLICT DO NOTHING` makes re-binding
   impossible; a legacy DB needs no `ALTER TABLE`; and the digest can never be serialized
   back to a client by accident. Legacy rows simply have no binding → **unowned**.

4. **Unowned legacy tasks are hidden from all remote principals**, including the
   principal that originally created them (an unowned task has no provable owner, and
   guessing one *is* cross-company sharing). The in-process operator listing can see them
   only under the explicit `DMRX_A2A_LEGACY_UNOWNED_COMPAT=1` opt-in; even then, remote
   principals still get nothing.

5. **`x-dmr-tenant-key` is treated as a binding, not identity** — it is folded into the
   owner digest. Same bearer + different tenant key = different principal (denied); this
   is exactly what the second ownership test requires, and it is asserted directly.

6. **Guard reuse.** Ownership decisions live in exactly two places —
   `A2ATaskManager.authorize()` (task) and `isContextOwnedBy()` (context) — behind one
   `ownerIdMatches()` comparison. Remote surfaces call only the `*Owned*` methods.
   `listTasks`'s `authorized` predicate is the single reuse point for listings.
   Egress policy likewise has one implementation used by both gates. No repeated
   hand-rolled checks remain.

---

## 13. Remaining gaps / not done

1. **Cross-lane blocker:** `tests/unit/agentic-cancel-inflight.test.ts` (3 failures) is a
   genuine in-flight cancellation gap in the **gateway agentic route**. Proven pre-existing
   and out of this lane. Needs an owner in the gateway lane.
2. **`detect_changes` + final commit are the parent's**, per the brief. `detect_changes` was
   run here (§4) and shows no cross-lane impact.
3. **Parent wiring not done (by design, MCP lane):** install the resolver with
   `setOwnerResolver(...)` in `services/mcp-server/src/index.ts`. Until that is done the
   default bearer-header resolver applies, which is correct but does structural validation
   only — it proves the credential is *well-formed*, not *authentic*. In production the
   parent authenticates first, so this is defence in depth rather than the primary control.
4. **`egress.ts` has no TLS fixture test.** TLS hostname preservation is implemented
   (`servername` + explicit `Host`) and unit-asserted for the HTTP path, but no real HTTPS
   fixture with a certificate was stood up (would need generated certs; avoided under the
   disk constraint). Worth adding in the parent lane if cert fixtures are acceptable.
5. **`tasks/list` has no cursor.** Pre-existing and documented in-code: `nextPageToken` is
   omitted (spec-legal, signals "no further pages"). Real pagination needs a storage change
   and is out of scope here.
6. **Full-repo unit suite not run.** Only the A2A lane plus 4 adjacent files were executed
   (single worker, disk constrained). The 70 `tsc` error lines are pre-existing in unrelated
   files. A full `--project unit` run is recommended at integration time.
