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
import { readdir, unlink, stat } from 'node:fs/promises';

const BUILD_ARTIFACTS = ['.js', '.d.ts', '.js.map', '.d.ts.map'];
const SRC_DIR = 'src';

/**
 * Remove a file if it exists
 */
async function removeFile(filePath) {
  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Remove build artifact files from a directory
 */
async function cleanDirectory(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        // Recursively clean subdirectories
        await cleanDirectory(fullPath);
      } else if (entry.isFile()) {
        // Remove build artifact files
        for (const ext of BUILD_ARTIFACTS) {
          if (entry.name.endsWith(ext)) {
            await unlink(fullPath);
            console.log(`Removed: ${fullPath}`);
          }
        }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Error cleaning ${dirPath}:`, error.message);
    }
  }
}

/**
 * Find all src directories in the project
 */
async function findSrcDirectories(rootDir) {
  const srcDirs = [];
  
  async function walk(dir) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        if (entry.name === SRC_DIR && entry.isDirectory()) {
          srcDirs.push(fullPath);
        } else if (entry.isDirectory()) {
          // Skip node_modules and dist directories
          if (!['node_modules', 'dist', '.git', '.turbo', '.bun'].includes(entry.name)) {
            await walk(fullPath);
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`Error walking ${dir}:`, error.message);
      }
    }
  }
  
  // Normalize path to use forward slashes for consistency
  const normalizedRoot = rootDir.replace(/\\/g, '/');
  await walk(normalizedRoot);
  return srcDirs;
}

/**
 * Find the project root by looking for package.json
 */
function findProjectRoot(startDir) {
  let currentDir = startDir;
  
  while (currentDir) {
    try {
      // Check if package.json exists in this directory
      const packagePath = join(currentDir, 'package.json');
      if (require('fs').existsSync(packagePath)) {
        const pkg = JSON.parse(require('fs').readFileSync(packagePath, 'utf8'));
        // If this is the root package (has workspaces), return it
        if (pkg.workspaces) {
          return currentDir;
        }
      }
    } catch {
      // Continue searching
    }
    
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached the root directory
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
  // Find the project root by looking for the root package.json with workspaces
  const projectRoot = findProjectRoot(process.cwd());
  const currentDir = process.cwd();
  
  // Determine if we should clean only the current package or all packages
  // If run from a package directory (packages/*/ or apps/*/ or services/*/), clean only that package
  // Otherwise, clean all src directories
  const relativePath = currentDir.replace(projectRoot, '').replace(/\\/g, '/');
  const pathParts = relativePath.split('/').filter(Boolean);
  
  let srcDirsToClean;
  if (pathParts.length > 0 && ['packages', 'apps', 'services'].includes(pathParts[0])) {
    // Running from a specific package/app/service - only clean its src directory
    const packagePath = join(projectRoot, pathParts[0], pathParts.slice(1).join('/'));
    const srcDir = join(packagePath, 'src');
    if (require('fs').existsSync(srcDir)) {
      srcDirsToClean = [srcDir];
      console.log(`Cleaning src directory for ${relativePath}`);
    } else {
      srcDirsToClean = [];
    }
  } else {
    // Running from project root - clean all src directories
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

main().catch(error => {
  console.error('Cleanup failed:', error);
  process.exit(1);
});
