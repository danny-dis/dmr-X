/**
 * Clean up compiled TypeScript artifacts from src directories
 * 
 * This script removes .js, .d.ts, .js.map, and .d.ts.map files from all
 * src directories in the project. These files are build artifacts that
 * should only exist in dist directories, not alongside .ts source files.
 * 
 * This prevents build issues where TypeScript tries to compile declaration files
 * or where imports from .js files in src fail in CI environments.
 * 
 * Usage:
 *   - From project root: bun run scripts/clean-src-artifacts.js
 *   - From any package: bun run ../../scripts/clean-src-artifacts.js
 */

import { join, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

// Longest-first so `.d.ts.map` and `.js.map` match before `.d.ts` / `.js`.
const BUILD_ARTIFACTS = ['.d.ts.map', '.js.map', '.d.ts', '.js'];
const SRC_DIR = 'src';

/**
 * Directories never worth descending into. `.venv` alone holds thousands of
 * Python site-package dirs named `src`, which made every `clean:src` run (and
 * therefore every build/test/dev start) walk the whole virtualenv.
 */
const SKIP_DIRS = [
  'node_modules', 'dist', '.git', '.turbo', '.bun', '.venv', '__pycache__',
  '.gitnexus', '.hermes', '.dmrx-data', '.dmrx-data-mcp', '.ruff_cache',
  'jan-repo', 'temp-clawrouter',
];

/**
 * Remove a file if it exists
 */
async function removeFile(filePath: string): Promise<boolean> {
  try {
    await import('node:fs/promises').then(fs => fs.unlink(filePath));
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Remove build artifact files from a directory.
 *
 * A file only counts as an artifact when a sibling TypeScript source with the
 * same basename exists — `foo.js`/`foo.d.ts` are emitted from `foo.ts`. Files
 * without that sibling are hand-written and must be preserved: deleting every
 * `.d.ts` unconditionally removed `apps/ui/src/vite-env.d.ts` (Vite's ambient
 * client types) on every build, test, and dev run.
 */
async function cleanDirectory(dirPath: string): Promise<void> {
  try {
    const fs = await import('node:fs/promises');
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const names = new Set(entries.filter(e => e.isFile()).map(e => e.name));

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.includes(entry.name)) {
          await cleanDirectory(fullPath);
        }
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = BUILD_ARTIFACTS.find(e => entry.name.endsWith(e));
      if (!ext) continue;

      const base = entry.name.slice(0, -ext.length);
      if (!names.has(`${base}.ts`) && !names.has(`${base}.tsx`)) {
        continue; // hand-written, not a compiled artifact
      }

      try {
        await fs.unlink(fullPath);
        console.log(`Removed: ${fullPath}`);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`Error cleaning ${dirPath}:`, (error as Error).message);
    }
  }
}

/**
 * Find all src directories in the project
 */
async function findSrcDirectories(rootDir: string): Promise<string[]> {
  const srcDirs: string[] = [];
  
  async function walk(dir: string): Promise<void> {
    try {
      const entries = await import('node:fs/promises').then(fs => fs.readdir(dir, { withFileTypes: true }));
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        if (!entry.isDirectory() || SKIP_DIRS.includes(entry.name)) continue;

        if (entry.name === SRC_DIR) {
          srcDirs.push(fullPath);
        } else {
          await walk(fullPath);
        }
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Error walking ${dir}:`, (error as Error).message);
      }
    }
  }
  
  const normalizedRoot = rootDir.replace(/\\/g, '/');
  await walk(normalizedRoot);
  return srcDirs;
}

/**
 * Find the project root by looking for package.json
 */
function findProjectRoot(startDir: string): string {
  let currentDir = startDir;
  
  while (currentDir) {
    try {
      const packagePath = join(currentDir, 'package.json');
      if (existsSync(packagePath)) {
        const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
        if (pkg.workspaces) {
          return currentDir;
        }
      }
    } catch {
      // Continue searching
    }
    
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return currentDir;
    }
    currentDir = parentDir;
  }
  
  return startDir;
}

/**
 * Main function
 */
async function main() {
  const projectRoot = findProjectRoot(process.cwd());
  const currentDir = process.cwd();
  
  const relativePath = currentDir.replace(projectRoot, '').replace(/\\/g, '/');
  const pathParts = relativePath.split('/').filter(Boolean);
  
  let srcDirsToClean: string[];
  if (pathParts.length > 0 && ['packages', 'apps', 'services'].includes(pathParts[0])) {
    const packagePath = join(projectRoot, pathParts[0], pathParts.slice(1).join('/'));
    const srcDir = join(packagePath, 'src');
    if (existsSync(srcDir)) {
      srcDirsToClean = [srcDir];
      console.log(`Cleaning src directory for ${relativePath}`);
    } else {
      srcDirsToClean = [];
    }
  } else {
    srcDirsToClean = await findSrcDirectories(projectRoot);
    console.log('Cleaning up TypeScript build artifacts from all src directories...');
  }
  
  if (srcDirsToClean.length === 0) {
    console.log('No src directories to clean.');
    return;
  }
  
  console.log(`Cleaning ${srcDirsToClean.length} src director${srcDirsToClean.length === 1 ? 'y' : 'ies'}:`);
  for (const dir of srcDirsToClean) {
    console.log(`  - ${dir}`);
  }
  
  for (const srcDir of srcDirsToClean) {
    await cleanDirectory(srcDir);
  }
  
  console.log('Cleanup complete.');
}

main().catch((error: unknown) => {
  console.error('Cleanup failed:', error);
  process.exit(1);
});
