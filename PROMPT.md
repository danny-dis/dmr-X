# Issue #16 — Free Inference Control Plane Implementation

You are in the `dmrx-issue16-free-inference` worktree on branch `fix/issue16-free-inference-impl`. Base: `268394b`.

## Context

The quota package at `services/quota/src/` has ~4800 lines:
- `capacity-manager.ts` (395) — atomic reservation engine, InMemoryCapacityStore
- `capacity-store-distributed.ts` (303) — distributed store
- `dynamic-limits.ts` (408) — header parsing, quota status
- `free-provider-catalog.ts` (448) — catalog with eligibility/confidence
- `provider-adapters.ts` (779) — adapter layer
- `quota.service.ts` (369) — candidate filtering + usage
- `quota-dimensions.ts`, `quota-vector.ts`, `rate-limit.service.ts`, `rate-limit-tracker.ts`

## Tasks

### 1. Wire atomic reserve→dispatch→reconcile into quota.service.ts
Read `services/quota/src/quota.service.ts` lines 35-76 (filterByQuota) and 168-200 (usage recording). Replace read-then-check with atomic reservation: call `tryReserve()` before dispatch, `commit()` + `release()` after. Use `capacity-manager.ts` exports.

### 2. Fix fail-closed in dynamic-limits.ts
Read `services/quota/src/dynamic-limits.ts` lines 34-44. `calculateQuotaStatus()` defaults unknown to 100% available — unsafe for `free_only`. Add `failClosed: boolean` param. When true, unknown/stale → `isExhausted=true`.

### 3. Add multi-instance stampede tests
Create `tests/capacity-stampede.test.ts`. Verify two concurrent `InMemoryCapacityStore` instances (simulating two gateways) cannot both reserve the same quota. The store's `tryReserve` must be atomic — only one succeeds.

### 4. Verify provider adapters reconcile quota
Read `services/quota/src/provider-adapters.ts`. After each adapter's response handling, verify it calls `recordUsage()` or equivalent. Add if missing.

### 5. Add retry classifier
Create or update a service that classifies 429s by dimension (RPM/TPM/RPD/TPD), honors `Retry-After` headers, and bounds retry budgets.

### 6. Add free-only guard
Ensure `free_only` mode makes it impossible to select a paid model. The `free-provider-catalog` eligibility check must be authoritative. Add a test that verifies zero paid selections under `free_only`.

### 7. Add metrics counters
Add counters for: reservations attempted/succeeded/failed, 429s avoided, Retry-After honors, free-only violations (must be zero). Use simple in-memory counters or the existing metrics system.

### 8. Streaming replay safety
Ensure streaming failures don't replay as duplicate generations. Check for idempotency keys in stream request paths. Add if missing.

## Commands

- Run tests: `bun test services/quota/`
- Add tests in `tests/` directory
- Commit incrementally with descriptive messages
