import { createServer } from './server.js';
import { logger } from '@dmr-x/utils';
import { initDb, closeDb } from '@dmr-x/db';
import { memoryService } from '@dmr-x/memory';
import { workersService } from '@dmr-x/workers';
import { federationService } from '@dmr-x/federation';

const MIN_ADMIN_API_KEY_LENGTH = 32;
const DEFAULT_BODY_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;          // 60 s
const DEFAULT_KEEPALIVE_TIMEOUT_MS = 65_000;        // 65 s
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;       // 10 s
const DEFAULT_MAX_PARAM_LENGTH = 200;
const DEFAULT_MEMORY_LIMIT_BYTES = 1_500 * 1024 * 1024; // 1.5 GB

function parseBodyLimit(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  // Accept "10mb", "1024kb", "1gb" — case-insensitive
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(trimmed);
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === 'gb' ? 1024 ** 3
             : unit === 'mb' ? 1024 ** 2
             : unit === 'kb' ? 1024
             : 1;
  return Math.floor(n * mult);
}

function parseTrustProxy(raw: string | undefined): boolean | string {
  if (raw === undefined) return 'loopback';
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  // Allow Fastify-prescribed preset strings
  if (['loopback', 'linklocal', 'uniquelocal'].includes(v)) return v;
  // Treat anything else as a CIDR / IP / comma-separated list
  return raw.trim();
}

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
  if (!Number.isFinite(connTimeout) || connTimeout < 1000 || connTimeout > 300_000) {
    errors.push('DMRX_CONNECTION_TIMEOUT must be between 1000 and 300000 ms');
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

  if (!isProduction) {
    return failIfInvalid(errors);
  }

  const adminApiKey = process.env.DMRX_ADMIN_API_KEY;
  const encryptionKey = process.env.DMRX_ENCRYPTION_KEY;
  const corsOrigin = process.env.DMRX_CORS_ORIGIN;

  if (process.env.DMRX_LOCAL_MODE === 'true') {
    errors.push('DMRX_LOCAL_MODE must be false in production');
  }

  if (
    !adminApiKey?.trim() ||
    adminApiKey === 'replace-with-admin-key' ||
    adminApiKey.trim().length < MIN_ADMIN_API_KEY_LENGTH
  ) {
    errors.push(`DMRX_ADMIN_API_KEY must be set to at least ${MIN_ADMIN_API_KEY_LENGTH} characters in production`);
  }

  if (!encryptionKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    errors.push('DMRX_ENCRYPTION_KEY must be set to 64 hex characters in production');
  }

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

  // Start server
  const { server, runBackgroundInit } = await createServer();

  try {
    await server.listen({ port, host: '0.0.0.0' });
    logger.info({ port }, 'DMR-X Gateway running');
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }

  // Kick off background initialisation (auto-register, model discovery, etc.)
  // This is non-blocking — the server is already listening.
  runBackgroundInit();

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
      memoryService.stop();
      workersService.stop();
      federationService.stop();
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
    process.exit(0);
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
