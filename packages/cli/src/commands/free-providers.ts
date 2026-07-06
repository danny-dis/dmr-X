/**
 * dmrx free-providers - Browse and add free AI providers
 *
 * Shows all providers with free tiers, filtered by category.
 * Provides one-liner commands to add any provider.
 */

import chalk from 'chalk';
import { Command } from 'commander';

import { PROVIDER_CATALOG, type ProviderCategory } from '../catalog.js';
import { isInitialized } from '../config.js';

interface FreeProviderInfo {
  id: string;
  name: string;
  description: string;
  categories: ProviderCategory[];
  freeModels: string[];
  totalModels: number;
  isLocal: boolean;
  website: string;
}

function getFreeProviders(): FreeProviderInfo[] {
  return PROVIDER_CATALOG
    .filter((p) => p.freeModels.length > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      categories: p.category,
      freeModels: p.freeModels,
      totalModels: p.models.length,
      isLocal: p.envKey === '',
      website: p.website,
    }))
    .sort((a, b) => b.freeModels.length - a.freeModels.length);
}

function formatRateLimitHint(provider: FreeProviderInfo): string {
  const hints: Record<string, string> = {
    'groq': '30 RPM, 14.4K RPD (Llama 8B)',
    'cerebras': '30 RPM, 1M TPD',
    'sambanova': '80 RPM (Llama), 20 RPM others',
    'google': '5-30 RPM, 250K TPM',
    'github-models': '15 RPM, 150 RPD',
    'cloudflare-ai': '10K neurons/day',
    'nvidia-nim': '5-40 RPM',
    'openrouter-free': '20 RPM, 200 RPD',
    'mistral': '60 RPM (free models)',
    'pollinations': '30 RPM, no key needed',
    'siliconflow': '1000 RPM, 50K TPM',
    'scaleway': '1M tokens/model',
    'ovhcloud': '2 RPM anonymous',
    'llm7': '150M tokens/month',
    'deepinfra': '5 RPM, 500 RPD',
    'zhipu': '60 RPM (GLM Flash)',
    'baidu': '60 RPM, 50M TPD',
    'qwen-dashscope': '120 RPM, 1M tokens/day',
    'tencent': '60 RPM, 50M TPD',
    'baichuan': '60 RPM, 50M TPD',
    'iflytek': '60 RPM, 50M TPD',
    'bytedance': '60 RPM, 50M TPD',
    'nebius': '$1 free credits',
    'hyperbolic': '$1 free credits',
    'baseten': '$30 free credits',
    'modal': '$30/month free GPU',
    'aion-labs': '15 RPM, 20K TPD',
    'kilo': '10 RPM auto-routing',
    'reka': '10 RPM, 500 RPD',
    'featherless': '10 RPM, 500 RPD',
    'kluster': 'unlimited',
    'ollama-cloud': '10 RPM',
    'nomic': '100 RPM embeddings',
    'jina': '200 RPM embeddings',
    'cartesia': '5 RPM TTS',
    'deepgram': '$200 free credits STT',
    'elevenlabs': '10K chars/month TTS',
    'codestral-free': '30 RPM, 2K RPD',
    'opencode-zen': '10-20 RPM',
    'novita': 'unlimited',
    'nlp-cloud': 'unlimited',
    'perplexity': '5 RPM, 100 RPD',
    'ai21': '$10 free credits',
    'upstage': 'unlimited',
    'vercel-ai': 'unlimited',
    'inference-net': 'unlimited',
    'aghes': '30 RPM',
    'routeway': '5 RPM, 200 RPD',
    'bazaarlink': '10 RPM, 500 RPD',
    'ainative': '10 RPM, 500 RPD',
    'sarvam': 'unlimited',
    'yi': 'unlimited',
    'moonshot': 'unlimited',
  };
  return hints[provider.id] || '';
}

