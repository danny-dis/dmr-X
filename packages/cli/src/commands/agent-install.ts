/**
 * dmrx agent install — install an agent into a running DMR-X gateway.
 *
 * ponytail: thin CLI wrapper over the real admin endpoint POST /v1/agents/import
 * (apps/gateway/src/routes/agent.routes.ts:253). Supports three sources that the
 * endpoint already understands:
 *   - github <url>      fetch a repo, import every *.md agent card found
 *   - file <path>       read a local .md agent card and import it as text
 *   - "name>...md..."   inline definition pasted on the command line
 * No new transport logic — just builds the documented request body and POSTs it.
 */

import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { readFileSync } from 'node:fs';

interface AgentImportResponse {
  agents?: { imported: number; skipped: number; errors: unknown[]; agents: Array<{ name?: string; id?: string }> };
  skills?: { imported: number; errors: unknown[]; skills: unknown[] };
  error?: { message: string };
}

function resolveBaseUrl(opts: { baseUrl?: string }): string {
  return opts.baseUrl || process.env.DMRX_API_BASE_URL || 'http://localhost:3000/v1';
}

export function createAgentInstallCommand(): Command {
  const cmd = new Command('agent')
    .description('Manage DMR-X agents');

  cmd
    .command('install <source> [ref]')
    .description(
      'Install an agent into the gateway.\n' +
      '  github <repoUrl>   import every agent card from a GitHub repo\n' +
      '  file <path.md>     import a local .md agent card\n' +
      '  text <name>        read agent markdown from stdin and import as <name>',
    )
    .option('--base-url <url>', 'DMR-X gateway base URL (default: http://localhost:3000/v1)')
    .option('--admin-key <key>', 'Admin API key (DMRX_ADMIN_API_KEY)')
    .action(async (source: string, ref: string | undefined, opts: { baseUrl?: string; adminKey?: string }) => {
      const baseUrl = resolveBaseUrl(opts);
      const adminKey = opts.adminKey || process.env.DMRX_ADMIN_API_KEY;

      let body: Record<string, unknown>;
      let label: string;

      if (source === 'github') {
        if (!ref) {
          console.error(chalk.red('Error: `dmrx agent install github <repoUrl>` requires a repo URL'));
          process.exitCode = 1;
          return;
        }
        body = { source: 'github', githubUrl: ref };
        label = ref;
      } else if (source === 'file') {
        if (!ref) {
          console.error(chalk.red('Error: `dmrx agent install file <path.md>` requires a path'));
          process.exitCode = 1;
          return;
        }
        let content: string;
        try {
          content = readFileSync(ref, 'utf8');
        } catch (err) {
          console.error(chalk.red(`Error: cannot read ${ref}: ${(err as Error).message}`));
          process.exitCode = 1;
          return;
        }
        body = { source: 'text', content, filename: ref.split(/[\\/]/).pop() || 'agent.md' };
        label = ref;
      } else if (source === 'text') {
        const name = ref || 'pasted-agent';
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
        const content = Buffer.concat(chunks).toString('utf8').trim();
        if (!content) {
          console.error(chalk.red('Error: `dmrx agent install text <name>` expects agent markdown on stdin'));
          process.exitCode = 1;
          return;
        }
        body = { source: 'text', content, filename: `${name}.md` };
        label = name;
      } else {
        console.error(chalk.red(`Error: unknown source "${source}". Use github|file|text.`));
        process.exitCode = 1;
        return;
      }

      const spinner = ora(`Installing agent from ${label}…`).start();
      try {
        const res = await fetch(`${baseUrl}/agents/import`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(adminKey ? { 'x-admin-api-key': adminKey } : {}),
          },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as AgentImportResponse;

        if (!res.ok || json.error) {
          spinner.fail(`Import failed (${res.status})`);
          console.error(chalk.red(json.error?.message ?? 'Unknown error'));
          process.exitCode = 1;
          return;
        }

        const imported = json.agents?.imported ?? 0;
        const skipped = json.agents?.skipped ?? 0;
        spinner.succeed(`Imported ${imported} agent(s)${skipped ? `, skipped ${skipped}` : ''}`);
        for (const a of json.agents?.agents ?? []) {
          console.log(chalk.gray('  • ') + chalk.cyan(a.name ?? a.id ?? '(unnamed)'));
        }
        if (json.skills && json.skills.imported > 0) {
          console.log(chalk.gray(`  + ${json.skills.imported} skill(s) imported`));
        }
      } catch (err) {
        spinner.fail('Request failed');
        console.error(chalk.red((err as Error).message));
        console.error(chalk.gray(`Is the gateway running at ${baseUrl}?`));
        process.exitCode = 1;
      }
    });

  return cmd;
}
