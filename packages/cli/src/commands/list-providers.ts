/**
 * dmrx providers list - List available and registered providers
 *
 * Shows all 35+ providers from the catalog, highlights registered ones.
 */

import chalk from 'chalk';
import { Command } from 'commander';

import { PROVIDER_CATALOG, type ProviderCategory } from '../catalog.js';
import { isInitialized, loadConfig, type RegisteredProvider } from '../config.js';

const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  llm: 'LLM',
  image: 'Image',
  audio_tts: 'TTS',
  audio_stt: 'STT',
  video: 'Video',
  music: 'Music',
  embedding: 'Embedding',
  reranking: 'Reranking',
  moderation: 'Moderation',
  local: 'Local',
  multi: 'Multi',
};

const CATEGORY_COLORS: Record<ProviderCategory, typeof chalk.white> = {
  llm: chalk.cyan,
  image: chalk.magenta,
  audio_tts: chalk.yellow,
  audio_stt: chalk.yellow,
  video: chalk.blue,
  music: chalk.green,
  embedding: chalk.white,
  reranking: chalk.gray,
  moderation: chalk.red,
  local: chalk.green,
  multi: chalk.cyan,
};

function formatCategories(categories: ProviderCategory[]): string {
  return categories
    .map((c) => {
      const color = CATEGORY_COLORS[c] || chalk.white;
      return color(CATEGORY_LABELS[c] || c);
    })
    .join(chalk.gray(', '));
}

function formatModels(models: string[], max: number = 3): string {
  if (models.length === 0) return chalk.gray('none');
  const shown = models.slice(0, max);
  const rest = models.length > max ? chalk.gray(` +${models.length - max}`) : '';
  return chalk.gray(shown.join(', ')) + rest;
}

function isProviderRegistered(providerId: string, registered: RegisteredProvider[]): boolean {
  return registered.some((p) => p.id === providerId && p.enabled);
}

export function createListProvidersCommand(): Command {
  return new Command('list')
    .description('List all available providers from the catalog')
    .option('-c, --category <cat>', 'Filter by category (llm, image, audio_tts, etc.)')
    .option('--registered', 'Show only registered providers')
    .option('--free', 'Show only providers with free models')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      let providers = [...PROVIDER_CATALOG];
      let registered: RegisteredProvider[] = [];

      // Load registered providers if initialized
      if (isInitialized()) {
        const config = loadConfig();
        registered = config.providers;
      }

      // Apply filters
      if (opts.category) {
        const cat = opts.category as ProviderCategory;
        providers = providers.filter((p) => p.category.includes(cat));
      }

      if (opts.free) {
        providers = providers.filter((p) => p.freeModels.length > 0);
      }

      if (opts.registered) {
        providers = providers.filter((p) => isProviderRegistered(p.id, registered));
      }

      // JSON output
      if (opts.json) {
        const output = providers.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          category: p.category,
          models: p.models,
          freeModels: p.freeModels,
          registered: isProviderRegistered(p.id, registered),
          isLocal: p.envKey === '',
        }));
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Table output
      console.log();
      console.log(chalk.bold.cyan('  DMR-X Provider Catalog'));
      console.log(chalk.gray(`  ${providers.length} providers available`));

      if (registered.length > 0) {
        console.log(chalk.gray(`  ${registered.filter((r) => r.enabled).length} registered`));
      }
      console.log(chalk.gray('  ─────────────────────────────────────────────'));
      console.log();

      // Group by category
      const categories: ProviderCategory[] = [
        'llm',
        'image',
        'audio_tts',
        'audio_stt',
        'video',
        'music',
        'embedding',
        'reranking',
        'local',
      ];

      for (const cat of categories) {
        const catProviders = providers.filter((p) => p.category.includes(cat));
        if (catProviders.length === 0) continue;

        const color = CATEGORY_COLORS[cat] || chalk.white;
        console.log(color.bold(`  ${CATEGORY_LABELS[cat]} (${catProviders.length})`));
        console.log(chalk.gray('  ' + '─'.repeat(45)));

        for (const p of catProviders) {
          const isRegistered = isProviderRegistered(p.id, registered);
          const isLocal = p.envKey === '';
          const hasFree = p.freeModels.length > 0;

          const statusIcon = isRegistered
            ? chalk.green('●')
            : isLocal
              ? chalk.blue('○')
              : chalk.gray('○');

          const name = isRegistered ? chalk.bold.white(p.name) : chalk.white(p.name);
          const id = chalk.gray(`(${p.id})`);
          const badges: string[] = [];

          if (isRegistered) badges.push(chalk.green('registered'));
          if (isLocal) badges.push(chalk.blue('local'));
          if (hasFree) badges.push(chalk.yellow('free'));

          const badgeStr = badges.length > 0 ? chalk.gray(' [') + badges.join(chalk.gray(', ')) + chalk.gray(']') : '';

          console.log(`    ${statusIcon} ${name} ${id}${badgeStr}`);
          console.log(chalk.gray(`      ${p.description}`));
          console.log(chalk.gray(`      Models: ${formatModels(p.models)}`));
        }
        console.log();
      }

      // Legend
      console.log(chalk.gray('  Legend:'));
      console.log(chalk.green('    ●') + chalk.gray(' = registered  ') + chalk.blue('○') + chalk.gray(' = local  ') + chalk.gray('○') + chalk.gray(' = available'));
      console.log();

      // Usage hints
      console.log(chalk.white('  Commands:'));
      console.log(chalk.cyan('    dmrx providers add <id>    ') + chalk.gray('# Add a provider'));
      console.log(chalk.cyan('    dmrx providers list --free ') + chalk.gray('# Show free providers only'));
      console.log();
    });
}
