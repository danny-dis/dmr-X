import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('persistent GODMODE policy', () => {
  it('enforces strict mode in the PM2 gateway configuration', () => {
    const config = require(path.resolve(__dirname, '../../ecosystem.config.cjs'));
    const gateway = config.apps.find((app: any) => app.name === 'dmrx-gateway');
    expect(gateway.env.DMRX_GODMODE_STRICT).toBe('true');
  });
});
