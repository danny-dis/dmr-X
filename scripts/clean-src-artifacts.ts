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

const BUILD_ARTIFACTS = ['.js', '.d.ts', '.js.map', '.d.ts.map'];
const SRC_DIR = 'src';

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
 * Remove build artifact files from a directory
 */
async function cleanDirectory(dirPath: string): Promise<void> {
  try {
    const entries = await import('node:fs/promises').then(fs => fs.readdir(dirPath, { withFileTypes: true }));
    
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        await cleanDirectory(fullPath);
      } else if (entry.isFile()) {
        for (const ext of BUILD_ARTIFACTS) {
          if (entry.name.endsWith(ext)) {
            await import('node:fs/promises').then(fs => fs.unlink(fullPath));
            console.log(`Removed: ${fullPath}`);
          }
        }
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
        
        if (entry.name === SRC_DIR && entry.isDirectory()) {
          srcDirs.push(fullPath);
        } else if (entry.isDirectory()) {
          if (!['node_modules', 'dist', '.git', '.turbo', '.bun', 'jan-repo', 'temp-clawrouter'].includes(entry.name)) {
            await walk(fullPath);
          }
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
