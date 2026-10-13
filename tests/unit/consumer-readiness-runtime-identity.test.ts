import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('records the actual test worker runtime instead of inferring it from the launcher', () => {
  const metadata = {
    execPath: process.execPath,
    node: process.versions.node,
    bun: process.versions.bun ?? null,
    nativeBun: typeof process.versions.bun === 'string',
  };
  console.error('[dmrx-readiness-runner]', JSON.stringify(metadata));
  writeFileSync(resolve(__dirname, '../../reports/consumer-readiness-test-runtime.json'), JSON.stringify(metadata, null, 2));
  expect(metadata.execPath).toBeTruthy();
});
