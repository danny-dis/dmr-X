import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  recordDataAccess,
  verifyDataAccessLog,
  sanitizeArgsSummary,
} from '@dmr-x/agent-runtime';

describe('data-access audit ledger (option 4)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dmrx-audit-'));
    process.env.DMRX_DATA_DIR = dir;
    process.env.DMRX_ENCRYPTION_KEY = 'b'.repeat(64);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.DMRX_DATA_DIR;
    delete process.env.DMRX_ENCRYPTION_KEY;
  });

  it('chains entries and verifies intact', async () => {
    await recordDataAccess({
      tenantId: 't1',
      requestId: 'r1',
      tool: 'read_file',
      argsSummary: 'path=/etc/x',
      ts: Date.now(),
    });
    await recordDataAccess({
      tenantId: 't1',
      requestId: 'r2',
      tool: 'bash',
      argsSummary: 'cmd=ls',
      ts: Date.now(),
    });

    const res = await verifyDataAccessLog();
    expect(res.valid).toBe(true);
    expect(res.entries).toBe(2);
  });

  it('detects tampering with the middle entry', async () => {
    await recordDataAccess({ tenantId: 't1', requestId: 'r1', tool: 'a', argsSummary: 'x', ts: 1 });
    await recordDataAccess({ tenantId: 't1', requestId: 'r2', tool: 'b', argsSummary: 'y', ts: 2 });
    await recordDataAccess({ tenantId: 't1', requestId: 'r3', tool: 'c', argsSummary: 'z', ts: 3 });

    const logPath = join(dir, 'data-access-audit.log');
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
    // Tamper with the middle line's tool name.
    const mid = JSON.parse(lines[1]);
    mid.tool = 'EVIL';
    lines[1] = JSON.stringify(mid);
    writeFileSync(logPath, lines.join('\n') + '\n');

    const res = await verifyDataAccessLog();
    expect(res.valid).toBe(false);
    expect(res.brokenAt).toBe(1);
  });

  it('sanitizes secret values', () => {
    const s = sanitizeArgsSummary({ apiKey: 'sk-123456', path: '/tmp/x', n: 3 });
    expect(s).toContain('apiKey=<redacted>');
    expect(s).toContain('path=/tmp/x');
    expect(s).not.toContain('sk-123456');
  });
});
