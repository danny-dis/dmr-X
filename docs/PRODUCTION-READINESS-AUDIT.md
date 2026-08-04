# DMR-X Production Readiness Audit

**Date:** 2026-08-04
**Version audited:** 0.5.12 (`main`, working tree dirty)
**Status:** Security, runtime, ops/deployment, and completeness passes complete
and cross-verified. Build/typecheck/test pass still running.

## Baseline

- ~166k lines of TS/TSX across 716 source files, 1048 tracked files.
- 286 commits over ~10 weeks (first commit 2026-05-28). Pre-1.0, no v1.x tag.
- 25 of the last 60 commits are `fix:`, plus 2 `security:` and a
  `fix/security-audit` merge — still stabilizing, not in maintenance.
- Working tree carries 12 modified + 7 untracked files, clustered around
  unreviewed "godmode"/server-manager WIP. The current checkout is not a
  shippable state.

## Verdict

**Not production-ready.** Three independent passes each found blocking issues,
and they are blocking for different reasons — this is not one bad area.

1. **Security.** A single tenant API key of any role yields arbitrary code
   execution on the gateway host (C1), and that host holds the encryption key for
   every provider credential in the system. All four CRITICAL security findings
   were independently re-verified against the source.
2. **Architecture.** The persistence layer degrades as a function of *lifetime
   request count*, with no retention anywhere. At 1 req/s it reaches
   multi-second, event-loop-blocking saves within a week and never recovers (R1,
   benchmarked). Horizontal scaling is not possible at any replica count above 1
   (R8) — no file locking exists, and the write path rewrites the entire database.
3. **Operations.** The documented deploy path does not work, the shipped backup
   script cannot run in the shipped production configuration, and a wrong or
   rotated encryption key silently boots an empty database while reporting
   healthy (O1–O4).

**Safe envelope as-is:** single-instance local development, demos, and personal
use — which matches the project's stated local-first origin, and it is genuinely
good at that job. The adapter abstraction, abort plumbing, migration
checksumming, SSRF defense, AES-GCM implementation, and `saveDatabase()`
hardening are all above average work.

**The engineering is not the problem.** The problem is that the operational
envelope — deploy, persist, back up, upgrade, scale — has never been exercised
end-to-end, and the documentation describes an intended system rather than the
built one.

## Security findings

Severity, location, and impact. Line numbers are from the audited working tree.

### CRITICAL

**C1 — Any tenant API key yields arbitrary code execution on the gateway host.**
`apps/gateway/src/routes/tools.routes.ts:1072-1111` (bash handler), allowlist at
`:717-731`. The allowlist gates the *binary*, not its arguments, so `node -e`,
`python -c`, and `bun x <pkg>` all pass. Reachable via `POST /v1/tools/execute`
(`:1321`), whose handler applies no RBAC check (`:1332-1360`;
`requireAgentPermission` is never applied). `execute_code` (`:218-296`) is
unrestricted by design. Env is stripped from the child (`:1106-1110`), but it
runs as the gateway's OS uid, so `.env`, `~/.dmr-x/data.db`, and
`/proc/<pid>/environ` are readable — `DMRX_ENCRYPTION_KEY` and every provider
key are recoverable. One leaked tenant key compromises the host and the entire
credential store.

**C2 — The gateway clones and executes a third-party GitHub repo on every boot,
by default.** `apps/gateway/src/lib/sidecar-boot.ts:508` defaults
`DMRX_GODMODE_AUTOSTART` to `'true'`. The start path
(`services/server-manager/src/server-manager.service.ts:203-237`) git-fetches
`danny-dis/G0DM0D3`, runs `bun install` (`:242`) — executing arbitrary lifecycle
scripts from that repo's dependency tree — then spawns it with
`env: { ...process.env, ... }` (`:544-548`), handing the child the admin key,
encryption key, and all provider keys. Supply-chain compromise of that repo or
any transitive dependency is RCE on the gateway, with no opt-in.

**C3 — The spawned companion process runs unauthenticated in relay mode.**
`services/server-manager/src/server-manager.service.ts:554`:
`if (godmodeKey && !llmBaseUrl) env.GODMODE_API_KEY = godmodeKey;`. The comment
at `:549-553` states the intent — unset disables auth in relay/local mode. The
autostart path always passes `llmBaseUrl` (`sidecar-boot.ts:548-551`), so the
child on port 7860 has auth disabled while configured to relay into DMR-X's
provider vault. **Unverified:** the child's bind address lives in the external
fork; loopback vs `0.0.0.0` is unconfirmed and decides the severity.

**C4 — Godmode lifecycle endpoints are tenant-authenticated, not
admin-authenticated, and unvalidated.** `apps/gateway/src/server.ts:643` mounts
them under `/v1`, not `/v1/admin`, and `auth.middleware.ts:138` only enforces the
admin key on `/v1/admin*`. `apps/gateway/src/routes/godmode.routes.ts:222,250`
define `POST /godmode/server/install` and siblings with no Zod schema and no role
check, though every other route in the same file uses `safeParse`. Any tenant key
can trigger clone + `bun install` + spawn, and can set `llmBaseUrl` to an
attacker-controlled host — `validateBaseUrlForSSRF` is never called here. This is
in the uncommitted WIP.

