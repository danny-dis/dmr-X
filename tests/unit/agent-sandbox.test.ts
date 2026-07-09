import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { safePath, cleanupSandboxDir } from '../../apps/gateway/src/routes/tools.routes.js';

// CODING_SANDBOX_ROOT is captured at module load time into a const, so the
// gateway uses its default root. We assert against that known default.
const ROOT = join(tmpdir(), 'dmrx-coding');

const TENANT = 'test-tenant';
const REQ = 'req-123'; // deterministic so we can assert exact dir layout

afterEach(() => {
  // best-effort cleanup so repeated runs don't leak dirs
  cleanupSandboxDir(TENANT, REQ);
});

describe('safePath() sandbox isolation', () => {
  it('blocks path traversal with ".."', () => {
    expect(() => safePath('../../etc/passwd', TENANT, REQ)).toThrow(/outside workspace|Path outside workspace/i);
  });

  it('blocks absolute paths that escape the sandbox', () => {
    expect(() => safePath('/etc/passwd', TENANT, REQ)).toThrow(/outside workspace|Path outside workspace/i);
  });

  it('blocks null bytes', () => {
    expect(() => safePath('foo\0bar.txt', TENANT, REQ)).toThrow(/invalid characters/i);
  });

  it('resolves a relative sub-path INSIDE the per-(tenant,request) sandbox dir', () => {
    const resolved = safePath('sub/file.txt', TENANT, REQ);
    expect(resolved).toContain(ROOT);
    expect(resolved).toContain(TENANT);
    expect(resolved).toContain(REQ);
    expect(resolved).toContain(join('sub', 'file.txt'));
    // must NOT contain a traversal escape segment
    expect(resolved).not.toContain('..');
  });

  it('resolves even when parent sub-dirs do not yet exist (write_file case)', () => {
    const resolved = safePath('a/b/c/out.json', TENANT, REQ);
    expect(resolved.startsWith(join(ROOT, TENANT, REQ))).toBe(true);
  });

  it('round-trips with a real file created at the safe path', () => {
    const resolved = safePath('nested/report.md', TENANT, REQ);
    mkdirSync(join(ROOT, TENANT, REQ, 'nested'), { recursive: true });
    writeFileSync(resolved, '# hello');
    expect(existsSync(resolved)).toBe(true);
  });

  it('never resolves a path outside the root, even via symlink-like names', () => {
    // any ".." at any position must be rejected, not silently joined
    expect(() => safePath('sub/../../etc/passwd', TENANT, REQ)).toThrow();
  });
});

describe('cleanupSandboxDir()', () => {
  it('removes the per-(tenant,request) sandbox directory', () => {
    const dir = join(ROOT, TENANT, REQ);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'keep.txt'), 'data');
    expect(existsSync(dir)).toBe(true);

    cleanupSandboxDir(TENANT, REQ);

    expect(existsSync(dir)).toBe(false);
  });

  it('is a no-throw no-op for a non-existent sandbox', () => {
    // Should not throw even though the dir was never created.
    expect(() => cleanupSandboxDir('ghost-tenant', 'ghost-req')).not.toThrow();
  });
});
