import { describe, expect, it } from 'vitest';
import configuration from '../../vitest.config.ts';

describe('resource-bounded Vitest configuration', () => {
  it('uses supported Vitest 5 settings to bound worker count and heap', () => {
    expect(configuration.test?.maxWorkers).toBe(1);
    expect(configuration.test?.execArgv).toEqual(['--max-old-space-size=2048']);
    expect(configuration.test).not.toHaveProperty('poolOptions');
  });

  it('does not silently rely on removed per-project poolOptions', () => {
    const projects = configuration.test?.projects ?? [];
    for (const project of projects) {
      if (typeof project === 'object' && project !== null && 'test' in project) {
        expect(project.test).not.toHaveProperty('poolOptions');
      }
    }
  });
});