### HIGH

**H1 — Every error logs the caller's API key in plaintext.**
`apps/gateway/src/security-headers.ts:57-60` passes the whole Fastify request to
the logger, and `packages/utils/src/logger.ts:7-14` configures pino with no
`redact` and no `req` serializer. `FastifyRequest.raw` is own-enumerable, so pino
serializes `IncomingMessage` including `rawHeaders` (confirmed with a local
pino+http repro). The handler fires on 400s and 401s too, so failed auth attempts
write attempted keys and erroring authenticated requests write valid ones. Log
access becomes tenant impersonation.

**H2 — Some production hardening is gated on `NODE_ENV`, whose shipped default is
`development`.** *(Scope corrected by a second verification pass — see below.)*
`apps/gateway/src/main.ts:101-103` returns early unless
`NODE_ENV === 'production'`, skipping the checks at `:105-127`.
`.env.example:5` ships `NODE_ENV=development` and `apps/gateway/package.json:16`
(`"start": "bun src/main.ts"`) never sets it. A by-the-book deploy therefore
omits HSTS (`security-headers.ts:20`) and returns `dev_message`/`dev_stack` to
clients (`security-headers.ts:68,83-87`).

**Correction:** admin-key strength and encryption-key format are *not* actually
lost, because `server.ts:186-201` re-validates both unconditionally whenever
`LOCAL_MODE` is false, independent of `NODE_ENV`. The only guard genuinely
skipped is the **CORS wildcard/empty-origin check** (`main.ts:121-126`), which
has no `server.ts` equivalent — so `DMRX_CORS_ORIGIN=*` is accepted with no
startup error in any deployment not labelled `production`, despite the CORS
registration comment claiming "never use wildcard origin." The real safety valve
throughout is `DMRX_LOCAL_MODE`, not `NODE_ENV`.

*Can admin routes end up wide open in production?* Yes, by exactly one path:
`DMRX_LOCAL_MODE=true` with `NODE_ENV` unset or `development`.
`auth.middleware.ts:142` is an unconditional `if (LOCAL_MODE) return;`. The
startup guard that would catch it (`main.ts:94-99`) only fires when
`NODE_ENV === 'production'`. With `LOCAL_MODE` false the guards hold:
`server.ts:188-193` hard-throws on a missing/weak/default admin key, and
`auth.middleware.ts:143-152` blocks admin routes rather than opening them when no
key is set. The bypass is single-variable, and the variable protecting it is the
wrong one.

**H3 — Two high-severity dependency advisories** (`bun audit --prod`: 11 total,
2 high, 9 moderate). `fast-uri <3.1.5` host confusion (GHSA-7p8r-x3mc-p8w7) via
fastify — and the root `package.json` `overrides` pin of `^3.1.4` is itself below
the fixed version. `ip-address <=10.3.0` leading-zero octet decoding enabling
SSRF and trust-boundary bypass (GHSA-mwp4-54f8-5fhr) via
`@modelcontextprotocol/sdk` and `@kubernetes/client-node`. `undici <6.28.0`
response desync / CRLF injection (gateway pins `^6.21.0`).

### MEDIUM

- **M1** `apps/gateway/src/routes/validate.routes.ts:27` — unauthenticated
  admin-key oracle using `===`, undoing the constant-time comparison the auth
  middleware carefully implements at `auth.middleware.ts:163-173`. `/validate` is
  in `PUBLIC_ROUTES`.
- **M2** `apps/gateway/src/routes/tools.routes.ts:917` — sandbox containment via
  `startsWith` with no trailing separator, so workspace `.../req1` also admits
  `.../req11`. The MCP server gets this right (`services/mcp-server/src/server.ts:407-419`,
  using `path.relative`) and documents this exact pitfall; the gateway copy was
  never updated.
- **M3** `apps/gateway/src/server.ts:911` — `api_key_ref` is a free-form string
  (`admin.routes.ts:271`), so an admin can set it to `DMRX_ENCRYPTION_KEY` and
  point `base_url` at any public host, exfiltrating the master key as an
  Authorization header.
- **M4** `apps/gateway/src/routes/admin.routes.ts:96-107` — provider keys entered
  via the UI are written back to `.env` in plaintext and injected into
  `process.env`, defeating encryption at rest and feeding C1/C2.
- **M5** `apps/gateway/src/health-endpoints.ts:29-31` — unauthenticated
  INSERT/DELETE per `/healthz` request, and raw `err.message` returned to
  unauthenticated callers (`:23`, `:33`).

### LOW

- **L1** `server.ts:98` — client-supplied `x-request-id` used verbatim in logs
  and echoed in 5xx bodies; log injection / correlation-id spoofing.
- **L2** `auth.middleware.ts:168-172` — admin keys silently truncated to 256
  bytes before comparison.
