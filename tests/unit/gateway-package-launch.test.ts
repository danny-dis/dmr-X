import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');
const { apps } = require(path.join(root, 'ecosystem.config.cjs'));

describe('single-owner gateway package launch', () => {
  it('starts the package script from the repository root with explicit env loading', () => {
    const gateway = apps.find((app: { name: string }) => app.name === 'dmrx-gateway');
    expect(gateway.args).toEqual(['--env-file=.env', 'run', 'start']);
    expect(gateway.cwd).toBe(root);
    expect(gateway.interpreter).toBe('none');
    expect(gateway.instances).toBe(1);
    expect(gateway.exec_mode).toBe('fork');
    expect(gateway.watch).toBe(false);
  });

  it('does not give PM2 competing ownership of gateway companions', () => {
    expect(apps.map((app: { name: string }) => app.name)).toEqual([
      'dmrx-gateway', 'dmrx-needle-router',
    ]);
  });
});
