#!/usr/bin/env node
/**
 * agent-pc CLI — manage per-agent personal computers.
 *
 * Usage:
 *   agent-pc spawn --id <agentId> --workspace <dir> --browser <dir> --entry <file>
 *   agent-pc list
 *   agent-pc stop <agentId>
 *   agent-pc stop-all
 */

import { AgentPCRegistry } from './registry.js';
import type { CreateAgentPCOptions } from './types.js';

const registry = new AgentPCRegistry();

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      args[key] = value;
    }
  }
  return args;
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);

  switch (cmd) {
    case 'spawn': {
      const agentId = args.id;
      const workspace = args.workspace;
      const browser = args.browser;
      const entry = args.entry;

      if (!agentId || !workspace || !browser || !entry) {
        console.error('Usage: agent-pc spawn --id <agentId> --workspace <dir> --browser <dir> --entry <file>');
        process.exit(1);
      }

      const options: CreateAgentPCOptions = {
        agentId,
        name: args.name,
        baseWorkspaceDir: workspace,
        baseBrowserProfileDir: browser,
        entryPoint: entry,
        env: args.env ? JSON.parse(args.env) : undefined,
        autoClean: args.autoClean === 'true',
      };

      try {
        const pc = await registry.spawn(options);
        const info = pc.getInfo();
        console.log(`Spawned agent ${info.agentId} (pid: ${info.pid})`);
        console.log(`  Workspace: ${info.workspaceRoot}`);
        console.log(`  Browser profile: ${info.browserProfileDir}`);
      } catch (err) {
        console.error(`Failed to spawn agent: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
      break;
    }

    case 'list': {
      const agents = registry.list();
      if (agents.length === 0) {
        console.log('No agents running.');
      } else {
        console.log(`Running agents (${agents.length}):`);
        for (const info of agents) {
          console.log(`  ${info.agentId} | ${info.state} | pid: ${info.pid ?? 'N/A'} | uptime: ${info.uptimeMs ? Math.round(info.uptimeMs / 1000) + 's' : 'N/A'}`);
        }
      }
      break;
    }

    case 'stop': {
      const agentId = args.id;
      if (!agentId) {
        console.error('Usage: agent-pc stop <agentId>');
        process.exit(1);
      }
      try {
        await registry.stop(agentId);
        console.log(`Stopped agent ${agentId}`);
      } catch (err) {
        console.error(`Failed to stop agent: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
      break;
    }

    case 'stop-all': {
      await registry.stopAll();
      console.log('Stopped all agents');
      break;
    }

    default: {
      console.log(`agent-pc — per-agent personal computer manager

Commands:
  spawn --id <id> --workspace <dir> --browser <dir> --entry <file>   Spawn a new agent PC
  list                                                               List running agents
  stop <agentId>                                                     Stop an agent
  stop-all                                                           Stop all agents
`);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