- **L3** `packages/utils/src/crypto.ts:199-208` — `encryptConfigApiKey` silently
  stores plaintext when `DMRX_ENCRYPTION_KEY` is absent. LOCAL_MODE only, but
  dev databases hold plaintext keys with no signal.
- **L4** `security-headers.ts:18` — CSP includes `script-src 'unsafe-inline'`,
  acknowledged in-comment as needed for OAuth callback pages.

## Verified clean

These were checked and found correct — worth recording so they aren't re-audited.

- **SQL injection: none found.** Every dynamic-SQL site composes fragments from
  hardcoded column names with `?` placeholders. The one `ORDER BY ${orderBy}`
  (`services/agent-registry/src/agent-registry.service.ts:853`) selects from four
  hardcoded literals.
- **SSRF defense on provider base URLs is strong.** `apps/gateway/src/routes/admin-ssrf.ts`
  resolves DNS itself, blocklists private/loopback/link-local/CGNAT/metadata
  ranges for v4 and v6, folds IPv4-mapped IPv6, and returns a pinned `lookup` to
  close the rebinding window. Applied at all seven provider-URL sites. An admin
  cannot point a provider at an internal address. C4 bypasses this module
  entirely.
- **AES-256-GCM is implemented correctly.** Fresh 12-byte random IV per operation
  (`crypto.ts:134`, `:166`), auth tag verified on decrypt, no default or fallback
  key — `deriveEncryptionKey` throws (`:100-110`).
- **Provider keys are not returned by admin APIs** — responses strip `apiKey` and
  `api_key_ref`, exposing only `masked_key_prefix` / `has_api_key`.
- **MCP file tools are correctly sandboxed** (`services/mcp-server/src/server.ts:407-475`).
- **Rate-limit ordering is correct** — per-tenant keying works despite the plugin
  being registered before auth, because `@fastify/rate-limit` attaches per-route
  via `onRoute`.
- **`scripts/dev/patch-godmode.ts` is benign** — fixed `__dirname`-relative paths,
  local patch files, marker-guarded idempotent `git apply`.

## Not verified

- `npm audit --omit=dev` could not run — no `package-lock.json` (ENOLOCK).
  Findings come from `bun audit --prod` against `bun.lock`.
- The external G0DM0D3 repo's bind address, auth model, and code.
- Nothing was executed against a running gateway; all auth-bypass reasoning is
  static.
- `services/router/`, `services/adapters/`, billing/quota/policy services, and the
  UI beyond the diff were out of the security pass's scope.

### Note on a fragile construct

`auth.middleware.ts:114-119` makes every non-`/v1` GET public and treats
dot-suffixed paths as static assets. This was traced against the two non-`/v1`
route surfaces (`cloudcode.routes.ts:335`, `gemini.routes.ts:309`) and found
**not** currently exploitable — the dispatcher requires paths ending in
`generateContent`/`loadCodeAssist`, which is mutually exclusive with the
`.json`/`.js` suffix the bypass needs. But any future GET or dot-suffixed route
registered outside `/v1/` inherits an auth bypass.

## Operations & deployment findings

### CRITICAL

**O1 — The default `docker-compose.yml` persists nothing; every upgrade destroys
the database.** `Dockerfile:103` sets `DMRX_DATA_DIR=/app/data`, but
`docker-compose.yml:22-23` mounts the named volume at `/home/dmrx/.dmr-x`, which
the app never writes to. All SQLite data lands in the container's ephemeral write
layer. `docs/DEPLOYMENT.md:100` repeats the same wrong mount.
`docker-compose.prod.yml:71,81` gets it right — so the "Recommended" quickstart
is the broken path.

**O2 — The shipped backup script cannot work in the shipped production config.**
`docker-compose.prod.yml:59-60` makes `DMRX_ENCRYPTION_KEY` mandatory. With that
key set, `packages/db/src/client.ts:123-124` writes **`data.db.enc`** (an
AES-256-GCM blob) and `:147` deletes any plaintext `data.db`. But
`scripts/backup/backup.sh:37-41` hard-exits when `data.db` is absent. The cron
backup container therefore fails on every run, forever. Even with the path fixed,
`sqlite3 .backup` cannot read an encrypted blob.

**O3 — A wrong or rotated encryption key silently wipes the database.**
`packages/db/src/client.ts:698-764`: a decryption failure looks like a corrupt
file, so the code renames the real database to `.corrupt.<ts>.bak`, tries every
`.lastgood`/`.bak` candidate (all encrypted with the same wrong key, so all
fail), then at `:761-764` logs one `warn` and boots `new SQL.Database()`. The
gateway comes up healthy, reports `db_read: ok`, and serves an **empty**
database — no tenants, no providers, no keys. There is no documented key-rotation
procedure and no fail-fast on decryption failure. Silent total data loss from a
routine operation.

### HIGH

