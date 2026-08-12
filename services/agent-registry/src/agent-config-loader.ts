import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { logger } from '@dmr-x/utils';

import type { AgentDefinitionCreate } from './agent-schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentConfigFile {
  /** Path to the config file that was loaded */
  filePath: string;
  /** Parsed agent definition ready for creation */
  definition: AgentDefinitionCreate;
}

// ---------------------------------------------------------------------------
// YAML-like config parser (simple key: value format)
// ---------------------------------------------------------------------------

function parseSimpleConfig(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');
  let currentKey = '';
  let currentValue = '';
  let inMultiline = false;

  for (const line of lines) {
    if (inMultiline) {
      if (line.trim() === '"""' || line.trim() === "'''") {
        result[currentKey] = currentValue.trim();
        inMultiline = false;
        currentValue = '';
      } else {
        currentValue += (currentValue ? '\n' : '') + line;
      }
      continue;
    }

    const match = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (match) {
      if (currentKey && currentValue) {
        result[currentKey] = currentValue.trim();
      }
      currentKey = match[1];
      const val = match[2].trim();
      if (val === '"""' || val === "'''") {
        inMultiline = true;
        currentValue = '';
      } else if (val.startsWith('[') && val.endsWith(']')) {
        // Array: [item1, item2, item3]
        try {
          result[currentKey] = JSON.parse(val);
        } catch {
          result[currentKey] = val.slice(1, -1).split(',').map((s) => s.trim());
        }
      } else if (val === 'true') {
        result[currentKey] = true;
      } else if (val === 'false') {
        result[currentKey] = false;
      } else if (/^\d+$/.test(val)) {
        result[currentKey] = parseInt(val, 10);
      } else {
        currentValue = val;
      }
    } else if (currentKey && !inMultiline) {
      // Continuation line
      currentValue += ' ' + line.trim();
    }
  }

  if (currentKey && currentValue && !inMultiline) {
    result[currentKey] = currentValue.trim();
  }

  return result;
}

// ---------------------------------------------------------------------------
// Config file parsing
// ---------------------------------------------------------------------------

/**
 * Load an agent definition from a config file.
 * Supports:
 * - .json files (JSON format)
 * - .agent files (YAML-like simple key: value format)
 * - AGENTS.md files (markdown with YAML frontmatter)
 */
export function loadAgentFromConfig(filePath: string): AgentConfigFile | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();

    let config: Record<string, unknown>;

    if (ext === '.json') {
      config = JSON.parse(content);
    } else if (ext === '.agent') {
      config = parseSimpleConfig(content);
    } else if (ext === '.md' || ext === '.agents.md') {
      // Try to parse YAML frontmatter between --- markers
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        config = parseSimpleConfig(frontmatterMatch[1]);
      } else {
        logger.warn({ filePath }, 'AGENTS.md has no YAML frontmatter, skipping');
        return null;
      }
    } else {
      logger.warn({ filePath, ext }, 'Unknown agent config format, skipping');
      return null;
    }

    // Validate required fields
    if (!config.name || typeof config.name !== 'string') {
      logger.warn({ filePath }, 'Agent config missing required "name" field');
      return null;
    }

    const definition: AgentDefinitionCreate = {
      name: config.name as string,
      description: (config.description as string) ?? undefined,
      version: (config.version as string) ?? '1.0.0',
      systemPrompt: (config.systemPrompt ?? config.system_prompt ?? config.prompt) as string | undefined,
      personality: config.personality as string | undefined,
      preferredModel: (config.preferredModel ?? config.preferred_model ?? config.model) as string | undefined,
      modelTier: (config.modelTier ?? config.model_tier ?? config.tier ?? 'auto') as 'auto' | 'premium' | 'budget',
      allowedTools: (config.allowedTools ?? config.allowed_tools ?? config.tools ?? []) as string[],
      customTools: (config.customTools ?? config.custom_tools ?? []) as AgentDefinitionCreate['customTools'],
      triggers: (config.triggers ?? []) as AgentDefinitionCreate['triggers'],
      visibility: (config.visibility ?? 'private') as 'private' | 'team' | 'public',
      tags: (config.tags ?? []) as string[],
      category: config.category as string | undefined,
      icon: config.icon as string | undefined,
      skills: (config.skills ?? []) as string[],
      skillNudgeInterval: (config.skillNudgeInterval ?? 8) as number,
      verifyOnStop: (config.verifyOnStop ?? false) as boolean,
      planMode: (config.planMode ?? false) as boolean,
      historyCompaction: (config.historyCompaction ?? false) as boolean,
      godmodeWrap: (config.godmodeWrap ?? false) as boolean,
    };

    return { filePath, definition };
  } catch (error) {
    logger.error({ filePath, error }, 'Failed to load agent config');
    return null;
  }
}