export function createFreeProvidersCommand(): Command {
  return new Command('free')
    .description('Browse free AI providers and add them with one command')
    .option('-c, --category <cat>', 'Filter by category (llm, embedding, audio_tts, audio_stt, image, video)')
    .option('--top <n>', 'Show top N providers by free model count', parseInt)
    .option('--add <id>', 'Add a free provider directly (skip listing)')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      let providers = getFreeProviders();

      // Direct add mode
      if (opts.add) {
        const provider = providers.find((p) => p.id === opts.add);
        if (!provider) {
          console.log();
          console.log(chalk.red(`  Provider "${opts.add}" not found or has no free models.`));
          console.log();
          console.log(chalk.white('  Available free providers:'));
          for (const p of providers.slice(0, 10)) {
            console.log(chalk.gray(`    ${p.id}`) + chalk.gray(` — ${p.freeModels.length} free models`));
          }
          console.log();
          console.log(chalk.gray('  Run "dmrx free" to see all free providers.'));
          console.log();
          process.exit(1);
        }

        console.log();
        console.log(chalk.green.bold(`  Adding ${provider.name}...`));
        console.log();

        if (provider.isLocal) {
          console.log(chalk.cyan(`  dmrx providers add ${provider.id} --no-key`));
        } else {
          console.log(chalk.cyan(`  dmrx providers add ${provider.id}`));
        }
        console.log();
        console.log(chalk.gray('  Free models:'), provider.freeModels.slice(0, 5).join(', '));
        if (provider.freeModels.length > 5) {
          console.log(chalk.gray('               '), `... and ${provider.freeModels.length - 5} more`);
        }
        console.log();

        if (!isInitialized()) {
          console.log(chalk.yellow('  DMR-X not initialized. Run "dmrx init" first.'));
          console.log();
        }
        return;
      }

      // Filter by category
      if (opts.category) {
        const cat = opts.category as ProviderCategory;
        providers = providers.filter((p) => p.categories.includes(cat));
      }

      // Top N
      if (opts.top) {
        providers = providers.slice(0, opts.top);
      }

      // JSON output
      if (opts.json) {
        const output = providers.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          categories: p.categories,
          freeModels: p.freeModels,
          freeModelCount: p.freeModels.length,
          totalModels: p.totalModels,
          isLocal: p.isLocal,
          rateLimitHint: formatRateLimitHint(p),
        }));
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Table output
      const totalFreeModels = providers.reduce((sum, p) => sum + p.freeModels.length, 0);

      console.log();
      console.log(chalk.bold.green('  Free AI Providers'));
      console.log(chalk.gray(`  ${providers.length} providers · ${totalFreeModels} free models`));
      console.log(chalk.gray('  ─────────────────────────────────────────────'));
      console.log();

      // Group by category
      const categoryOrder: ProviderCategory[] = ['llm', 'embedding', 'audio_tts', 'audio_stt', 'image', 'video'];
      const categoryLabels: Record<string, string> = {
        llm: 'LLM',
        embedding: 'Embedding',
        audio_tts: 'Text-to-Speech',
        audio_stt: 'Speech-to-Text',
        image: 'Image Generation',
        video: 'Video Generation',
      };

      for (const cat of categoryOrder) {
        const catProviders = providers.filter((p) => p.categories.includes(cat));
        if (catProviders.length === 0) continue;

        console.log(chalk.bold.cyan(`  ${categoryLabels[cat] || cat} (${catProviders.length})`));
        console.log(chalk.gray('  ' + '─'.repeat(50)));

        for (const p of catProviders) {
          const rateHint = formatRateLimitHint(p);
          const localTag = p.isLocal ? chalk.blue(' [local]') : '';
          const freeCount = chalk.green(`${p.freeModels.length} free`);

          console.log(`    ${chalk.bold.white(p.name)}${localTag} ${chalk.gray(`(${p.id})`)}`);
          console.log(chalk.gray(`      ${p.description}`));
          console.log(`      Models: ${freeCount} / ${p.totalModels} total`);
          if (rateHint) {
            console.log(chalk.gray(`      Limits: ${rateHint}`));
          }
          console.log(chalk.cyan(`      Add:    dmrx providers add ${p.id}`));
          console.log();
        }
      }

      // Summary
      console.log(chalk.gray('  ─────────────────────────────────────────────'));
      console.log();
      console.log(chalk.white('  Quick start:'));
      console.log(chalk.cyan('    dmrx providers add groq') + chalk.gray('          # Fastest free inference'));
      console.log(chalk.cyan('    dmrx providers add cerebras') + chalk.gray('       # Ultra-fast, 1M TPD'));
      console.log(chalk.cyan('    dmrx providers add google') + chalk.gray('         # Best free tier overall'));
      console.log(chalk.cyan('    dmrx providers add openrouter-free') + chalk.gray(' # 21+ free models'));
      console.log(chalk.cyan('    dmrx providers add github-models') + chalk.gray('  # GPT-5, o3 free'));
      console.log(chalk.cyan('    dmrx providers add pollinations') + chalk.gray('    # No API key needed'));
      console.log();
    });
}