**O4 — Both documented quickstarts fail at boot.** `.env.example:21,24` ship
`DMRX_LOCAL_MODE=false` with the literal `DMRX_ADMIN_API_KEY=replace-with-admin-key`,
which `server.ts:188-193` rejects — so `cp .env.example .env` then run (per
`README.md:38-44`, `docs/DEPLOYMENT.md:24`) is a hard crash. Separately,
`docker-compose.yml:12-16` interpolates the three required secrets with no `:?`
guard alongside `NODE_ENV: production`, so unset vars become empty strings and
`validateStartupConfig` exits 1. `docker-compose.prod.yml:59-61` does this
correctly, but no document points to it as the production path.

**O5 — Unbounded table growth in a database that lives entirely in RAM.**
`request_logs` (`telemetry-hooks.ts:166-195`), `usage_records`
(`services/billing/src/usage-tracker.ts:114`), `messages`
(`conversation.routes.ts:292,352`), and `admin_audit_log`
(`admin.routes.ts:143`) are written on the hot path with **no pruning, retention,
or TTL** anywhere. Because `sql.js` holds the whole database in WASM memory and
re-serializes on every save, the ceiling is `DMRX_MEMORY_LIMIT` (1.5 GB default),
not disk. The system has a built-in, undocumented lifespan.
`docs/DEPLOYMENT.md:175` tells operators to watch disk; the real failure is OOM.

**O6 — Migration error-swallowing marks partially-applied migrations as complete.**
`packages/db/src/client.ts:540-543` catches `duplicate column name`, logs "skipping",
and records the migration as fully applied at `:577-581`. But `db.exec()` aborts
at the first failing statement, so every later statement in that migration —
indexes, backfills, additional columns — never runs, and the migration is
permanently marked applied with a matching checksum. Undetectable afterwards. The
FTS5 fallback (`:544-562`) is the same pattern: each statement retried
individually, every failure swallowed as a `warn`, migration recorded as applied,
conversation search silently gone. Migrations also run with **no transaction**
(`:539`), and there is **no rollback story at all** — no down migrations, no
revert tooling.

**O7 — Metrics may silently not exist.** `server.ts:437-450` wraps
`telemetry.start()` in a best-effort IIFE whose own comment says the OTel import
is broken and `PrometheusExporter` construction can hang. On failure the gateway
boots healthy with **no `/metrics` at all** and one `warn` line.
`docs/DEPLOYMENT.md:173` instructs operators to scrape `:9464/metrics` with no
mention it can be absent. `getTelemetryService()` is called with no config
(`server.ts:286`), so the OTLP exporter targets `http://localhost:4318` in every
deployment with no env var to change it.

**O8 — CI is weaker than it looks.** `.github/workflows/ci.yml:46` and `:169` set
`continue-on-error: true` on the **lint** and **e2e** jobs — neither can fail a
build. The e2e job only curls `/livez` and `/healthz`; the four real suites in
`tests/e2e/` self-gate on `DMRX_RUN_E2E === 'true'`, which CI never sets, so they
are permanently skipped. `ci.yml:74-83` quarantines
`mcp-input-validator.test.ts` for an unfixed OOM. The project's own
`docs/REMEDIATION-PLAN.md:328-334` documents this and concludes: *"today green
means less than it appears."*

**O9 — The release workflow fails at the release step.**
`.github/workflows/release.yml:262-273` runs `awk` over `CHANGELOG.md` at repo
root. There is no such file — it lives at `docs/CHANGELOG.md`. `awk` exits
non-zero with no `set +e`, so `release` fails after `binaries` and `container`
have both completed.

### MEDIUM

- **O10** `docs/DISTRIBUTION.md` describes a pipeline that does not exist: a
  windows/linux/macos matrix (`release.yml:24-27` is a single ubuntu job),
  archives containing `install.sh`/`install.bat`/`README.txt`
  (`release.yml:52` tars the binary plus `public/` only), and
  `scripts/package-release.sh` (CI never calls it). It omits what release.yml
  actually does — multi-arch GHCR push, cosign signing, CycloneDX SBOM.
- **O11** Every install URL in `README.md:39,55,60` and
  `docs/DISTRIBUTION.md:58,72` points at `github.com/dmr-x/dmr-x`. The real repo
  is `danny-dis/dmr-X`. All documented one-liners 404.
- **O12** `docker-compose.yml:32` overrides the Dockerfile healthcheck to hit
  `/health`, which is `async () => ({ status: 'ok' })` and always returns 200
  (`health-endpoints.ts:10`). The default compose deployment can never detect a
  degraded gateway.
- **O13** ~45 env vars are read in code and documented nowhere, including an
  entire undocumented mTLS feature (`main.ts:173-186`) and the content-capture
  switches `DMRX_CAPTURE_CONTENT=full` / `DMRX_REQUEST_LOG_BODY`
  (`services/telemetry/src/content-capture.ts:48-49`), which write raw prompts
  and completions into the log stream. Conversely
  `DMRX_META_MODEL_COST_FILTER` (`docs/CONFIGURATION.md:32,90`) exists in no
  source file, and every var under Observability / RBAC / Guardrails / Audit /
  Federation / Router Tuning is read **only** by the MCP sidecar
  (`services/mcp-server/src/index.ts:503-575`) — setting them has no effect on
  the gateway, with no error.
