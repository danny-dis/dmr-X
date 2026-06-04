/**
 * dmrx providers add <id> - Add a provider from the catalog
 *
 * Shows provider info, prompts for API key, saves to .env, registers in config.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { getProvider, getAllProviderIds } from '../catalog.js';
import { isInitialized, loadConfig, saveConfig, setEnvVar, } from '../config.js';
function printProviderInfo(provider) {
    console.log();
    console.log(chalk.bold.white(`  ${provider.name}`) + chalk.gray(` (${provider.id})`));
    console.log(chalk.gray(`  ${provider.description}`));
    console.log();
    console.log(chalk.white('  Categories:'), chalk.cyan(provider.category.join(', ')));
    console.log(chalk.white('  Base URL:   '), chalk.gray(provider.baseUrl));
    if (provider.models.length > 0) {
        console.log(chalk.white('  Models:     '), chalk.gray(provider.models.slice(0, 5).join(', ')));
        if (provider.models.length > 5) {
            console.log(chalk.white('              '), chalk.gray(`... and ${provider.models.length - 5} more`));
        }
    }
    if (provider.freeModels.length > 0) {
        console.log(chalk.white('  Free tier:  '), chalk.green(provider.freeModels.slice(0, 3).join(', ')));
    }
    if (provider.website) {
        console.log(chalk.white('  Website:    '), chalk.blue(provider.website));
    }
    if (provider.docsUrl) {
        console.log(chalk.white('  Docs:       '), chalk.blue(provider.docsUrl));
    }
    console.log();
}
export function createAddProviderCommand() {
    return new Command('add')
        .description('Add a provider from the catalog')
        .argument('<provider-id>', 'Provider ID (e.g., openai, groq, anthropic)')
        .option('--key <api-key>', 'API key (skip prompt)')
        .option('--no-key', 'Skip API key (for local providers)')
        .option('-y, --yes', 'Accept defaults without prompting')
        .action(async (providerId, opts) => {
        // Check initialization
        if (!isInitialized()) {
            console.log();
            console.log(chalk.yellow('  DMR-X not initialized. Run "dmrx init" first.'));
            console.log();
            process.exit(1);
        }
        // Find provider in catalog
        const provider = getProvider(providerId);
        if (!provider) {
            console.log();
            console.log(chalk.red(`  Provider "${providerId}" not found in catalog.`));
            console.log();
            console.log(chalk.white('  Available providers:'));
            const ids = getAllProviderIds();
            for (let i = 0; i < ids.length; i += 5) {
                const row = ids.slice(i, i + 5);
                console.log(chalk.gray('    ' + row.join(', ')));
            }
            console.log();
            console.log(chalk.gray('  Use "dmrx providers list" to see full details.'));
            console.log();
            process.exit(1);
        }
        // Load config
        const config = loadConfig();
        // Check if already registered
        const existing = config.providers.find((p) => p.id === provider.id);
        if (existing) {
            console.log();
            console.log(chalk.yellow(`  Provider "${provider.name}" is already registered.`));
            console.log(chalk.gray(`  Added: ${existing.addedAt}`));
            console.log(chalk.gray(`  Enabled: ${existing.enabled ? 'yes' : 'no'}`));
            console.log();
            const { action } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'action',
                    message: 'What would you like to do?',
                    choices: [
                        { name: 'Update API key', value: 'update' },
                        { name: 'Remove and re-add', value: 'readd' },
                        { name: 'Cancel', value: 'cancel' },
                    ],
                },
            ]);
            if (action === 'cancel') {
                console.log(chalk.gray('  Cancelled.'));
                console.log();
                return;
            }
            if (action === 'readd') {
                config.providers = config.providers.filter((p) => p.id !== provider.id);
                saveConfig(config);
            }
        }
        // Show provider info
        printProviderInfo(provider);
        // Determine if API key is needed
        const isLocal = provider.envKey === '';
        let apiKey;
        if (isLocal) {
            console.log(chalk.green('  Local provider - no API key required.'));
            console.log();
        }
        else if (opts.key === false) {
            console.log(chalk.gray('  Skipping API key (--no-key).'));
            console.log();
        }
        else if (opts.key) {
            apiKey = opts.key;
        }
        else {
            // Prompt for API key
            const { key } = await inquirer.prompt([
                {
                    type: 'password',
                    name: 'key',
                    message: `Enter ${provider.name} API key:`,
                    mask: '*',
                    validate: (input) => {
                        if (input.length > 0)
                            return true;
                        return 'API key cannot be empty (use --no-key for local providers)';
                    },
                },
            ]);
            apiKey = key;
        }
        const spinner = ora(`Adding ${provider.name}...`).start();
        try {
            // Save API key to .env
            if (apiKey && provider.envKey) {
                spinner.text = `Saving ${provider.envKey} to .env...`;
                setEnvVar(provider.envKey, apiKey);
                spinner.succeed(`Saved ${provider.envKey} to .env`);
            }
            // Register provider in config
            spinner.start('Registering provider in config...');
            const registeredProvider = {
                id: provider.id,
                name: provider.name,
                enabled: true,
                addedAt: new Date().toISOString(),
                models: provider.models,
                isLocal,
            };
            // Update or add provider
            const existingIndex = config.providers.findIndex((p) => p.id === provider.id);
            if (existingIndex >= 0) {
                config.providers[existingIndex] = registeredProvider;
            }
            else {
                config.providers.push(registeredProvider);
            }
            // Set as default if first provider of this category
            for (const cat of provider.category) {
                const catKey = cat;
                if (catKey in config.defaults && !config.defaults[catKey]) {
                    config.defaults[catKey] = provider.id;
                }
            }
            saveConfig(config);
            spinner.succeed('Provider registered in config');
            console.log();
            console.log(chalk.green.bold(`  ${provider.name} added successfully!`));
            console.log();
            if (!isLocal) {
                console.log(chalk.white('  Environment variable:'));
                console.log(chalk.cyan(`    ${provider.envKey}=***`));
                console.log();
            }
            console.log(chalk.white('  Test the provider:'));
            console.log(chalk.cyan(`    dmrx test ${provider.id}`));
            console.log();
        }
        catch (err) {
            spinner.fail('Failed to add provider');
            console.error(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
            process.exit(1);
        }
    });
}
//# sourceMappingURL=add-provider.js.map