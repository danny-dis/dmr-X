#!/usr/bin/env node
/**
 * DMR-X CLI
 *
 * Universal AI routing and orchestration platform CLI.
 *
 * Usage:
 *   dmrx init                    # Initialize DMR-X project
 *   dmrx providers list          # List all 35+ available providers
 *   dmrx providers add openai    # Add OpenAI provider (prompts for API key)
 *   dmrx providers add groq      # Add Groq provider
 *   dmrx status                  # Show system status
 *   dmrx test openai             # Test OpenAI provider
 *   dmrx test --all              # Test all registered providers
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { createInitCommand } from './commands/init.js';
import { createAddProviderCommand } from './commands/add-provider.js';
import { createListProvidersCommand } from './commands/list-providers.js';
import { createStatusCommand } from './commands/status.js';
import { createTestCommand } from './commands/test.js';
const program = new Command();
program
    .name('dmrx')
    .description('DMR-X - Universal AI routing and orchestration platform')
    .version('0.1.0');
// Register commands
program.addCommand(createInitCommand());
// providers subcommand group
const providersCmd = new Command('providers').description('Manage AI providers');
providersCmd.addCommand(createListProvidersCommand());
providersCmd.addCommand(createAddProviderCommand());
program.addCommand(providersCmd);
program.addCommand(createStatusCommand());
program.addCommand(createTestCommand());
// Custom help
program.addHelpText('after', () => {
    return [
        '',
        chalk.bold.cyan('  Examples:'),
        '',
        chalk.white('    Initialize a project:'),
        chalk.cyan('      dmrx init'),
        chalk.cyan('      dmrx init --name my-project'),
        '',
        chalk.white('    Manage providers:'),
        chalk.cyan('      dmrx providers list'),
        chalk.cyan('      dmrx providers list --free'),
        chalk.cyan('      dmrx providers list --category llm'),
        chalk.cyan('      dmrx providers add openai'),
        chalk.cyan('      dmrx providers add groq'),
        chalk.cyan('      dmrx providers add ollama --no-key'),
        '',
        chalk.white('    Check status:'),
        chalk.cyan('      dmrx status'),
        chalk.cyan('      dmrx status --health'),
        '',
        chalk.white('    Test providers:'),
        chalk.cyan('      dmrx test openai'),
        chalk.cyan('      dmrx test groq'),
        chalk.cyan('      dmrx test --all'),
        '',
    ].join('\n');
});
// Parse and run
program.parse(process.argv);
//# sourceMappingURL=index.js.map