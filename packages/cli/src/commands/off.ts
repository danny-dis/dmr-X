/**
 * dmrx off - Remove DMR-X configuration from AI agent tools
 *
 * Reverses the changes made by `dmrx setup` for Claude Code,
 * opencode, Codex CLI, Cursor, and Gemini CLI.
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

function removeTomlSection(content: string, section: string): string {
  const header = `[${section}]`;
  if (!content.includes(header)) return content;
  const lines = content.split('\n');
  const out: string[] = [];
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed === header) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (trimmed.startsWith('[')) {
        inSection = false;
        out.push(lines[i]);
      }
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
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
    const bashrc = join(homedir(), '.bashrc');
    if (existsSync(bashrc)) return bashrc;
    return join(homedir(), '.profile');
  }
  const profile = join(homedir(), '.profile');
  const bashrc = join(homedir(), '.bashrc');
  if (existsSync(bashrc)) return bashrc;
  return profile;
}

function removeFromShellProfile(profilePath: string, keys: string[]): { backup?: string; changes: number } {
  if (!existsSync(profilePath)) return { changes: 0 };

  const backup = backupFile(profilePath);
  let content = readFileSync(profilePath, 'utf-8');
  let changes = 0;

  for (const key of keys) {
    const regex = new RegExp(`^export\\s+${key}=.*\n?`, 'gm');
    const before = content;
    content = content.replace(regex, '');
    if (content !== before) changes++;
  }

  // Clean up excessive blank lines
  content = content.replace(/\n{3,}/g, '\n\n').trimEnd();
  if (content) content += '\n';

  safeWriteFile(profilePath, content);
  return { backup, changes };
}

// ---------------------------------------------------------------------------
// Off steps
// ---------------------------------------------------------------------------

interface OffStep {
  name: string;
  file?: string;
  backup?: string;
  removed: boolean;
  error?: string;
}

function offClaudeCode(): OffStep {
  const filePath = join(homedir(), '.claude', 'settings.json');
  if (!existsSync(filePath)) return { name: 'Claude Code', removed: false };
  const backup = backupFile(filePath);
  const config = readJSON(filePath);
  const ps = config.projectSettings as Record<string, unknown> | undefined;
  if (!ps || typeof ps !== 'object') return { name: 'Claude Code', file: filePath, removed: false };
  if (!('dmr-x' in ps)) return { name: 'Claude Code', file: filePath, removed: false, backup };
  delete ps['dmr-x'];
  if (Object.keys(ps).length === 0) {
    delete config.projectSettings;
  }
  safeWriteFile(filePath, JSON.stringify(config, null, 2) + '\n');
  return { name: 'Claude Code', file: filePath, backup, removed: true };
}

function offOpencode(): OffStep {
  const filePath = join(homedir(), '.config', 'opencode', 'config.json');
  if (!existsSync(filePath)) return { name: 'opencode', removed: false };
  const backup = backupFile(filePath);
  const config = readJSON(filePath);
  const mp = config.modelProviders as Record<string, unknown> | undefined;
  if (!mp || typeof mp !== 'object') return { name: 'opencode', file: filePath, removed: false };
  if (!('DMR-X' in mp)) return { name: 'opencode', file: filePath, removed: false, backup };
  delete mp['DMR-X'];
  if (Object.keys(mp).length === 0) {
    delete config.modelProviders;
  }
  safeWriteFile(filePath, JSON.stringify(config, null, 2) + '\n');
  return { name: 'opencode', file: filePath, backup, removed: true };
}

function offCodexCLI(): OffStep {
  const filePath = join(homedir(), '.codex', 'config.toml');
  if (!existsSync(filePath)) return { name: 'Codex CLI', removed: false };
  const backup = backupFile(filePath);
  const content = readToml(filePath);
  if (!content.includes('[provider.dmr-x]')) return { name: 'Codex CLI', file: filePath, removed: false, backup };
  const updated = removeTomlSection(content, 'provider.dmr-x');
  safeWriteFile(filePath, updated);
  return { name: 'Codex CLI', file: filePath, backup, removed: true };
}

function offCursor(): OffStep {
  const filePath = getCursorSettingsPath();
  if (!existsSync(filePath)) return { name: 'Cursor', removed: false };
  const backup = backupFile(filePath);
  const config = readJSON(filePath);
  const providers = (config['chat.openAiCompatible'] as Array<Record<string, unknown>>) || [];
  const idx = providers.findIndex((p: Record<string, unknown>) => p.id === 'dmr-x');
  if (idx < 0) return { name: 'Cursor', file: filePath, removed: false, backup };
  providers.splice(idx, 1);
  config['chat.openAiCompatible'] = providers;
  safeWriteFile(filePath, JSON.stringify(config, null, 2) + '\n');
  return { name: 'Cursor', file: filePath, backup, removed: true };
}

function offGemini(): OffStep {
  const profilePath = detectShellProfile();
  const result = removeFromShellProfile(profilePath, [
    'GOOGLE_GEMINI_BASE_URL',
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
  ]);
  return {
    name: 'Gemini CLI',
    file: profilePath,
    backup: result.backup,
    removed: result.changes > 0,
  };
}

function offGeminiMcp(): OffStep {
  const filePath = join(homedir(), '.gemini', 'mcp_config.json');
  if (!existsSync(filePath)) return { name: 'Gemini CLI MCP', removed: false };

  const backup = backupFile(filePath);
  const config = readJSON(filePath);
  const mcpServers = config.mcpServers as Record<string, unknown> | undefined;
  if (!mcpServers || typeof mcpServers !== 'object') {
    return { name: 'Gemini CLI MCP', file: filePath, removed: false, backup };
  }
  if (!('dmr-x' in mcpServers)) {
    return { name: 'Gemini CLI MCP', file: filePath, removed: false, backup };
  }
  delete mcpServers['dmr-x'];
  if (Object.keys(mcpServers).length === 0) {
    delete config.mcpServers;
  }
  safeWriteFile(filePath, JSON.stringify(config, null, 2) + '\n');
  return { name: 'Gemini CLI MCP', file: filePath, backup, removed: true };
}

// ---------------------------------------------------------------------------
// Command factory
// ---------------------------------------------------------------------------

export function createOffCommand(): Command {
  return new Command('off')
    .description('Remove DMR-X configuration from AI agent tools')
    .option('--claude', 'Remove Claude Code configuration')
    .option('--opencode', 'Remove opencode configuration')
    .option('--codex', 'Remove Codex CLI configuration')
    .option('--cursor', 'Remove Cursor configuration')
    .option('--gemini', 'Remove Gemini CLI configuration')
    .action(async (opts) => {
      const hasClaude = opts.claude;
      const hasOpencode = opts.opencode;
      const hasCodex = opts.codex;
      const hasCursor = opts.cursor;
      const hasGemini = opts.gemini;
      const hasAny = hasClaude || hasOpencode || hasCodex || hasCursor || hasGemini;

      console.log();
      console.log(chalk.bold.cyan('  DMR-X Agent Teardown'));
      console.log(chalk.gray('  ────────────────────'));
      console.log();

      if (!hasAny) {
        console.log(chalk.white('  Available teardown targets:'));
        console.log();
        console.log(chalk.cyan('    dmrx off --claude      ') + chalk.gray('# Remove Claude Code config'));
        console.log(chalk.cyan('    dmrx off --opencode    ') + chalk.gray('# Remove opencode config'));
        console.log(chalk.cyan('    dmrx off --codex       ') + chalk.gray('# Remove Codex CLI config'));
        console.log(chalk.cyan('    dmrx off --cursor      ') + chalk.gray('# Remove Cursor config'));
        console.log(chalk.cyan('    dmrx off --gemini      ') + chalk.gray('# Remove Gemini CLI config'));
        console.log();
        console.log(chalk.white('  You can combine flags:'));
        console.log(chalk.cyan('    dmrx off --claude --opencode --codex --cursor --gemini'));
        console.log();
        return;
      }

      const runners: Array<{ label: string; run: () => OffStep }> = [];
      if (hasClaude) runners.push({ label: 'Claude Code', run: () => offClaudeCode() });
      if (hasOpencode) runners.push({ label: 'opencode', run: () => offOpencode() });
      if (hasCodex) runners.push({ label: 'Codex CLI', run: () => offCodexCLI() });
      if (hasCursor) runners.push({ label: 'Cursor', run: () => offCursor() });
      if (hasGemini) {
        runners.push({ label: 'Gemini CLI', run: () => offGemini() });
        runners.push({ label: 'Gemini CLI MCP', run: () => offGeminiMcp() });
      }

      let removedCount = 0;
      let notFoundCount = 0;

      for (const r of runners) {
        const spinner = ora(`Removing ${r.label} configuration...`).start();
        try {
          const result = r.run();
          spinner.stop();
          if (result.removed) {
            removedCount++;
            console.log(`  ${chalk.green('✓')} ${chalk.white(result.name)} configuration removed`);
            if (result.file) console.log(chalk.gray(`    ${result.file}`));
            if (result.backup) console.log(chalk.gray(`    Backup: ${result.backup}`));
          } else {
            notFoundCount++;
            console.log(`  ${chalk.yellow('–')} ${chalk.white(result.name)} — not found or already clean`);
            if (result.file) console.log(chalk.gray(`    ${result.file}`));
          }
          console.log();
        } catch (err) {
          spinner.stop();
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  ${chalk.red('✗')} ${chalk.white(r.label)} failed — ${chalk.red(msg)}`);
          console.log();
        }
      }

      if (removedCount > 0) {
        console.log(chalk.green.bold('  Teardown complete.'));
      } else if (notFoundCount > 0) {
        console.log(chalk.yellow('  Nothing to remove.'));
      }
      console.log();
    });
}
