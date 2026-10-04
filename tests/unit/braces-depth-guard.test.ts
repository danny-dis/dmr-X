import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(new URL('../../apps/ui/package.json', import.meta.url));
const tailwindRoot = dirname(require.resolve('tailwindcss/package.json'));
const fixtures = createRequire(import.meta.url)('../fixtures/braces-3.0.3-compat.json') as Array<{ pattern: string; expand: string[]; compile: string; main: string[] }>;
// Resolve from the actual importing dependency, not an undeclared Tailwind
// import that can find an unused hoisted artifact from an older install.
for (const consumer of ['micromatch', 'chokidar']) {
  const consumerRoot = dirname(require.resolve(`${consumer}/package.json`, { paths: [tailwindRoot] }));
  const resolved = require.resolve('braces', { paths: [consumerRoot] });
  const braces = require(resolved);
  describe(`Tailwind ${consumer} brace dependency safety`, () => {
    it('loads the maintained local guard through the real dependency graph', () => {
      expect(require(resolved.replace(/index\.js$/, 'package.json')).name).toBe('@dmr-x/braces-safe');
    });
    it('rejects adversarial nesting before exhausting the stack', () => {
      expect(() => braces.compile('{'.repeat(4_000) + 'a,b' + '}'.repeat(4_000)))
        .toThrowError(/Brace nesting exceeds the safe maximum/);
    });
    it('rejects cyclic supplied ASTs before exhausting the stack', () => {
      const ast: { type: string; nodes: unknown[] } = { type: 'root', nodes: [] };
      ast.nodes.push(ast);
      expect(() => braces.compile(ast)).toThrowError(/Cyclic brace AST/);
    });
    it.each(fixtures)('preserves upstream behavior for $pattern', (fixture) => {
      expect(braces.expand(fixture.pattern)).toEqual(fixture.expand);
      expect(braces.compile(fixture.pattern)).toEqual(fixture.compile);
      expect(braces(fixture.pattern)).toEqual(fixture.main);
    });
  });
}
