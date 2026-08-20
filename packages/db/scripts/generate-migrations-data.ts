#!/usr/bin/env bun
/**
 * Auto-generates migrations-data.ts from the SQL migration files.
 *
 * This ensures the embedded migrations (used by compiled binaries) stay in sync
 * with the on-disk SQL files. Run after adding or modifying any migration:
 *
 *   bun run packages/db/scripts/generate-migrations-data.ts
 *
 * Or add to your workflow:
 *   bun run db:generate-migrations
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, basename } from 'path';

// Bun provides import.meta.dir; cast for TypeScript
const scriptDir = (import.meta as { dir?: string }).dir ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = join(scriptDir, '..', 'src', 'migrations');
const OUTPUT_FILE = join(scriptDir, '..', 'src', 'migrations-data.ts');

// Read all .sql files and parse version numbers
const files = readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

const migrations: Array<{ version: number; filename: string; sql: string }> = [];

for (const file of files) {
  const match = basename(file).match(/^(\d+)_/);
  if (!match) continue;

  const version = parseInt(match[1], 10);
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
  migrations.push({ version, filename: file, sql });
}

// Sort by version
migrations.sort((a, b) => a.version - b.version);

// Generate TypeScript output
const lines: string[] = [
  `// Auto-generated from packages/db/src/migrations/*.sql`,
  `// DO NOT EDIT MANUALLY — run: bun run packages/db/scripts/generate-migrations-data.ts`,
  ``,
  `export const MIGRATIONS: Record<number, { filename: string; sql: string }> = {`,
];

for (const mig of migrations) {
  // Escape backticks and `${` in SQL before embedding into a template
  // literal: backticks would terminate the literal, and an unescaped `${`
  // would be interpolated as JS (migration 071 embeds `${providerId}:${modelId}`
  // in a comment, which previously broke compilation of the generated file).
  const escapedSql = mig.sql.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  lines.push(`  ${mig.version}: {`);
  lines.push(`    filename: '${mig.filename}',`);
  lines.push(`    sql: \`${escapedSql}\`,`);
  lines.push(`  },`);
}

lines.push(`};`);
lines.push(``);

writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf-8');

console.log(`Generated ${OUTPUT_FILE} with ${migrations.length} migrations (versions ${migrations[0]?.version}–${migrations[migrations.length - 1]?.version})`);
