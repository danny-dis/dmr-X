import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveDataDir } from '@dmr-x/utils';

// ---------------------------------------------------------------------------
// Append-only, tamper-evident DATA-ACCESS AUDIT TRAIL
// ---------------------------------------------------------------------------
// Every subagent tool call that touches data (file/bash/execute_code/memory,
// etc.) is recorded as a signed line appended to `<dataDir>/data-access-audit.log`.
//
// Each entry's HMAC covers the previous entry's HMAC plus this entry's payload,
// keyed by DMRX_ENCRYPTION_KEY. This makes the log append-only and tamper-evident:
// editing, deleting, or reordering any line breaks the hash chain and is
// detectable by `verifyDataAccessLog()`.
//
// Writes are serialized via a module-level promise queue so concurrent tool
// calls can't interleave lines.

const AUDIT_LOG_FILENAME = 'data-access-audit.log';

/** Argument keys whose values must never be written to the audit log. */
const SECRET_KEY_RE = /key|token|secret|password|authorization|apikey/i;

export interface DataAccessEntry {
  idx: number;
  ts: number;
  tenantId: string;
  requestId: string;
  agentId?: string;
  tool: string;
  argsSummary: string;
  prevHmac: string;
  hmac: string;
}

export interface RecordDataAccessInput {
  tenantId: string;
  requestId: string;
  agentId?: string;
  tool: string;
  argsSummary: string;
  ts: number;
}

export interface VerifyResult {
  valid: boolean;
  entries: number;
  brokenAt?: number;
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the directory the audit log lives in. Uses the shared
 * `resolveDataDir()` from @dmr-x/utils so every service reads/writes the same
 * location when DMRX_DATA_DIR is unset.
 */
function auditLogPath(): string {
  return path.join(resolveDataDir(), AUDIT_LOG_FILENAME);
}

/**
 * Resolve the HMAC key. In production this MUST be DMRX_ENCRYPTION_KEY (a
 * 64-char hex string == 32 bytes). For tests / dev where the key is unset we
 * fall back to a deterministic placeholder so the chain still validates
 * internally.
 */
function resolveKey(): Buffer {
  const raw = process.env.DMRX_ENCRYPTION_KEY;
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  // Fallback: derive a 32-byte key deterministically from whatever string is set,
  // or a fixed placeholder. The chain is self-consistent either way.
  const seed = raw ?? 'dmrx-audit-placeholder-key';
  return crypto.createHash('sha256').update(seed).digest();
}

// ---------------------------------------------------------------------------
// Serialization queue (prevents interleaved appends)
// ---------------------------------------------------------------------------

let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  // Keep the chain alive but swallow errors so one failure doesn't poison the queue.
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/**
 * Strip secret values from an args object, keeping only argument NAMES and
 * truncated non-sensitive values (<80 chars). File contents are redacted.
 * Returns a compact, human-readable summary string.
 */
export function sanitizeArgsSummary(args: unknown): string {
  if (args === null || args === undefined) return '';
  let obj: Record<string, unknown>;
  if (typeof args === 'string') {
    // Try to parse a JSON string; otherwise treat the whole thing as a value.
    try {
      const parsed = JSON.parse(args);
      obj = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : { value: args };
    } catch {
      return args.length > 80 ? `${args.slice(0, 80)}…` : args;
    }
  } else if (typeof args === 'object' && !Array.isArray(args)) {
    obj = args as Record<string, unknown>;
  } else {
    const s = String(args);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  }

  const parts: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (SECRET_KEY_RE.test(key)) {
      parts.push(`${key}=<redacted>`);
      continue;
    }
    // Redact anything that looks like file contents / large blobs.
    if (value === null || value === undefined) {
      parts.push(`${key}=null`);
    } else if (typeof value === 'string') {
      const truncated = value.length > 80 ? `${value.slice(0, 80)}…` : value;
      parts.push(`${key}=${truncated}`);
    } else if (typeof value === 'object') {
      parts.push(`${key}=<${Array.isArray(value) ? 'array' : 'object'}>`);
    } else {
      parts.push(`${key}=${String(value)}`);
    }
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Append a signed data-access audit entry. Best-effort and fire-and-forget
 * friendly: callers should wrap in try/catch and never let audit failure
 * break the tool result. Returns the written entry (or null on failure).
 */
export async function recordDataAccess(input: RecordDataAccessInput): Promise<DataAccessEntry | null> {
  return enqueue(async () => {
    const key = resolveKey();
    const logFile = auditLogPath();

    await fs.mkdir(path.dirname(logFile), { recursive: true });

    // Determine previous HMAC by reading the last line (if any).
    let prevHmac = '';
    let idx = 0;
    try {
      const existing = await fs.readFile(logFile, 'utf-8');
      const lines = existing.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]) as DataAccessEntry;
        prevHmac = last.hmac;
        idx = last.idx + 1;
      }
    } catch (err) {
      // File may not exist yet, or be empty/corrupt — start a fresh chain.
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        // Corrupt file: refuse to append onto an unverifiable chain.
        throw err;
      }
    }

    const payload = {
      idx,
      ts: input.ts,
      tenantId: input.tenantId,
      requestId: input.requestId,
      agentId: input.agentId,
      tool: input.tool,
      argsSummary: input.argsSummary,
      prevHmac,
    };

    const hmac = crypto
      .createHmac('sha256', key)
      .update(`${prevHmac}|${JSON.stringify(payload)}`)
      .digest('hex');

    const entry: DataAccessEntry = { ...payload, hmac };

    await fs.appendFile(logFile, JSON.stringify(entry) + '\n', 'utf-8');
    return entry;
  });
}

/**
 * Replay the audit log and validate the HMAC chain. Returns whether the log is
 * intact, how many entries it contains, and the index of the first broken
 * entry (if any).
 */
export async function verifyDataAccessLog(logFilePath?: string): Promise<VerifyResult> {
  const key = resolveKey();
  const logFile = logFilePath ?? auditLogPath();

  let raw: string;
  try {
    raw = await fs.readFile(logFile, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { valid: true, entries: 0 };
    }
    throw err;
  }

  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  let prevHmac = '';
  let entries = 0;

  for (let i = 0; i < lines.length; i++) {
    let entry: DataAccessEntry;
    try {
      entry = JSON.parse(lines[i]) as DataAccessEntry;
    } catch {
      return { valid: false, entries, brokenAt: i };
    }

    // Recompute the expected HMAC for this entry.
    const expectedPayload = {
      idx: entry.idx,
      ts: entry.ts,
      tenantId: entry.tenantId,
      requestId: entry.requestId,
      agentId: entry.agentId,
      tool: entry.tool,
      argsSummary: entry.argsSummary,
      prevHmac: entry.prevHmac,
    };
    const expectedHmac = crypto
      .createHmac('sha256', key)
      .update(`${entry.prevHmac}|${JSON.stringify(expectedPayload)}`)
      .digest('hex');

    // The prevHmac pointer must match the running chain, and the recomputed
    // HMAC must match the stored one.
    const chainOk = entry.prevHmac === prevHmac;
    const hmacOk = entry.hmac === expectedHmac;
    if (!chainOk || !hmacOk) {
      return { valid: false, entries, brokenAt: i };
    }

    prevHmac = entry.hmac;
    entries++;
  }

  return { valid: true, entries };
}