/**
 * Load all agent definitions from a directory.
 * Looks for .json, .agent, and .md files.
 */
export function loadAgentsFromDirectory(dirPath: string): AgentConfigFile[] {
  const agents: AgentConfigFile[] = [];

  try {
    if (!fs.existsSync(dirPath)) return agents;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.json', '.agent', '.md'].includes(ext)) {
          const agent = loadAgentFromConfig(path.join(dirPath, entry.name));
          if (agent) agents.push(agent);
        }
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        // Recurse into subdirectories
        agents.push(...loadAgentsFromDirectory(path.join(dirPath, entry.name)));
      }
    }
  } catch (error) {
    logger.error({ dirPath, error }, 'Failed to read agent directory');
  }

  return agents;
}

// ---------------------------------------------------------------------------
// Markdown agent parsing (from string content, not just the filesystem)
// ---------------------------------------------------------------------------

/**
 * Map of repo folder names (division directories) to DMR-X categories.
 * Fallback: capitalize and de-delimit the folder name.
 */
const FOLDER_TO_CATEGORY: Record<string, string> = {
  academic: 'Academic',
  design: 'Design',
  engineering: 'Engineering',
  finance: 'Finance',
  'game-development': 'Game Development',
  'game_development': 'Game Development',
  gis: 'GIS',
  healthcare: 'Healthcare',
  marketing: 'Marketing',
  'paid-media': 'Paid Media',
  'paid_media': 'Paid Media',
  product: 'Product',
  'project-management': 'Project Management',
  'project_management': 'Project Management',
  operations: 'Operations',
  research: 'Research',
  sales: 'Sales',
  security: 'Security',
  'spatial-computing': 'Spatial Computing',
  'spatial_computing': 'Spatial Computing',
  specialized: 'Specialized',
  support: 'Support',
  testing: 'Testing',
};

function folderToCategory(folder: string): string | undefined {
  const key = folder.toLowerCase().replace(/\\/g, '/');
  if (FOLDER_TO_CATEGORY[key]) return FOLDER_TO_CATEGORY[key];
  if (FOLDER_TO_CATEGORY[key.replace(/_/g, '-')]) return FOLDER_TO_CATEGORY[key.replace(/_/g, '-')];
  // Generic fallback: capitalize words, replace separators with spaces
  const pretty = folder
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return pretty || undefined;
}

export interface ParseAgentMdOptions {
  /** Original file path (used for category derivation + error reporting). */
  filePath?: string;
  /** Override the auto-detected category. */
  categoryOverride?: string;
}

/**
 * Parse a single agent definition from Markdown string content.
 *
 * Expected format (any agent/skill .md with YAML frontmatter):
 *   ---
 *   name: My Agent
 *   description: ...
 *   emoji: 🤖
 *   ---
 *   <system prompt body>
 *
 * The body after the frontmatter becomes the `systemPrompt`. The file path
 * (when provided) is used to derive a category from its parent folder.
 *
 * Returns null when the content cannot be parsed into a valid agent.
 */
