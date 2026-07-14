import os from 'node:os';
import path from 'node:path';

/**
 * Resolve the DMR-X data directory.
 *
 * Single source of truth so every service reads/writes the same location when
 * DMRX_DATA_DIR is unset. Previously the audit trail defaulted to
 * `os.tmpdir()/dmrx-data` while ingest artifacts defaulted to
 * `os.homedir()/.dmr-x` — two different dirs for the same env var.
 */
export function resolveDataDir(): string {
  return process.env.DMRX_DATA_DIR || path.join(os.homedir(), '.dmr-x', 'data');
}
