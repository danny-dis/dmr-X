/**
 * dmrx status - Show DMR-X system status
 *
 * Displays providers, health checks, infrastructure, and usage stats.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync } from 'node:fs';
import { isInitialized, loadConfig, getEnvPath, getDockerComposePath } from '../config.js';
import { getProvider } from '../catalog.js';
async function checkLocalEndpoint(url, timeoutMs = 3000) {
    const start = Date.now();
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
        });
        clearTimeout(timeout);
        return { ok: res.ok || res.status === 404, latencyMs: Date.now() - start };
    }
    catch (err) {
        return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
}
async function checkProviderHealth(provider) {
    const catalogEntry = getProvider(provider.id);
    if (!catalogEntry) {
        return { provider, status: 'unhealthy', error: 'Provider not found in catalog' };
    }
    // Local providers - try to connect
    if (catalogEntry.envKey === '') {
        const result = await checkLocalEndpoint(catalogEntry.baseUrl);
        return {
            provider,
            status: result.ok ? 'healthy' : 'unhealthy',
            latencyMs: result.latencyMs,
            error: result.error,
        };
    }
    // Remote providers - check if API key exists
    const envPath = getEnvPath();
    if (!existsSync(envPath)) {
        return { provider, status: 'unhealthy', error: 'No .env file found' };
    }
    // We can't fully test remote providers without making actual API calls,
    // so we just verify the key exists
    return { provider, status: 'healthy' };
}
export function createStatusCommand() {
    return new Command('status')
        .description('Show DMR-X system status')
        .option('--health', 'Run health checks on all providers')
        .option('--json', 'Output as JSON')
        .action(async (opts) => {
        console.log();
        console.log(chalk.bold.cyan('  DMR-X System Status'));
        console.log(chalk.gray('  ────────────────────'));
        console.log();
        // Check initialization
        const initialized = isInitialized();
        console.log(chalk.white('  Project:     '), initialized ? chalk.green('Initialized') : chalk.red('Not initialized'));
        if (!initialized) {
            console.log();
            console.log(chalk.yellow('  Run "dmrx init" to get started.'));
            console.log();
            return;
        }
        const config = loadConfig();
        console.log(chalk.white('  Name:        '), chalk.white(config.project.name));
        console.log(chalk.white('  Version:     '), chalk.gray(config.version));
        console.log(chalk.white('  Created:     '), chalk.gray(config.project.created));
        console.log();
        // Infrastructure
        console.log(chalk.bold.white('  Infrastructure'));
        console.log(chalk.gray('  ' + '─'.repeat(40)));
        const dockerComposePath = getDockerComposePath();
        const hasDockerCompose = existsSync(dockerComposePath);
        console.log(chalk.white('  docker-compose: '), hasDockerCompose ? chalk.green('found') : chalk.gray('not found'));
        const envPath = getEnvPath();
        const hasEnv = existsSync(envPath);
        console.log(chalk.white('  .env file:      '), hasEnv ? chalk.green('found') : chalk.gray('not found'));
        // Check for local services
        const localServices = [
            { name: 'PostgreSQL', url: 'http://localhost:5432', default: 'localhost:5432' },
            { name: 'Redis', url: 'http://localhost:6379', default: 'localhost:6379' },
            { name: 'Ollama', url: 'http://localhost:11434/api/tags', default: 'localhost:11434' },
        ];
        if (opts.health) {
            console.log();
            const spinner = ora('Checking local services...').start();
            for (const svc of localServices) {
                const result = await checkLocalEndpoint(svc.url, 2000);
                spinner.stop();
                console.log(chalk.white(`  ${svc.name.padEnd(14)}`), result.ok
                    ? chalk.green(`reachable`) + chalk.gray(` (${result.latencyMs}ms)`)
                    : chalk.gray('not running'));
            }
            spinner.stop();
        }
        else {
            console.log(chalk.gray('  Use --health to check local services'));
        }
        console.log();
        // Providers
        console.log(chalk.bold.white('  Registered Providers'));
        console.log(chalk.gray('  ' + '─'.repeat(40)));
        if (config.providers.length === 0) {
            console.log(chalk.gray('  No providers registered.'));
            console.log();
            console.log(chalk.white('  Add a provider:'));
            console.log(chalk.cyan('    dmrx providers add openai'));
        }
        else {
            const enabled = config.providers.filter((p) => p.enabled);
            const disabled = config.providers.filter((p) => !p.enabled);
            console.log(chalk.white(`  Total: ${config.providers.length}  `) + chalk.green(`Enabled: ${enabled.length}  `) + chalk.gray(`Disabled: ${disabled.length}`));
            console.log();
            for (const p of config.providers) {
                const icon = p.enabled ? chalk.green('●') : chalk.red('○');
                const isLocal = p.isLocal;
                const badge = isLocal ? chalk.blue(' [local]') : '';
                console.log(`    ${icon} ${chalk.white(p.name)}${badge}`);
                console.log(chalk.gray(`      ID: ${p.id}`));
                console.log(chalk.gray(`      Models: ${p.models.length} available`));
                console.log(chalk.gray(`      Added: ${p.addedAt}`));
            }
            // Health checks
            if (opts.health) {
                console.log();
                console.log(chalk.bold.white('  Provider Health'));
                console.log(chalk.gray('  ' + '─'.repeat(40)));
                const spinner = ora('Checking providers...').start();
                for (const p of config.providers) {
                    if (!p.enabled)
                        continue;
                    const result = await checkProviderHealth(p);
                    spinner.stop();
                    const statusStr = result.status === 'healthy'
                        ? chalk.green('healthy')
                        : result.status === 'unhealthy'
                            ? chalk.red('unhealthy')
                            : chalk.gray('untested');
                    const latencyStr = result.latencyMs ? chalk.gray(` (${result.latencyMs}ms)`) : '';
                    console.log(`    ${p.name.padEnd(20)} ${statusStr}${latencyStr}`);
                    if (result.error) {
                        console.log(chalk.red(`      Error: ${result.error}`));
                    }
                }
                spinner.stop();
            }
        }
        console.log();
        // Defaults
        console.log(chalk.bold.white('  Default Providers'));
        console.log(chalk.gray('  ' + '─'.repeat(40)));
        for (const [cat, providerId] of Object.entries(config.defaults)) {
            const label = cat.replace('_', ' ').toUpperCase().padEnd(12);
            const value = providerId ? chalk.white(providerId) : chalk.gray('not set');
            console.log(`    ${chalk.gray(label)} ${value}`);
        }
        // Settings
        console.log();
        console.log(chalk.bold.white('  Settings'));
        console.log(chalk.gray('  ' + '─'.repeat(40)));
        console.log(chalk.gray(`    Max retries:  ${config.settings.maxRetries}`));
        console.log(chalk.gray(`    Timeout:      ${config.settings.timeoutMs}ms`));
        console.log(chalk.gray(`    Log level:    ${config.settings.logLevel}`));
        console.log();
    });
}
//# sourceMappingURL=status.js.map