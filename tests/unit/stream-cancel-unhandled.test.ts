import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, it } from 'vitest';

it('does not emit an unhandled rejection when cancelling a locked SSE iterator under Bun', () => {
  const bun = process.env.DMRX_BUN_PATH || (process.platform === 'win32'
    ? path.join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe') : 'bun');
  const root = path.resolve(import.meta.dirname, '../..');
  const result = spawnSync(bun, ['tests/fixtures/stream-cancel-repro.ts'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr + result.stdout).toBe(0);
  expect(result.stdout).toContain('"unhandled":0');
});