export function parseAgentMdFromString(
  content: string,
  opts: ParseAgentMdOptions = {},
): AgentConfigFile | null {
  try {
    const trimmed = content.trim();
    if (!trimmed) return null;

    const frontmatterMatch = trimmed.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      logger.warn({ filePath: opts.filePath }, 'Agent .md has no YAML frontmatter, skipping');
      return null;
    }

    const config = parseSimpleConfig(frontmatterMatch[1]);
    const body = trimmed.slice(frontmatterMatch[0].length).trim();

    if (!config.name || typeof config.name !== 'string') {
      logger.warn({ filePath: opts.filePath }, 'Agent config missing required "name" field');
      return null;
    }

    // Derive category: override > frontmatter > folder name
    let category: string | undefined = opts.categoryOverride ?? (config.category as string | undefined);
    if (!category && opts.filePath) {
      const parts = opts.filePath.replace(/\\/g, '/').split('/');
      if (parts.length > 1) {
        category = folderToCategory(parts[0]);
      }
    }

    const definition: AgentDefinitionCreate = {
      name: config.name as string,
      description: (config.description as string) ?? undefined,
      version: (config.version as string) ?? '1.0.0',
      systemPrompt:
        body ||
        ((config.systemPrompt ?? config.system_prompt ?? config.prompt) as string | undefined),
      personality: (config.personality as string) ?? undefined,
      preferredModel: (config.preferredModel ?? config.preferred_model ?? config.model) as string | undefined,
      modelTier: (config.modelTier ?? config.model_tier ?? config.tier ?? 'auto') as
        | 'auto'
        | 'premium'
        | 'budget',
      allowedTools: (config.allowedTools ?? config.allowed_tools ?? config.tools ?? []) as string[],
      customTools: (config.customTools ?? config.custom_tools ?? []) as AgentDefinitionCreate['customTools'],
      triggers: (config.triggers ?? []) as AgentDefinitionCreate['triggers'],
      visibility: 'public',
      tags: Array.isArray(config.tags)
        ? (config.tags as string[])
        : config.tags
          ? [String(config.tags)]
          : category
            ? [category]
            : [],
      category: category ?? undefined,
      icon: (config.emoji ?? config.icon) as string | undefined,
      skills: (config.skills ?? []) as string[],
      skillNudgeInterval: (config.skillNudgeInterval ?? 8) as number,
      verifyOnStop: (config.verifyOnStop ?? false) as boolean,
      planMode: (config.planMode ?? false) as boolean,
      historyCompaction: (config.historyCompaction ?? false) as boolean,
      godmodeWrap: (config.godmodeWrap ?? false) as boolean,
    };

    return { filePath: opts.filePath ?? 'pasted.md', definition };
  } catch (error) {
    logger.error({ filePath: opts.filePath, error }, 'Failed to parse agent .md');
    return null;
  }
}

/**
 * Parse a batch of .md files supplied as a Map<filePath, content>.
 */
export function parseAgentMdBatch(
  files: Map<string, string>,
  categoryOverride?: string,
): AgentConfigFile[] {
  const agents: AgentConfigFile[] = [];
  for (const [filePath, content] of files.entries()) {
    const agent = parseAgentMdFromString(content, { filePath, categoryOverride });
    if (agent) agents.push(agent);
  }
  return agents;
}

// ---------------------------------------------------------------------------
// GitHub repository fetching (public repos only)
// ---------------------------------------------------------------------------

/** Files that are repo metadata, never agent definitions. */
const SKIP_MD_FILES = new Set([
  'readme.md',
  'contributing.md',
  'contributing_zh-cn.md',
  'license.md',
  'security.md',
  'code_of_conduct.md',
  'authors.md',
  'changelog.md',
]);

/**
 * Fetch every .md agent definition from a PUBLIC GitHub repository.
 * Supports both https://github.com/owner/repo and git@github.com:owner/repo.git.
 * Returns a Map<filePath, fileContent>.
 */
export async function fetchGitHubRepoMdFiles(repoUrl: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (!match) {
    throw new Error('Invalid GitHub URL. Expected https://github.com/owner/repo');
  }
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '');

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dmr-x-agent-import',
  };

  // Resolve default branch
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!repoRes.ok) {
    throw new Error(`GitHub API error (${repoRes.status} ${repoRes.statusText}) for ${owner}/${repo}`);
  }
  const repoInfo = (await repoRes.json()) as { default_branch?: string };
  const branch = repoInfo.default_branch ?? 'main';

  // Recursive tree listing
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers },
  );
  if (!treeRes.ok) {
    throw new Error(`GitHub API error (${treeRes.status} ${treeRes.statusText}) listing tree`);
  }
  const tree = (await treeRes.json()) as { tree?: Array<{ type: string; path: string }> };

  const mdPaths = (tree.tree ?? [])
    .filter((t) => t.type === 'blob' && t.path.toLowerCase().endsWith('.md'))
    .map((t) => t.path)
    .filter((p) => !SKIP_MD_FILES.has(p.split('/').pop()!.toLowerCase()));

  for (const p of mdPaths) {
    try {
      const rawRes = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${p}`,
      );
      if (!rawRes.ok) continue;
      const text = await rawRes.text();
      result.set(p, text);
    } catch (e) {
      logger.warn({ path: p }, 'Failed to fetch GitHub file');
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// ZIP extraction
// ---------------------------------------------------------------------------

/**
 * Extract all .md files from an in-memory ZIP buffer.
 * Returns a Map<filePath, fileContent>.
 */
export async function extractZipMdFiles(
  zipBuffer: Buffer | Uint8Array | ArrayBuffer,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const zip = await JSZip.loadAsync(zipBuffer);

  const mdEntries = Object.keys(zip.files).filter(
    (name) => name.toLowerCase().endsWith('.md') && !zip.files[name].dir,
  );

  for (const name of mdEntries) {
    const content = await zip.files[name].async('string');
    result.set(name, content);
  }

  return result;
}
