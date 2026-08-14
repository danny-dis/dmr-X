import os from 'node:os';
import path from 'node:path';

/**
 * Resolve the DMR-X data directory.
 *
 * Single source of truth so every service reads/writes the same location when
 * DMRX_DATA_DIR is unset. The single default is `os.homedir()/.dmr-x`,
 * matching packages/db/src/client.ts, so the DB, audit log, and ingest
 * artifacts share one dir when the env var is unset.
 */
export function resolveDataDir(): string {
  return process.env.DMRX_DATA_DIR || path.join(os.homedir(), '.dmr-x');
}

/** Documented default gateway port (.env.example, docs/CONFIGURATION.md). */
export const DEFAULT_GATEWAY_PORT = 3000;

/**
 * Resolve the port the gateway listens on.
 *
 * Single source of truth so companion services agree with `main.ts` on where
 * the gateway actually is when PORT is unset. The sidecar/godmode boot paths
 * previously hardcoded `47113` while `main.ts` defaulted to `3000`, so an
 * unset PORT left godmode's LLM relay pointed at a dead port.
 */
export function resolveGatewayPort(): number {
  const raw = process.env.PORT;
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_GATEWAY_PORT;
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_GATEWAY_PORT;
}

/** Base URL companions should use to reach the gateway. */
export function resolveGatewayUrl(): string {
  return process.env.DMRX_GATEWAY_URL || `http://localhost:${resolveGatewayPort()}`;
}