- **O14** `packages/utils/src/paths.ts:5-13` calls itself the "single source of
  truth" for the data directory, but `packages/db/src/client.ts:677` doesn't use
  it and resolves a different path. The bug the comment claims to have fixed is
  still live between those two files.
- **O15** Default drift across `.env.example`, `docs/CONFIGURATION.md`, and code
  (e.g. `DMRX_RATE_LIMIT_MAX` is 100 / 600 / 600 respectively). License metadata
  disagrees too: `package.json:9` says GPL-2.0, `Dockerfile:69,143` label the
  images BSL-1.1.
- **O16** `docs/SLO.md:25` states the burn-rate alert rules are "already
  implemented"; `monitoring/prometheus-alerts.yml` contains zero burn-rate rules.
  `docs/ROADMAP-STATUS.md:57` claims CRDs in `helm/`; none exist.
- **O17** `security-headers.ts:80` documents an `x-request-id` **response**
  header that no code sets. The id is returned inside 5xx JSON bodies only — so
  4xx responses and successes are uncorrelatable from the client side.

**Genuinely good, and worth preserving:** the Dockerfile (multi-stage, non-root
UID 1001, `tini` as PID 1, correct musl explanation); migration checksum
verification with pre-migration backups (`client.ts:583-647`, `:828-847`);
`saveDatabase()` hardening (`client.ts:118-184` — unique temp file per save with
a documented rationale, zero-byte refusal, atomic rename with Windows EPERM
backoff, rolling `.lastgood`); the structured per-request log record
(`services/telemetry/src/request-logger.ts:87-120`); real OTel spans with W3C
propagation; and a full Prometheus/Alertmanager/Grafana/Loki/Promtail stack in
`monitoring/` wired up by `docker-compose.prod.yml`.

## Runtime correctness & reliability

Three of these were **reproduced empirically**, not inferred.

### CRITICAL

**R1 — The persistence architecture self-destructs as a function of lifetime
request count.** ✅ benchmarked. Every request inserts a `request_logs` row
(`telemetry-hooks.ts:166`); every `.run()` calls `scheduleSave()`
(`client.ts:350`); `saveDatabase()` serializes and rewrites the **whole
database**, twice (`client.ts:132` synchronous `export()`, `:153` full write,
`:165` full `copyFile` to `.lastgood`). Measured against the real schema:

| rows | DB size | `export()` blocking | total per save |
|---|---|---|---|
| 10,000 | 4.8 MB | 5 ms | 19 ms |
| 100,000 | 48 MB | 48 ms | 243 ms |
| 500,000 | 242 MB | 205 ms | **2,069 ms** |

The debounce is 50 ms (`client.ts:186`). At ~100k lifetime requests, `export()`
alone blocks the event loop for as long as the whole debounce window — the
gateway spends ~half its wall clock frozen inside WASM serialization, stalling
every concurrent SSE stream. And **there is no `DELETE FROM request_logs`, no
pruning, no VACUUM anywhere in the repo** (this is the same gap as O5, from the
other direction). So the degradation is time-dependent, not load-dependent: **at
1 req/s it reaches 500k rows and 2-second saves in under 6 days** and never
recovers. Recovery requires manually deleting the database.

**R2 — A size-accounting leak in `MemoryCache` produces an infinite loop that
hard-freezes the process.** ✅ reproduced. `packages/db/src/cache.ts:60-72` —
`get()` removes an expired node without decrementing `_size`, unlike every other
removal path. `_size` drifts permanently upward, once per expired-key read.
`set()` then evicts against the inflated count (`:90-92`,
`while (this._size >= this.maxSize)`), and `evictLRU()` (`:316-331`) returns
*without* decrementing when both maps are empty. The `while` spins forever on a
synchronous path. Reproduced against the real class: reported size 10, actual
keys 0, `set()` → process killed by timeout with the unref'd watchdog never
firing, i.e. the event loop fully blocked. The 30 s sweep timer normally reaps
expired nodes first, so this needs a read of a key that expired inside the
current sweep window — exactly the access pattern of the rate limiter and route
cache under load. Once ~10,000 phantom counts accumulate, the next `set()` pins a
core and freezes the process: no requests, no health check, no signal handling.
A supervisor cannot detect it by exit code — it needs a liveness timeout.

**R3 — Graceful shutdown loses every write since the last save.** ✅ reproduced.
`client.ts:226-244` — `flush()` early-returns `if (saving)` **without awaiting**.
`closeDb()` then calls `raw.close()`, freeing the WASM heap, and the in-flight
`saveDatabase()` throws at `export()` — swallowed at `:166`. Reproduced: exported
0 bytes, export-on-closed-DB confirmed. Compounding it, `:119-120` returns the
existing in-flight promise, so even a correctly-awaiting flush would await a save
of a stale pre-shutdown snapshot. Every rolling deploy or pod eviction silently
drops the last window of writes — billing deductions
(`services/billing/src/credit.service.ts:84`), quota counters, conversation
messages. More broadly, **no write is durable before the client is
acknowledged**: `run()` fires `scheduleSave()` and discards the promise, so a 200
OK on a credit deduction precedes the disk write by ≥50 ms.

