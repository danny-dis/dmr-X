/**
 * Plugin Loader — discovers, loads, and composes plugins into DMR-X.
 *
 * Key principle: the loader imports plugins dynamically; plugins never
 * statically import the gateway or router. Dependency injection is the
 * only coupling mechanism.
 */

import { Plugin, PluginManifest } from './plugin.js';
import { readFileSync, readdirSync, statSync, existsSync as fsExistsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// __dirname workaround for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface PluginLoaderConfig {
  pluginsDir?: string;                  // e.g. "services/plugins"
  enabledPlugins?: string[];            // explicit allow-list
  pluginOverrides?: Record<string, { http?: { port?: number } }>;
}

export class PluginLoader {
  private plugins: Map<string, Plugin> = new Map();
  private manifests: Map<string, PluginManifest> = new Map();

  async load(config?: PluginLoaderConfig): Promise<PluginManifest[]> {
    const pluginDirs = this.discoverPlugins(config?.pluginsDir);
    const manifests: PluginManifest[] = [];

    for (const pluginDir of pluginDirs) {
      const manifest = this.loadManifest(pluginDir);
      if (config?.enabledPlugins && !config.enabledPlugins.includes(manifest.id)) {
        continue;
      }
      this.manifests.set(manifest.id, manifest);

      const pluginModule = await this.dynamicImport(pluginDir, manifest.id) as any;
      const plugin: Plugin = pluginModule.default ?? (pluginModule as Plugin);

      // TODO: Implement dependency injection wrapping
      // For now, we'll call init with undefined deps - this will be implemented properly
      // when we integrate with the gateway
      try {
        await plugin.init({} as any);
      } catch (error) {
        console.error(`Failed to initialize plugin ${manifest.id}:`, error);
        continue;
      }
      this.plugins.set(manifest.id, plugin);
      manifests.push(manifest);

      if (plugin.start) {
        try {
          await plugin.start();
        } catch (error) {
          console.error(`Failed to start plugin ${manifest.id}:`, error);
        }
      }
    }

    return manifests;
  }

  async stopAll(): Promise<void> {
    for (const [id, plugin] of this.plugins) {
      if (plugin.stop) {
        try {
          await plugin.stop();
        } catch (error) {
          // @ts-ignore - manifest is not in scope here, but we can use id
          console.error(`Failed to stop plugin ${id}:`, error);
        }
      }
    }
  }

  private discoverPlugins(pluginsDir?: string): string[] {
    const baseDir = pluginsDir || join(__dirname, '..', '..', '..', '..', 'services');
    const pluginDirs: string[] = [];

    try {
      const entries = readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const pluginPath = join(baseDir, entry.name);
          // Check if it looks like a plugin directory (has package.json or index.ts)
          if (this.isPluginDirectory(pluginPath)) {
            pluginDirs.push(pluginPath);
          }
        }
      }
    } catch (error) {
      console.error('Error discovering plugins:', error);
    }

    return pluginDirs;
  }

  private isPluginDirectory(dir: string): boolean {
    try {
      const packageJsonPath = join(dir, 'package.json');
      const indexTsPath = join(dir, 'src', 'index.ts');
      const indexJsPath = join(dir, 'dist', 'index.js');
      
      return (
        fsExistsSync(packageJsonPath) ||
        fsExistsSync(indexTsPath) ||
        fsExistsSync(indexJsPath)
      );
    } catch (error) {
      return false;
    }
  }

  private loadManifest(pluginDir: string): PluginManifest {
    // Try to load from package.json first
    const packageJsonPath = join(pluginDir, 'package.json');
    if (fsExistsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      return {
        id: packageJson.name || 'unknown',
        name: packageJson.description || packageJson.name || 'Unknown Plugin',
        version: packageJson.version || '0.1.0',
        description: packageJson.description || '',
        transport: { type: 'stdio' }, // default
        permissions: {
          accessModalities: [],
          canRegisterAdapters: false,
          canReadCandidates: false,
          canAccessDatabase: false
        }
      };
    }

    // Fallback: look for manifest.ts or manifest.js
    const manifestPaths = [
      join(pluginDir, 'manifest.ts'),
      join(pluginDir, 'manifest.js'),
      join(pluginDir, 'src', 'manifest.ts'),
      join(pluginDir, 'src', 'manifest.js')
    ];

    for (const manifestPath of manifestPaths) {
      if (fsExistsSync(manifestPath)) {
        // In a real implementation, we would dynamically import the manifest
        // For now, return a default manifest
        return {
          id: 'unknown',
          name: 'Unknown Plugin',
          version: '0.1.0',
          description: '',
          transport: { type: 'stdio' },
          permissions: {
            accessModalities: [],
            canRegisterAdapters: false,
            canReadCandidates: false,
            canAccessDatabase: false
          }
        };
      }
    }

    // Default manifest
    return {
      id: 'unknown',
      name: 'Unknown Plugin',
      version: '0.1.0',
      description: '',
      transport: { type: 'stdio' },
      permissions: {
        accessModalities: [],
        canRegisterAdapters: false,
        canReadCandidates: false,
        canAccessDatabase: false
      }
    };
  }

  private async dynamicImport(pluginDir: string, pluginId: string): Promise<unknown> {
    // Try several entry points
    const entryPaths = [
      join(pluginDir, 'src', 'index.ts'),
      join(pluginDir, 'index.ts'),
      join(pluginDir, 'src', 'plugin.ts'),
      join(pluginDir, 'plugin.ts')
    ];

    for (const entryPath of entryPaths) {
      if (fsExistsSync(entryPath)) {
        try {
          // Use dynamic import() - no static coupling
          return import(entryPath);
        } catch (error) {
          console.error(`Failed to import plugin ${pluginId} from ${entryPath}:`, error);
          // Continue to try other paths
        }
      }
    }

    throw new Error(`Could not find entry point for plugin ${pluginId}`);
  }
}
