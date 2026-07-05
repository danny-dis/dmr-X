/**
 * dmrx init - Initialize a DMR-X project
 *
 * Creates .dmrx/ config directory, config.json, .env, and docker-compose.yml
 */

import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';


import { initProject, createDockerCompose, isInitialized, getDMRXDir } from '../config.js';

export function createInitCommand(): Command {
  return new Command('init')
    .description('Initialize a new DMR-X project in the current directory')
    .option('-n, --name <name>', 'Project name')
    .option('--no-docker', 'Skip docker-compose.yml generation')
    .option('-y, --yes', 'Accept defaults without prompting')
    .action(async (opts) => {
      console.log();
      console.log(chalk.bold.cyan('  DMR-X Project Initialization'));
      console.log(chalk.gray('  ─────────────────────────────'));
      console.log();

      // Check if already initialized
      if (isInitialized()) {
        console.log(chalk.yellow('  Project already initialized.'));
        console.log(chalk.gray(`  Config at: ${getDMRXDir()}`));
        console.log();
        console.log(chalk.white('  To reinitialize, delete the .dmrx/ directory first.'));
        console.log();
        return;
      }

      let projectName = opts.name;

      if (!projectName && !opts.yes) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'projectName',
            message: 'Project name:',
            default: 'my-dmrx-project',
            validate: (input: string) => {
              if (/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i.test(input) || input.length >= 2) {
                return true;
              }
              return 'Project name must be at least 2 characters';
            },
          },
        ]);
        projectName = answers.projectName;
      }

      projectName = projectName || 'my-dmrx-project';

      const spinner = ora('Initializing DMR-X project...').start();

      try {
        // Step 1: Create .dmrx directory and config
        spinner.text = 'Creating .dmrx/ configuration...';
        initProject(projectName);
        spinner.succeed('Created .dmrx/ with config.json and .env');

        // Step 2: Create docker-compose.yml
        if (opts.docker !== false) {
          const createDocker = opts.yes
            ? true
            : (
                await inquirer.prompt([
                  {
                    type: 'confirm',
                    name: 'docker',
                    message: 'Create docker-compose.yml for PostgreSQL and Redis?',
                    default: true,
                  },
                ])
              ).docker;

          if (createDocker) {
            spinner.start('Creating docker-compose.yml...');
            createDockerCompose();
            spinner.succeed('Created docker-compose.yml');
          }
        }

        console.log();
        console.log(chalk.green.bold('  DMR-X project initialized successfully!'));
        console.log();
        console.log(chalk.white('  Project structure:'));
        console.log(chalk.gray('  ├── .dmrx/'));
        console.log(chalk.gray('  │   └── config.json'));
        console.log(chalk.gray('  ├── .env'));
        if (opts.docker !== false) {
          console.log(chalk.gray('  └── docker-compose.yml'));
        }
        console.log();
        console.log(chalk.white('  Next steps:'));
        console.log(chalk.cyan('    dmrx providers list          ') + chalk.gray('# Browse available providers'));
        console.log(chalk.cyan('    dmrx providers add openai    ') + chalk.gray('# Add a provider'));
        console.log(chalk.cyan('    dmrx status                  ') + chalk.gray('# Check system status'));
        console.log();
      } catch (err) {
        spinner.fail('Initialization failed');
        console.error(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });
}
