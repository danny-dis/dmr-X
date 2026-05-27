/**
 * dmrx test <provider> - Test a provider by sending a test request
 *
 * Sends a lightweight test request to verify the provider works.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { isInitialized, loadConfig, getEnvPath } from '../config.js';
import { getProvider } from '../catalog.js';
import { existsSync, readFileSync } from 'node:fs';
function getApiKey(envKey) {
    const envPath = getEnvPath();
    if (!existsSync(envPath))
        return undefined;
    const content = readFileSync(envPath, 'utf-8');
    const regex = new RegExp(`^${envKey}=(.*)$`, 'm');
    const match = content.match(regex);
    return match ? match[1] : undefined;
}
async function testLLMProvider(provider, apiKey) {
    const start = Date.now();
    const model = provider.models[0];
    // Local providers
    if (!provider.envKey) {
        try {
            const res = await fetch(`${provider.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: 'Say "OK" and nothing else.' }],
                    max_tokens: 10,
                    stream: false,
                }),
                signal: AbortSignal.timeout(15000),
            });
            if (!res.ok) {
                const text = await res.text();
                return {
                    provider: provider.id,
                    success: false,
                    latencyMs: Date.now() - start,
                    error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
                    model,
                };
            }
            const data = await res.json();
            const content = data?.choices?.[0]?.message?.content || '';
            return {
                provider: provider.id,
                success: true,
                latencyMs: Date.now() - start,
                response: content.slice(0, 100),
                model,
            };
        }
        catch (err) {
            return {
                provider: provider.id,
                success: false,
                latencyMs: Date.now() - start,
                error: err instanceof Error ? err.message : String(err),
                model,
            };
        }
    }
    // Remote providers - need API key
    if (!apiKey) {
        return {
            provider: provider.id,
            success: false,
            latencyMs: Date.now() - start,
            error: `No API key found. Set ${provider.envKey} in .env`,
            model,
        };
    }
    // Build request based on provider
    const headers = {
        'Content-Type': 'application/json',
    };
    // Provider-specific auth headers
    switch (provider.id) {
        case 'anthropic':
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
            break;
        case 'cohere':
            headers['Authorization'] = `Bearer ${apiKey}`;
            break;
        default:
            headers['Authorization'] = `Bearer ${apiKey}`;
    }
    // Provider-specific request body
    let url = `${provider.baseUrl}`;
    let body;
    if (provider.id === 'anthropic') {
        url += '/messages';
        body = {
            model,
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Say "OK" and nothing else.' }],
        };
    }
    else {
        url += '/chat/completions';
        body = {
            model,
            messages: [{ role: 'user', content: 'Say "OK" and nothing else.' }],
            max_tokens: 10,
            stream: false,
        };
    }
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) {
            const text = await res.text();
            return {
                provider: provider.id,
                success: false,
                latencyMs: Date.now() - start,
                error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
                model,
            };
        }
        const data = await res.json();
        let content = '';
        // Parse response based on provider format
        if (provider.id === 'anthropic') {
            const msg = data;
            content = msg?.content?.[0]?.text || '';
        }
        else {
            const msg = data;
            content = msg?.choices?.[0]?.message?.content || '';
        }
        return {
            provider: provider.id,
            success: true,
            latencyMs: Date.now() - start,
            response: content.slice(0, 100),
            model,
        };
    }
    catch (err) {
        return {
            provider: provider.id,
            success: false,
            latencyMs: Date.now() - start,
            error: err instanceof Error ? err.message : String(err),
            model,
        };
    }
}
function printResult(result) {
    const icon = result.success ? chalk.green('PASS') : chalk.red('FAIL');
    const latency = chalk.gray(`${result.latencyMs}ms`);
    const model = result.model ? chalk.gray(` [${result.model}]`) : '';
    console.log(`    ${icon}  ${result.provider.padEnd(18)} ${latency}${model}`);
    if (result.success && result.response) {
        console.log(chalk.gray(`         Response: "${result.response}"`));
    }
    if (result.error) {
        console.log(chalk.red(`         Error: ${result.error}`));
    }
}
export function createTestCommand() {
    return new Command('test')
        .description('Test a provider by sending a test request')
        .argument('[provider-id]', 'Provider ID to test (e.g., openai, groq)')
        .option('--all', 'Test all registered providers')
        .option('--json', 'Output as JSON')
        .action(async (providerId, opts) => {
        // Check initialization
        if (!isInitialized()) {
            console.log();
            console.log(chalk.yellow('  DMR-X not initialized. Run "dmrx init" first.'));
            console.log();
            process.exit(1);
        }
        const config = loadConfig();
        if (!providerId && !opts.all) {
            console.log();
            console.log(chalk.white('  Usage:'));
            console.log(chalk.cyan('    dmrx test <provider-id>  ') + chalk.gray('# Test a specific provider'));
            console.log(chalk.cyan('    dmrx test --all          ') + chalk.gray('# Test all registered providers'));
            console.log();
            console.log(chalk.white('  Registered providers:'));
            if (config.providers.length === 0) {
                console.log(chalk.gray('    None. Add one with "dmrx providers add <id>"'));
            }
            else {
                for (const p of config.providers) {
                    console.log(chalk.gray(`    ${p.id}`));
                }
            }
            console.log();
            return;
        }
        const results = [];
        if (opts.all) {
            // Test all registered providers
            if (config.providers.length === 0) {
                console.log();
                console.log(chalk.yellow('  No providers registered. Add one with "dmrx providers add <id>"'));
                console.log();
                return;
            }
            console.log();
            console.log(chalk.bold.cyan('  Testing All Registered Providers'));
            console.log(chalk.gray('  ─────────────────────────────────'));
            console.log();
            for (const regProvider of config.providers) {
                if (!regProvider.enabled)
                    continue;
                const catalogEntry = getProvider(regProvider.id);
                if (!catalogEntry) {
                    results.push({
                        provider: regProvider.id,
                        success: false,
                        latencyMs: 0,
                        error: 'Provider not found in catalog',
                    });
                    continue;
                }
                const apiKey = catalogEntry.envKey ? getApiKey(catalogEntry.envKey) : undefined;
                const spinner = ora(`Testing ${regProvider.name}...`).start();
                const result = await testLLMProvider(catalogEntry, apiKey);
                spinner.stop();
                results.push(result);
                printResult(result);
            }
        }
        else {
            // Test specific provider
            const catalogEntry = getProvider(providerId);
            if (!catalogEntry) {
                console.log();
                console.log(chalk.red(`  Provider "${providerId}" not found in catalog.`));
                console.log();
                console.log(chalk.gray('  Use "dmrx providers list" to see available providers.'));
                console.log();
                process.exit(1);
            }
            console.log();
            console.log(chalk.bold.cyan(`  Testing ${catalogEntry.name}`));
            console.log(chalk.gray('  ─────────────────────────────'));
            console.log();
            const apiKey = catalogEntry.envKey ? getApiKey(catalogEntry.envKey) : undefined;
            const spinner = ora(`Sending test request...`).start();
            const result = await testLLMProvider(catalogEntry, apiKey);
            spinner.stop();
            results.push(result);
            printResult(result);
        }
        // Summary
        console.log();
        const passed = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        const total = results.length;
        console.log(chalk.white('  Results: ') + chalk.green(`${passed} passed`) + chalk.gray(', ') + chalk.red(`${failed} failed`) + chalk.gray(` of ${total}`));
        console.log();
        if (opts.json) {
            console.log(JSON.stringify(results, null, 2));
        }
        if (failed > 0) {
            process.exit(1);
        }
    });
}
//# sourceMappingURL=test.js.map