### HIGH

**R4 — Unguarded `await` on `'drain'` leaks the provider connection and the
request forever.** Eight identical sites: `chat.routes.ts:521-523,621-623,661-663`,
`anthropic.routes.ts:343,355`, `gemini.routes.ts:190,199`,
`cloudcode.routes.ts:166`:
`if (!reply.raw.write(data)) { await new Promise(r => reply.raw.once('drain', r)); }`
— with no `'close'`/`'error'`/abort race. A destroyed socket emits `'error'` and
`'close'`, never `'drain'`, so the `for await` loop suspends permanently at a
point independent of the iterator. The disconnect handler
(`chat.routes.ts:407-409`) aborts upstream but nothing resolves the drain
promise, so the `finally` at `:665-668` **never runs** — `clearTimeout(deadline)`
and the `request.raw` listener removal are both skipped. Every client that
disconnects mid-stream against a fast provider leaks a suspended generator, the
upstream socket, the `collectedContent` array, a live 60 s timer, and a
listener. Mobile clients and closed tabs make this routine. *Reasoned from event
semantics, not reproduced against a real stalled socket.*

**R5 — One unhandled rejection kills the gateway, and it exits `0`.**
`main.ts:288-296` shuts down on `uncaughtException` *and* `unhandledRejection`,
and `shutdown()` ends in `process.exit(0)` (`:282`). So (a) a single stray
floating promise anywhere terminates the process and drops every concurrent
stream — that is the answer to "can one bad request take down the server": yes;
and (b) exit 0 reads as an intentional shutdown, so systemd `Restart=on-failure`
won't restart it and the crash is invisible to exit-code alerting.

**R6 — `/healthz` writes to the DB on every probe.** `health-endpoints.ts:27-36`
does INSERT + DELETE against the real `tenants` table — two `.run()` calls, so
per R1 a **full-database serialize and double full-size write per probe**, with
zero traffic. A 10 s k8s probe against a 121 MB DB is ~240 MB of disk I/O and
176 ms of event-loop blocking every 10 seconds, forever. The pair is also not in
a transaction, so a crash between them leaks a permanent `_health_write_check`
tenant row into listings and counts.

**R7 — Mid-stream provider errors are reported to the client as success.**
`chat.routes.ts:603-626`: when a stream errors after bytes have been sent, the
handler writes a clean terminal frame with `finish_reason: 'stop'` and sets
`succeeded = true`. The comment scopes this to free-tier providers emitting a
trailing error frame, but the branch has **no such discriminator** — it catches a
provider dropping at token 5 of 500 identically. The client receives a truncated
response indistinguishable from a complete one. Silent data corruption for any
consumer that trusts `finish_reason`; only a `logger.warn` records it.

### MEDIUM

- **R8 — Horizontal scaling is impossible, and misconfiguration destroys data
  silently.** No `flock`, lockfile, `O_EXCL`, or advisory lock exists anywhere in
  `packages/db/src/client.ts`. Each process loads the full DB into its own WASM
  heap and rewrites the whole file — two processes on one data directory is
  wholesale last-writer-wins destruction, not row-level conflict. The MCP sidecar
  is correctly isolated by default (`sidecar-boot.ts:457`), but an operator
  setting `DMRX_MCP_DATA_DIR` to the gateway's directory — a natural attempt to
  "share state" — gets silent bidirectional destruction with no warning.
- **R9** `client.ts:773-774` — `PRAGMA journal_mode = WAL` is inert on an
  in-memory WASM database, and the comment asserts reader/writer concurrency the
  system does not have. sql.js is fully synchronous; every query blocks the event
  loop. (Same finding as O-side note, confirmed independently.)
- **R10 — The "atomic replace" is not atomic on its fallback path, and there is
  no `fsync`.** `client.ts:107` falls back to `copyFile` after 5 failed renames,
  which truncates and streams — a crash mid-copy leaves a torn primary DB, and on
  Windows this fallback is the *expected* path when antivirus holds a handle. The
  `.lastgood` snapshot (`:165`) is also a plain `copyFile`, and recovery prefers
  `.lastgood` first (`:721-734`) then copies it over the primary (`:728`). In
  encrypted mode AES-GCM catches truncation; **in plaintext mode SQLite may open a
  truncated file as valid-but-partial and the corruption is promoted to primary.**
  No `fsync` anywhere: survives process crash, not power loss.
- **R11 — Pre-migration backups never run in production.** `client.ts:834-835`
  uses `getDbPath()` (`data.db`), but production mandates an encryption key so the
  active file is `data.db.enc` → `ENOENT` → downgraded to a warning at `:848`.
  Even if one existed, recovery scans for basename `data.db.enc` (`:737`), which
  `data.db.pre-migration.*.bak` does not match. Two independent bugs: the
  migration rollback safety net is inert in production.
