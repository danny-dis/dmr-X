import fs from 'node:fs';
import path from 'node:path';
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
