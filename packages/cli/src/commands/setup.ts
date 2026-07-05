/**
 * dmrx setup - Configure AI agent tools to use DMR-X
 *
 * Auto-patches config files for Claude Code, opencode, Codex CLI, Cursor,
 * and Gemini CLI to point at the DMR-X gateway.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function backupFile(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  const backup = `${filePath}.backup.${Date.now()}`;
  try {
    copyFileSync(filePath, backup);
    return backup;
  } catch {
    return undefined;
  }
}

function readJSON(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  const raw = readFileSync(filePath, 'utf-8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid JSON in ${filePath}`);
  }
}

function safeWriteFile(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
}

function readToml(filePath: string): string {
  if (!existsSync(filePath)) return '';
  return readFileSync(filePath, 'utf-8');
}

function addTomlSection(content: string, section: string, entries: Record<string, string>): string {
  const header = `[${section}]`;
  if (content.includes(header)) {
    const lines = content.split('\n');
    const out: string[] = [];
    let inSection = false;
    let replaced = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed === header) {
        inSection = true;
        replaced = true;
        out.push(lines[i]);
        while (i + 1 < lines.length) {
          const n = lines[i + 1].trimStart();
          if (n.startsWith('[') || n === '') break;
          i++;
        }
        for (const [k, v] of Object.entries(entries)) {
          out.push(`${k} = "${v}"`);
        }
      } else {
        if (!inSection) out.push(lines[i]);
        else if (trimmed.startsWith('[')) { inSection = false; out.push(lines[i]); }
      }
    }
    if (!replaced) {
      out.push('', header);
      for (const [k, v] of Object.entries(entries)) out.push(`${k} = "${v}"`);
    }
    return out.join('\n');
  }
  const trimmed = content.trimEnd();
  return trimmed + '\n' + header + '\n' +
    Object.entries(entries).map(([k, v]) => `${k} = "${v}"`).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Platform-specific paths
// ---------------------------------------------------------------------------

function getCursorSettingsPath(): string {
  const p = process.platform;
  if (p === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Cursor', 'User', 'settings.json');
  }
  if (p === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'settings.json');
  }
  return join(homedir(), '.config', 'Cursor', 'User', 'settings.json');
}

// ---------------------------------------------------------------------------
// Shell profile helpers (for Gemini CLI / Antigravity env vars)
// ---------------------------------------------------------------------------

function detectShellProfile(): string {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return join(homedir(), '.zshrc');
  if (shell.includes('bash')) return join(homedir(), '.bashrc');
  if (process.platform === 'win32') {
    // Git Bash or WSL
    const bashrc = join(homedir(), '.bashrc');
    if (existsSync(bashrc)) return bashrc;
    return join(homedir(), '.profile');
  }
  // Fallback
  const profile = join(homedir(), '.profile');
  const bashrc = join(homedir(), '.bashrc');
  if (existsSync(bashrc)) return bashrc;
  return profile;
}

interface EnvVarEntry {
  key: string;
  value: string;
}

function patchShellProfile(profilePath: string, vars: EnvVarEntry[]): { backup?: string; changes: number } {
  if (!existsSync(profilePath)) {
    const content = vars.map(v => `export ${v.key}="${v.value}"`).join('\n') + '\n';
    safeWriteFile(profilePath, content);
    return { changes: vars.length };
  }

  const backup = backupFile(profilePath);
  let content = readFileSync(profilePath, 'utf-8');
  let changes = 0;

  for (const v of vars) {
    const regex = new RegExp(`^export\\s+${v.key}=.*$`, 'gm');
    if (regex.test(content)) {
      content = content.replace(regex, `export ${v.key}="${v.value}"`);
    } else {
      // Add before any interactive-shell guard that stops processing
      const insertAt = content.search(/\n# (>>>|<<<|End of|mesg|if \[)/);
      if (insertAt >= 0) {
        const before = content.slice(0, insertAt);
        const after = content.slice(insertAt);
        content = before + `export ${v.key}="${v.value}"\n` + after;
      } else {
        content += `export ${v.key}="${v.value}"\n`;
      }
    }
    changes++;
  }

  safeWriteFile(profilePath, content);
  return { backup, changes };
}

// ---------------------------------------------------------------------------
// Setup steps — each returns { name, file?, backup?, error? }
// ---------------------------------------------------------------------------

interface SetupStep {
  name: string;
  file?: string;
  backup?: string;
  error?: string;
}

function setupClaudeCode(baseUrl: string, apiKey: string): SetupStep {
  const dir = join(homedir(), '.claude');
  const filePath = join(dir, 'settings.json');
  const backup = backupFile(filePath);
  const config = readJSON(filePath);
  const projectSettings = (config.projectSettings as Record<string, unknown>) || {};
  projectSettings['dmr-x'] = { baseUrl, apiKey };
  config.projectSettings = projectSettings;
  safeWriteFile(filePath, JSON.stringify(config, null, 2) + '\n');
  return { name: 'Claude Code', file: filePath, backup };
}

function setupOpencode(baseUrl: string, apiKey: string): SetupStep {
  const dir = join(homedir(), '.config', 'opencode');
  const filePath = join(dir, 'config.json');
  const backup = backupFile(filePath);
  const config = readJSON(filePath);
  const modelProviders = (config.modelProviders as Record<string, unknown>) || {};
  modelProviders['DMR-X'] = { url: baseUrl, apiKey };
  config.modelProviders = modelProviders;
  safeWriteFile(filePath, JSON.stringify(config, null, 2) + '\n');
  return { name: 'opencode', file: filePath, backup };
}

function setupCodexCLI(baseUrl: string, apiKey: string): SetupStep {
  const dir = join(homedir(), '.codex');
  const filePath = join(dir, 'config.toml');
  const backup = backupFile(filePath);
  let content = readToml(filePath);
  content = addTomlSection(content, 'provider.dmr-x', {
    base_url: baseUrl,
    api_key: apiKey,
  });
  safeWriteFile(filePath, content);
  return { name: 'Codex CLI', file: filePath, backup };
}

function setupCursor(baseUrl: string, apiKey: string): SetupStep {
  const filePath = getCursorSettingsPath();
  const backup = backupFile(filePath);
  const config = readJSON(filePath);
  const providers = (config['chat.openAiCompatible'] as Array<Record<string, unknown>>) || [];
  const existing = providers.findIndex((p: Record<string, unknown>) => p.id === 'dmr-x');
  const entry: Record<string, unknown> = { id: 'dmr-x', name: 'DMR-X', baseUrl, apiKey };
  if (existing >= 0) {
    providers[existing] = entry;
  } else {
    providers.push(entry);
  }
  config['chat.openAiCompatible'] = providers;
  safeWriteFile(filePath, JSON.stringify(config, null, 2) + '\n');
  return { name: 'Cursor', file: filePath, backup };
}

function setupGemini(baseUrl: string, apiKey: string): SetupStep {
  const profilePath = detectShellProfile();
  const gatewayRoot = baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  const result = patchShellProfile(profilePath, [
    { key: 'GOOGLE_GEMINI_BASE_URL', value: gatewayRoot },
    { key: 'GEMINI_API_KEY', value: apiKey },
    { key: 'GEMINI_MODEL', value: 'auto-coding' },
  ]);
  return {
    name: 'Gemini CLI',
    file: profilePath,
    backup: result.backup,
  };
}

function setupGeminiMcp(baseUrl: string, apiKey: string): SetupStep {
  const dir = join(homedir(), '.gemini');
  const filePath = join(dir, 'mcp_config.json');

  // Derive MCP SSE URL from the gateway base URL
  // Default gateway :3000/v1 → MCP server :3001/sse
  const gatewayRoot = baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  const mcpUrl = gatewayRoot.includes(':3000')
    ? 'http://localhost:3001/sse'
    : `${gatewayRoot}/sse`;

  const backup = backupFile(filePath);
  const config = readJSON(filePath);
  const mcpServers = (config.mcpServers as Record<string, unknown>) || {};
  mcpServers['dmr-x'] = {
    serverUrl: mcpUrl,
    env: { DMRX_API_KEY: apiKey },
  };
  config.mcpServers = mcpServers;
  safeWriteFile(filePath, JSON.stringify(config, null, 2) + '\n');
  return { name: 'Gemini CLI MCP', file: filePath, backup };
}

// ---------------------------------------------------------------------------
// Command factory
// ---------------------------------------------------------------------------

export function createSetupCommand(): Command {
  return new Command('setup')
    .description('Configure AI agent tools to use DMR-X')
    .option('--claude', 'Configure Claude Code')
    .option('--opencode', 'Configure opencode')
    .option('--codex', 'Configure Codex CLI')
    .option('--cursor', 'Configure Cursor')
    .option('--gemini', 'Configure Gemini CLI (sets GOOGLE_GEMINI_BASE_URL + MCP)')
    .option('--base-url <url>', 'DMR-X gateway base URL (default: http://localhost:3000/v1)')
    .option('--api-key <key>', 'DMR-X API key (default: DMRX_API_KEY env var)')
    .action(async (opts) => {
      const baseUrl = opts.baseUrl || process.env.DMRX_API_BASE_URL || 'http://localhost:3000/v1';
      const apiKey = opts.apiKey || process.env.DMRX_API_KEY || '';
      const hasClaude = opts.claude;
      const hasOpencode = opts.opencode;
      const hasCodex = opts.codex;
      const hasCursor = opts.cursor;
      const hasGemini = opts.gemini;
      const hasAny = hasClaude || hasOpencode || hasCodex || hasCursor || hasGemini;

      console.log();
      console.log(chalk.bold.cyan('  DMR-X Agent Setup'));
      console.log(chalk.gray('  ────────────────'));
      console.log();

      if (!hasAny) {
        console.log(chalk.white('  Available setup targets:'));
        console.log();
        console.log(chalk.cyan('    dmrx setup --claude      ') + chalk.gray('# Configure Claude Code'));
        console.log(chalk.cyan('    dmrx setup --opencode    ') + chalk.gray('# Configure opencode'));
        console.log(chalk.cyan('    dmrx setup --codex       ') + chalk.gray('# Configure Codex CLI'));
        console.log(chalk.cyan('    dmrx setup --cursor      ') + chalk.gray('# Configure Cursor'));
        console.log(chalk.cyan('    dmrx setup --gemini      ') + chalk.gray('# Configure Gemini CLI'));
        console.log();
        console.log(chalk.white('  You can combine flags:'));
        console.log(chalk.cyan('    dmrx setup --claude --opencode --codex --cursor --gemini'));
        console.log();
        console.log(chalk.gray(`  Default base URL: ${baseUrl}`));
        if (apiKey) {
          console.log(chalk.gray('  API key: [set]'));
        } else {
          console.log(chalk.yellow('  No API key set — set DMRX_API_KEY or use --api-key'));
        }
        console.log();
        return;
      }

      const runners: Array<{ label: string; run: () => SetupStep }> = [];
      if (hasClaude) runners.push({ label: 'Claude Code', run: () => setupClaudeCode(baseUrl, apiKey) });
      if (hasOpencode) runners.push({ label: 'opencode', run: () => setupOpencode(baseUrl, apiKey) });
      if (hasCodex) runners.push({ label: 'Codex CLI', run: () => setupCodexCLI(baseUrl, apiKey) });
      if (hasCursor) runners.push({ label: 'Cursor', run: () => setupCursor(baseUrl, apiKey) });
      if (hasGemini) {
        runners.push({ label: 'Gemini CLI', run: () => setupGemini(baseUrl, apiKey) });
        runners.push({ label: 'Gemini CLI MCP', run: () => setupGeminiMcp(baseUrl, apiKey) });
      }

      const results: SetupStep[] = [];

      for (const r of runners) {
        const spinner = ora(`Configuring ${r.label}...`).start();
        try {
          const result = r.run();
          spinner.stop();
          results.push(result);
          console.log(`  ${chalk.green('✓')} ${chalk.white(result.name)} configured`);
          if (result.file) console.log(chalk.gray(`    ${result.file}`));
          if (result.backup) console.log(chalk.gray(`    Backup: ${result.backup}`));
          console.log();
        } catch (err) {
          spinner.stop();
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  ${chalk.red('✗')} ${chalk.white(r.label)} failed — ${chalk.red(msg)}`);
          console.log();
        }
      }

      console.log(chalk.gray(`  Gateway: ${baseUrl}`));
      if (apiKey) console.log(chalk.gray('  API key: [set]'));
      console.log();
      console.log(chalk.green.bold('  Setup complete.'));
      console.log();
    });
}
