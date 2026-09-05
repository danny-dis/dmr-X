// Load .env before anything else reads process.env.
// The gateway has no dotenv loader, so env vars from .env (GODMODE_*,
// DMRX_GODMODE_*, provider keys, etc.) never reached the process. This
// inline parser brings them in so the godmode companion boots on startup.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
try {
  const envPath = resolve(process.cwd(), '.env');
  const envFile = readFileSync(envPath, 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {
  // .env missing — ignore, use process.env as-is
}

// sql.js returns BigInt for INTEGER columns. JSON.stringify cannot serialize
// BigInt, which causes 500s with empty bodies when Fastify tries to send the
// response. Patch the prototype before anything else loads.
if (typeof BigInt !== 'undefined' && !(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    return Number(this);
  };
}

import { initDb, closeDb } from '@dmr-x/db';
import { federationService } from '@dmr-x/federation';
import { memoryService } from '@dmr-x/memory';
import { logger, parseBodyLimit, parseTrustProxy } from '@dmr-x/utils';
import { workersService } from '@dmr-x/workers';
import { retentionService } from '@dmr-x/telemetry';

import { createServer } from './server.js';
import { connectPersistedMcpServers } from './routes/mcp-admin.routes.js';

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';

const MIN_ADMIN_API_KEY_LENGTH = 32;
const DEFAULT_BODY_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB
// Timeout defaults must satisfy the ordering enforced in validateStartupConfig:
//   connection >= keepAlive >= request
// `connectionTimeout` is Node's `server.timeout` — a socket-level kill that
// ignores in-flight handlers — so anything below requestTimeout severs live
// agent requests with RemoteDisconnected instead of a clean error. These
// defaults front a 2-turn agent loop at the 120s-per-turn default budget.
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;         // 300 s
const DEFAULT_KEEPALIVE_TIMEOUT_MS = 305_000;       // 305 s
const DEFAULT_CONNECTION_TIMEOUT_MS = 310_000;      // 310 s
const DEFAULT_MAX_PARAM_LENGTH = 200;
const DEFAULT_MEMORY_LIMIT_BYTES = 1_500 * 1024 * 1024; // 1.5 GB

function validateStartupConfig(): void {
  const errors: string[] = [];
  const portValue = process.env.PORT || '3000';
  const port = Number(portValue);
  const isProduction = process.env.NODE_ENV === 'production';

  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT must be an integer between 1 and 65535');
  }

  // Body limit — accept numbers or "10mb" style
  const bodyLimit = parseBodyLimit(process.env.DMRX_BODY_LIMIT, DEFAULT_BODY_LIMIT_BYTES);
  if (bodyLimit < 1024 || bodyLimit > 100 * 1024 * 1024) {
    errors.push('DMRX_BODY_LIMIT must be between 1KB and 100MB');
  }

  // Request timeouts must be positive integers in ms
  const reqTimeout = parseInt(process.env.DMRX_REQUEST_TIMEOUT || String(DEFAULT_REQUEST_TIMEOUT_MS), 10);
  if (!Number.isFinite(reqTimeout) || reqTimeout < 1000 || reqTimeout > 600_000) {
    errors.push('DMRX_REQUEST_TIMEOUT must be between 1000 and 600000 ms');
  }
  const keepAlive = parseInt(process.env.DMRX_KEEPALIVE_TIMEOUT || String(DEFAULT_KEEPALIVE_TIMEOUT_MS), 10);
  if (!Number.isFinite(keepAlive) || keepAlive < 1000 || keepAlive > 600_000) {
    errors.push('DMRX_KEEPALIVE_TIMEOUT must be between 1000 and 600000 ms');
  }
  const connTimeout = parseInt(process.env.DMRX_CONNECTION_TIMEOUT || String(DEFAULT_CONNECTION_TIMEOUT_MS), 10);
  // Cap matches DMRX_REQUEST_TIMEOUT / DMRX_KEEPALIVE_TIMEOUT (600s): this
  // value must be able to sit ABOVE requestTimeout (see the ordering check
  // below), so a lower ceiling here would make a valid long-request config
  // impossible to express.
  if (!Number.isFinite(connTimeout) || connTimeout < 1000 || connTimeout > 600_000) {
    errors.push('DMRX_CONNECTION_TIMEOUT must be between 1000 and 600000 ms');
  }

  // The three timeouts must be ORDERED, not merely in range.
  //
  // `connectionTimeout` maps to Node's `server.timeout`: a SOCKET-level kill
  // that fires on socket inactivity regardless of whether a handler is still
  // legitimately running. A long-poll agent turn produces no bytes until the
  // provider replies, so a connectionTimeout shorter than requestTimeout
  // destroys the socket mid-request. The client sees RemoteDisconnected — not
  // a 503 — so the failure is indistinguishable from a crash, and the tokens
  // are already spent.
  //
  // Measured on the DMR-X agent fleet (24 agents, concurrency 6): with
  // DMRX_CONNECTION_TIMEOUT=60000 and DMRX_REQUEST_TIMEOUT=120000, 7 of 24
  // delegated tasks died in a tight 56.5-60.4s band with RemoteDisconnected.
  // Raising requestTimeout alone did nothing, because the socket layer wins.
  if (Number.isFinite(connTimeout) && Number.isFinite(reqTimeout) && connTimeout < reqTimeout) {
    errors.push(
      `DMRX_CONNECTION_TIMEOUT (${connTimeout}ms) must be >= DMRX_REQUEST_TIMEOUT (${reqTimeout}ms). ` +
      'connectionTimeout is a socket-level timeout and will sever in-flight requests ' +
      'before the request timeout can return a proper error.',
    );
  }
  // keepAlive must sit above requestTimeout so idle-connection reaping never
  // pre-empts a request that is still within its allowed budget.
  if (Number.isFinite(keepAlive) && Number.isFinite(reqTimeout) && keepAlive < reqTimeout) {
    errors.push(
      `DMRX_KEEPALIVE_TIMEOUT (${keepAlive}ms) must be >= DMRX_REQUEST_TIMEOUT (${reqTimeout}ms).`,
    );
  }
  const maxParam = parseInt(process.env.DMRX_MAX_PARAM_LENGTH || String(DEFAULT_MAX_PARAM_LENGTH), 10);
  if (!Number.isFinite(maxParam) || maxParam < 1 || maxParam > 4096) {
    errors.push('DMRX_MAX_PARAM_LENGTH must be between 1 and 4096');
  }

  // Memory limit for /healthz
  const memLimit = parseBodyLimit(process.env.DMRX_MEMORY_LIMIT, DEFAULT_MEMORY_LIMIT_BYTES);
  if (memLimit < 64 * 1024 * 1024 || memLimit > 16 * 1024 ** 3) {
    errors.push('DMRX_MEMORY_LIMIT must be between 64MB and 16GB');
  }

  // Compression threshold — accepts a byte count. 0 disables compression
  // entirely; values below 1024 are clamped up to 1024 to avoid CPU cost
  // on tiny JSON envelopes. SSE streams are skipped regardless.
  const compressThreshold = parseInt(process.env.DMRX_COMPRESS_THRESHOLD || '1024', 10);
  if (!Number.isFinite(compressThreshold) || compressThreshold < 0 || compressThreshold > 1024 * 1024) {
    errors.push('DMRX_COMPRESS_THRESHOLD must be between 0 (off) and 1048576');
  }

  // Verify DMRX_TRUST_PROXY parses
  parseTrustProxy(process.env.DMRX_TRUST_PROXY);

  // CRIT-2: Validate DMRX_LOCAL_MODE unconditionally. The previous
  // implementation only checked this inside the `if (isProduction)`
  // branch, so a missing or misconfigured NODE_ENV (e.g. unset, or set
  // to "staging" in a prod-like deploy) would silently boot the gateway
  // with authentication disabled. We now compute the policy up-front
  // and treat the prod + local-mode combination as a fatal startup
  // error — unless the operator explicitly opts in via
  // DMRX_ALLOW_LOCAL_MODE=true (used by tests / CI).
  const localModeRequested = process.env.DMRX_LOCAL_MODE === 'true';
  const localModeOptIn = process.env.DMRX_ALLOW_LOCAL_MODE === 'true';
  if (localModeRequested && isProduction && !localModeOptIn) {
    errors.push(
      'DMRX_LOCAL_MODE=true is not permitted in production. ' +
      'Unset it, or set DMRX_ALLOW_LOCAL_MODE=true (tests/CI only).',
    );
  }

  if (!isProduction) {
    return failIfInvalid(errors);
  }

  const adminApiKey = process.env.DMRX_ADMIN_API_KEY;
  const encryptionKey = process.env.DMRX_ENCRYPTION_KEY;

  if (
    !adminApiKey?.trim() ||
    adminApiKey === 'replace-with-admin-key' ||
    adminApiKey.trim().length < MIN_ADMIN_API_KEY_LENGTH
  ) {
    errors.push(`DMRX_ADMIN_API_KEY must be at least ${MIN_ADMIN_API_KEY_LENGTH} characters in production. Generate a strong key: openssl rand -hex 32`);
  }

  if (!encryptionKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    errors.push('DMRX_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes) in production for AES-256-GCM encryption. Generate with: openssl rand -hex 32');
  }
}

function validateProductionConfig(): void {
  const errors: string[] = [];

  const corsOrigin = process.env.DMRX_CORS_ORIGIN;

  // H2 — CORS must NEVER accept a wildcard/empty origin, even when NODE_ENV
  // is not 'production'. The audit found the old gate let non-production boots
  // (dev, staging, unset) accept DMRX_CORS_ORIGIN=*, which in a real deploy
  // opens the API to any browser origin. Validate unconditionally.
  if (!corsOrigin || corsOrigin.split(',').some(origin => {
    const value = origin.trim();
    return value.length === 0 || value === '*';
  })) {
    errors.push('DMRX_CORS_ORIGIN must be set to explicit origins in production');
  }

  failIfInvalid(errors);
}

function failIfInvalid(errors: string[]): void {
  if (errors.length === 0) return;

  for (const error of errors) {
    logger.error({ configError: error }, 'Invalid gateway startup configuration');
  }
  process.exit(1);
}

async function main(): Promise<void> {
  validateStartupConfig();
  validateProductionConfig();
  const port = parseInt(process.env.PORT || '3000', 10);

  // Initialize SQLite database (async — loads WASM, runs migrations)
  try {
    await initDb();
    logger.info('SQLite database ready');
  } catch (err) {
    logger.error({ err }, 'Failed to initialize database');
    process.exit(1);
  }

  // Start platform services
  memoryService.start();
  workersService.start();
  federationService.start();
  logger.info('Platform services started');

  // O5 — start data retention service to prune unbounded tables
  retentionService.start();

  // Start server
  const { server, runBackgroundInit } = await createServer();

  // Compliance layer: Mutual TLS (mTLS) server bootstrap.
  // If both a server certificate and key are provided, terminate TLS at the
  // gateway by passing an https.Server into Fastify's listen(). An optional CA
  // bundle enables client-certificate verification: when DMRX_TLS_CA is set we
  // request a client cert; rejectUnauthorized is gated on DMRX_TLS_REQUIRE_CLIENT_CERT
  // so an operator can log/observe client certs before enforcing them.
  // When TLS env is absent the gateway behaves exactly as before (plain http).
  let listenOptions: { port: number; host: string; server?: HttpServer | HttpsServer } = {
    port,
    host: '0.0.0.0',
  };
  const tlsCert = process.env.DMRX_TLS_CERT;
  const tlsKey = process.env.DMRX_TLS_KEY;
  if (tlsCert && tlsKey) {
    const tlsOptions: https.ServerOptions = {
      cert: fs.readFileSync(tlsCert),
      key: fs.readFileSync(tlsKey),
    };
    const tlsCa = process.env.DMRX_TLS_CA;
    if (tlsCa) {
      tlsOptions.ca = fs.readFileSync(tlsCa);
      tlsOptions.requestCert = true;
      // When false, a missing/invalid client cert is NOT rejected — useful for
      // rolling out mTLS in observe-mode before enforcing it.
      tlsOptions.rejectUnauthorized = !!process.env.DMRX_TLS_REQUIRE_CLIENT_CERT;
    }
    const httpsServer = https.createServer(tlsOptions, server.server as any);
    listenOptions = { port, host: '0.0.0.0', server: httpsServer };
    logger.info(
      { ca: !!tlsCa, requireClientCert: !!process.env.DMRX_TLS_REQUIRE_CLIENT_CERT },
      'Starting DMR-X Gateway with mutual TLS (HTTPS)',
    );
  } else {
    logger.info('Starting DMR-X Gateway (plain HTTP)');
  }

  // Reap companions stranded by a previous hard kill BEFORE binding. They can
  // still hold this port via an inherited socket handle, which would otherwise
  // make listen() fail on every restart until someone intervenes by hand.
  try {
    const { reapStaleCompanions } = await import('./lib/sidecar-boot.js');
    await reapStaleCompanions();
  } catch (err) {
    logger.warn({ err }, 'Stale companion reap skipped');
  }

  // Retry listen() up to 3 times with a 2s delay between attempts. The reap
  // above waits for the OS to release the socket, but under heavy load the
  // kernel can take longer — without a retry, a single slow release kills the
  // boot. Each retry re-checks port ownership so we only bind when it's safe.
  let listenAttempts = 0;
  const maxListenAttempts = 3;
  while (true) {
    try {
      await server.listen(listenOptions);
      logger.info({ port }, 'DMR-X Gateway running');
      break;
    } catch (err) {
      listenAttempts++;
      if (listenAttempts >= maxListenAttempts) {
        logger.error({ err, attempts: listenAttempts }, 'Failed to start server after retries');
        process.exit(1);
      }
      logger.warn(
        { err, attempt: listenAttempts, max: maxListenAttempts },
        'listen() failed — reaping stale companions and retrying',
      );
      // One more reap attempt in case a new zombie appeared
      try {
        const { reapStaleCompanions } = await import('./lib/sidecar-boot.js');
        await reapStaleCompanions();
      } catch {
        /* best-effort */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Kick off background initialisation first, before deferred companion boots.
  runBackgroundInit();

  // Deferred companion boots (MCP+A2A, G0DM0D3): after listen so they never
  // block /health. Gated by DMRX_MCP_AUTOSTART / DMRX_GODMODE_AUTOSTART
  // (both default true). Skip-if-healthy so an external supervisor can own them.
  const { startCompanionServices, stopMcpSidecar, stopGodmode } = await import('./lib/sidecar-boot.js');
  startCompanionServices();

  // Dial out to persisted upstream MCP servers. Deliberately after listen and
  // not awaited: a stdio server spawns a child process and an SSE one may be
  // unreachable, and neither should delay the port opening. Individual
  // failures are logged inside and leave the entry as 'disconnected' in
  // GET /admin/mcp/servers, which is what the UI renders a retry against.
  void connectPersistedMcpServers().catch((err) => {
    logger.error({ err }, 'Failed to connect persisted MCP servers');
  });

  // Graceful shutdown with 30-second timeout
  const SHUTDOWN_TIMEOUT_MS = 30_000;
  let shuttingDown = false;

  const shutdown = async (signal?: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down...');

    const forceExitTimer = setTimeout(() => {
      logger.error('Shutdown timed out after 30s, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    try {
      stopMcpSidecar();
    } catch (err) {
      logger.error({ err }, 'Error stopping MCP sidecar');
    }

    // Tear down G0DM0D3 too, otherwise its process tree outlives every restart
    // and keeps port 47115 held by a process nothing supervises.
    try {
      await stopGodmode();
    } catch (err) {
      logger.error({ err }, 'Error stopping G0DM0D3');
    }

    try {
      memoryService.stop();
      workersService.stop();
      federationService.stop();
      retentionService.stop();
    } catch (err) {
      logger.error({ err }, 'Error stopping platform services');
    }

    try {
      await server.close();
    } catch (err) {
      logger.error({ err }, 'Error during server.close()');
    }
    try {
      await closeDb();
    } catch (err) {
      logger.error({ err }, 'Error during closeDb()');
    }
    logger.info('Shutdown complete');
    process.exit(1);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
    shutdown('unhandledRejection');
  });
}

main();