- **R12 — No global request deadline.** Loops are correctly bounded, but they
  nest: `fetchWithRetry` (3 attempts) inside `executeWithFallback` (N candidates,
  `fallback-executor.ts:441`) inside `executeWithMultiBindingFallback` (M
  bindings, `:590`) — worst case **3 × N × M upstream calls per client request**,
  each with its own 30–120 s timeout. Fastify's `DMRX_REQUEST_TIMEOUT` maps to
  `server.requestTimeout`, which destroys the socket but does **not** abort the
  running handler, so work continues burning provider quota for a departed client.
- **R13** `admin.routes.ts:4634-4649` — admin SSE writes discard the `write()`
  return value, so one wedged dashboard tab causes unbounded buffering in Node's
  socket write queue. Subscriber cleanup and the 1000-event ring buffer are
  correct; only backpressure is missing.
- **R14** `services/router/src/strategies/least-busy.ts:16-23` — `cleanup()`
  deletes counters older than 30 s, and `lastUpdated` only moves on
  increment/decrement. A stream lasting >30 s has its in-flight counter deleted
  **while still active**, so the strategy then routes *more* traffic to the
  busiest provider. Self-limiting but inverts the strategy's intent; 30 s is short
  for LLM streaming.

### Startup ordering — a likely load-balancer misconfiguration

`main.ts:217` runs `runBackgroundInit()` after `listen()` without awaiting, and
that init does network I/O (`server.ts:861` model discovery, `:876` enrichment)
taking tens of seconds. During that window the gateway accepts traffic with zero
adapters. `/ready` correctly returns 503, but `/health` returns `{status:'ok'}`
unconditionally and `/livez` always returns alive — so any balancer pointed at
the conventionally-named `/health` routes traffic into a gateway that cannot
serve it. (CLAUDE.md's autoRegister-before-provider-load ordering *is* respected:
`server.ts:821` precedes `:888`.)

### Verified correct

Meta-model resolution genuinely throws 503 rather than falling back to paid
models (`router.service.ts:326-330`). Upstream timeout and abort plumbing is
careful and correct (`base.adapter.ts:378-396`, `:515`;
`stream-normalizer.ts:87-103`) — R4 is the one gap that bypasses it. No unbounded
retry loops. All 9 `db.transaction()` call sites pass synchronous callbacks, so
the "COMMIT before async work completes" bug does not occur. Router state maps
are bounded with TTL eviction. `/ready` genuinely gates on DB reachability *and*
`getCandidateCount() > 0`.

## Completeness: what compiles but doesn't work

The mechanical hygiene signals are unusually clean — **zero** `@ts-nocheck`,
`@ts-ignore`, `debugger`, `if (false)`, commented-out code blocks, or
`console.log` in `apps/gateway/src` and `apps/ui/src`; only 13 real TODOs; all 99
empty catch blocks carry justifying comments. No fabricated dashboard data:
`Math.random()` appears zero times in `apps/ui/src`, and the billing and alerts
endpoints are genuine SQL.

The problem is **silent semantic fakes** — modules that compile, export cleanly,
and return a canned answer.

**Security-critical:**

- **F1** `services/router/src/guardrails/plugins/moderation-api-guardrail.ts:163-202`
  — `checkAnthropic` and `checkGoogle` return `{ allowed: true, violations: [] }`
  on **every** code path, after burning a real (billed) API call. Only
  `checkOpenAI` is implemented. An operator configuring the Anthropic or Google
  moderation provider has a guardrail that has never blocked anything. Both
  moderation and webhook guardrails also fail open (`:88`,
  `webhook-guardrail.ts:132`).
- **F2** `services/policy/src/rbac.ts:101-118` — a regex "Cedar-like" policy
  parser that silently defaults `principalId`/`actionId` to `'*'` when the regex
  misses. A malformed policy becomes a **wildcard grant**. `isIpInCidr`
  (`:306-316`) is IPv4-only and `1 << (32 - bits)` makes `/0` an exact match
  instead of match-all; IPv6 yields `NaN`.

**Broken but presented as working:**

- **F3** `services/adapters/src/bedrock/bedrock.adapter.ts:64-69` — forges an
  `AWS4-HMAC-SHA256` header with no `SignedHeaders`, no `Signature`, no
  `X-Amz-Date`. AWS rejects 100% of these. Still exported
  (`services/adapters/src/index.ts:20`) and auto-registered when credentials are
  present (`adapter-init.ts:64`), so it shows up as a working provider.
- **F4** `apps/gateway/src/routes/admin.routes.ts:4518-4531` — alert
  acknowledge/resolve return `{ acknowledged: true }` with no storage write. The
  UI marks the row, the next poll un-marks it.
- **F5** `apps/gateway/src/routes/admin.routes.ts:6049-6070,6119-6140` — two
  hardcoded 20-tool `fallbackTools` arrays still served on any fetch failure or
  2s timeout (`:6162-6164`); the real server registers 33. The recent commit
  added an honest `source: 'live' | 'fallback'` tag — worth confirming the UI
  surfaces it.
- **F6** `apps/gateway/src/routes/admin.routes.ts:6620,6666` — legacy MCP
  aggregation/federation endpoints return hardcoded `status: 'disconnected'` /
  `'pending'`. `mcp-admin.routes.ts:13-23` documents that this was the bug it was
  written to replace, yet the old endpoint is still registered **and still
  consumed** by `apps/ui/src/components/domain/mcp/McpAggregationConfig.tsx:17,47,68`.
