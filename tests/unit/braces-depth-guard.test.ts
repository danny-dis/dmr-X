import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const fixtures = createRequire(import.meta.url)('../fixtures/braces-3.0.3-compat.json') as Array<{ pattern: string; expand: string[]; compile: string; main: string[] }>;
// Bun's isolated install places the `braces` override under
// node_modules/.bun/braces@file+.+vendored+braces-safe/node_modules/braces/.
// Resolve from there so the test exercises the actual guarded package.
const bunDir = path.resolve(import.meta.dirname, '../../node_modules/.bun');
const resolved = path.join(bunDir, 'braces@file+.+vendored+braces-safe', 'node_modules', 'braces');
const braces = require(resolved);

describe('braces-safe guard', () => {
  it('loads the maintained local guard through the real dependency graph', () => {
    expect(require(path.join(resolved, 'package.json')).name).toBe('@dmr-x/braces-safe');
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
