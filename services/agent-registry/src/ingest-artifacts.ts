import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { logger } from '@dmr-x/utils';

import { agentRegistryService } from './agent-registry.service.js';
import { skillService } from './skill.service.js';
import { parseAgentMdBatch } from './agent-config-loader.js';
import type { AgentDefinitionCreate, AgentImportResult } from './agent-schema.js';
import type { SkillSource } from './skill-schema.js';
import type { BulkImportSkillResult } from './skill.service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IngestSource = 'github' | 'zip' | 'md';

export interface ImportAgentsWithSkillsOptions {
  modelTier?: 'auto' | 'premium' | 'budget';
  category?: string;
  source: IngestSource;
}

export interface ImportAgentsWithSkillsResult {
  agents: AgentImportResult;
  skills: BulkImportSkillResult;
  artifactsDir: string;
  zipPath: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the on-disk data directory, preferring the DMX_DATA_DIR env var
 * and falling back to the same location the DB layer uses.
 */
function getDataDir(): string {
  return process.env.DMRX_DATA_DIR || path.join(os.homedir(), '.dmr-x');
}

/**
 * Turn a repo/zip file path into a safe slug for use as a `.md` filename.
 * Strips any directory separators (defeating path traversal) and keeps only
 * `[A-Za-z0-9._-]`, then drops the extension.
 */
function slugifyFilename(filename: string): string {
  const base = path.basename(filename);
  const sanitized = base.replace(/[^A-Za-z0-9._-]/g, '_');
  const dot = sanitized.lastIndexOf('.');
  const slug = dot > 0 ? sanitized.slice(0, dot) : sanitized;
  return slug || 'pasted';
}

const SOURCE_TO_SKILL: Record<IngestSource, SkillSource> = {
  github: 'github',
  zip: 'zip',
  md: 'md',
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Ingest a set of agent `.md` files for a tenant:
 *   1. Parse them into agent definitions and import via
 *      `agentRegistryService.importAgents` (auto-deploying an instance each).
 *   2. Extract the SAME markdown into the skills store via
 *      `skillService.bulkImportSkills`.
 *   3. Write each file's original markdown to
 *      `<dataDir>/skills-export/<tenantId>/<runId>/<slug>.md`, plus a
 *      `skills-index.json` manifest, then bundle the whole run folder into a
 *      `skills-export.zip`.
 *
 * Failures in the skill pass are tolerated — they are surfaced in
 * `result.skills.errors` — while agent failures surface in `result.agents`.
 */
export async function importAgentsWithSkills(
  tenantId: string,
  files: Map<string, string>,
  opts: ImportAgentsWithSkillsOptions,
): Promise<ImportAgentsWithSkillsResult> {
  // 1. Parse + import agents
  const definitions: AgentDefinitionCreate[] = parseAgentMdBatch(
    files,
    opts.category,
  ).map((a) => a.definition);
  const agents = await agentRegistryService.importAgents(tenantId, definitions, {
    modelTier: opts.modelTier,
  });

  // 2. Build skill items from the SAME files map
  const skillSource = SOURCE_TO_SKILL[opts.source];
  const items = [] as Array<{ markdown: string; source: SkillSource; externalId: string }>;
  for (const [filename, markdown] of files.entries()) {
    items.push({ markdown, source: skillSource, externalId: filename });
  }
  const skills = await skillService.bulkImportSkills(tenantId, items);

  // 3. Write artifacts to disk (never outside the skills-export root)
  const runId = String(Date.now());
  const artifactsDir = path.join(getDataDir(), 'skills-export', tenantId, runId);
  await fsPromises.mkdir(artifactsDir, { recursive: true });

  const index: Array<{ name: string; file: string; source: IngestSource }> = [];
  for (const [filename, markdown] of files.entries()) {
    const slug = slugifyFilename(filename);
    const mdFile = `${slug}.md`;
    await fsPromises.writeFile(path.join(artifactsDir, mdFile), markdown, 'utf-8');
    index.push({ name: slug, file: mdFile, source: opts.source });
  }

  await fsPromises.writeFile(
    path.join(artifactsDir, 'skills-index.json'),
    JSON.stringify(
      {
        tenantId,
        source: opts.source,
        runId,
        generatedAt: new Date().toISOString(),
        files: index,
      },
      null,
      2,
    ),
    'utf-8',
  );

  // 4. Zip the run folder (markdown + manifest) to skills-export.zip
  const zip = new JSZip();
  for (const entry of index) {
    const mdContent = await fsPromises.readFile(path.join(artifactsDir, entry.file));
    zip.file(entry.file, mdContent);
  }
  zip.file('skills-index.json', await fsPromises.readFile(path.join(artifactsDir, 'skills-index.json')));

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const zipPath = path.join(artifactsDir, 'skills-export.zip');
  await fsPromises.writeFile(zipPath, zipBuffer);

  logger.info(
    { tenantId, source: opts.source, runId, artifactsDir, zipPath },
    'Agent import wrote skills + artifacts',
  );

  return { agents, skills, artifactsDir, zipPath };
}