- **F7** `packages/plugin-loader/src/plugin-loader.ts:147-159` — never reads the
  manifest it finds; returns `{ id: 'unknown', name: 'Unknown Plugin' }` with all
  permissions false. Every plugin loads under the same fake identity.

**Dead exports that look like features** (verified zero callers):
`getClusterScorer` (`services/router/src/router.service.ts:116`),
`FederationRouter.routeRequest`, `ToolDeduplicator`
(`services/tool-search/src/dedup.ts:43` — `getToolVectors` returns empty vectors
so nothing can ever dedupe), `AuditTrailEngine`
(`services/mcp-server/src/audit/audit-logger.ts:91` — the real hash-chained audit
engine, while `server.ts:1380` uses a bare `logger.info`), `handleOAuthRoutes`
(never mounted; auto-approves consent with `userId: 'anonymous'`),
`workflowRoutes` (never registered; its `defaultToolExecutor` fabricates
`success: true` for every step), and `addCostHeaders`
(`apps/gateway/src/middleware/cost-headers.ts:51-54` — costs hardcoded to 0, so
`isFreeTier` is always true). `DMRX_CLUSTER_ROUTING_ENABLED` toggles a scorer
nothing calls.

**Contrast worth noting:** `apps/gateway/src/services/savings.ts` is the opposite
of all this — its header explicitly calls out that the previous query was
"structurally always 0.00 — not an approximation, an identity" and replaces it
with a real counterfactual, returning `basis.method` and a `warning`. That is the
standard the rest of the repo should meet.

**The repo already audited itself.** `docs/REMEDIATION-PLAN.md` (398 lines,
2026-07-30) is `file:line`-cited with P0–P3 triage. Its "Open at handoff" section
(`:340-398`) states **four of six remediation agents were killed mid-edit**, lists
three known type errors, and closes: *"No test run has validated any of this. Do
not trust it until `bun run test` passes on a quiet machine."* P0 items #3
(agent workspace destroyed between tool calls), #4 (MCP file tools path
confinement), and #5 (guardrails bypassed on four MCP tools) were PARTIAL at
handoff with no clear closing commit.

**Also in the working tree:** `ARGUS_ROADMAP.md` and `roadmap.md` belong to a
different product (WiFi/RF sensing, "ARGUS"/"RuView"). Neither mentions the
gateway, routing, or providers.

## Required before shipping

1. Gate the shell and code-execution tools behind explicit RBAC and real
   container isolation (C1).
2. Default `DMRX_GODMODE_AUTOSTART` to false; make the sidecar opt-in (C2).
3. Move godmode lifecycle endpoints under `/v1/admin`, add Zod validation, and
   route `llmBaseUrl` through `validateBaseUrlForSSRF` (C3, C4).
4. Add `redact` to the pino config and a `req` serializer that drops
   `authorization` / `x-api-key` (H1).
5. Make production guards depend on something an operator cannot forget to set,
   rather than `NODE_ENV` (H2).
6. Raise the `fast-uri` override to `^3.1.5` and update `ip-address` / `undici`
   (H3).
7. Fix the `docker-compose.yml` volume path, or delete the file and point every
   doc at `docker-compose.prod.yml` (O1).
8. Make the backup script handle `data.db.enc`, and replace the "create a fresh
   database" branch with a hard fail (O2, O3). Write a key-rotation runbook.
9. Add retention/pruning for `request_logs`, `usage_records`, `messages`, and
   `admin_audit_log` (O5).
10. Wrap migrations in transactions and stop recording partially-applied
    migrations as complete (O6).
11. Drop `continue-on-error` from the lint job and make e2e actually run (O8).
12. Either implement or delete the fake moderation providers (F1) and the Bedrock
    adapter (F3) — shipping them as working options is worse than not shipping
    them. Fix the RBAC wildcard-on-parse-failure default (F2).

13. Move `request_logs` off the whole-file-rewrite path and add retention (R1) —
    this and R8 are architectural. Serving production traffic on sql.js requires
    replacing it (out-of-process SQLite with real WAL, or Postgres), not tuning it.
14. Add the missing `this._size--` in `MemoryCache.get()` and guard `evictLRU()`
    against empty maps (R2) — two lines, prevents a total process freeze.
15. Make `flush()` await the in-flight save instead of early-returning (R3).
16. Guard all 8 `'drain'` awaits on `'close'`/`'error'` (R4).
17. Stop exiting `0` on crash paths, and reconsider shutting down the whole
    process on `unhandledRejection` (R5).
18. Stop writing to the database in the health probe (R6), and stop reporting
    mid-stream failures as `finish_reason: 'stop'` (R7).

**The single highest-value action:** run the documented production path once
end-to-end — `docker-compose.prod.yml` up, write data, run the backup container,
restore from it, apply a migration, restart. O1, O2, O3, O4, and O7 all surface
in that one exercise.
