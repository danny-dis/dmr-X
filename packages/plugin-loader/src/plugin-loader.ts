/**
 * Plugin Loader — discovers, loads, and composes plugins into DMR-X.
 *
 * Key principle: the loader imports plugins dynamically; plugins never
 * statically import the gateway or router. Dependency injection is the
 * only coupling mechanism.
 */

import { readFileSync, readdirSync, statSync, existsSync as fsExistsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Plugin, PluginManifest } from './plugin.js';

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
      const manifest = await this.loadManifest(pluginDir);
      if (manifest.error) {
        console.error(`Skipping plugin at ${pluginDir}: ${manifest.error}`);
        continue;
      }
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

  private async loadManifest(pluginDir: string): Promise<PluginManifest> {
    // 1. Canonical manifest file (dmrx.plugin.json or manifest.json)
    const jsonManifestPaths = [
      join(pluginDir, 'dmrx.plugin.json'),
      join(pluginDir, 'manifest.json'),
    ];
    for (const manifestPath of jsonManifestPaths) {
      if (fsExistsSync(manifestPath)) {
        try {
          const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
          return this.normalizeJsonManifest(raw, pluginDir);
        } catch (error) {
          return this.unknownManifest(pluginDir, `Failed to parse ${manifestPath}: ${(error as Error).message}`);
        }
      }
    }

    // 2. Module manifest (manifest.ts / manifest.js) — dynamic import
    const moduleManifestPaths = [
      join(pluginDir, 'manifest.ts'),
      join(pluginDir, 'manifest.js'),
      join(pluginDir, 'src', 'manifest.ts'),
      join(pluginDir, 'src', 'manifest.js'),
    ];
    for (const manifestPath of moduleManifestPaths) {
      if (fsExistsSync(manifestPath)) {
        try {
          const mod = await import(manifestPath);
          const raw = (mod as { default?: unknown }).default ?? mod;
          return this.normalizeJsonManifest(raw, pluginDir);
        } catch (error) {
          return this.unknownManifest(pluginDir, `Failed to load ${manifestPath}: ${(error as Error).message}`);
        }
      }
    }

    // 3. Fallback: package.json identity (optionally under a "dmrx" key)
    const packageJsonPath = join(pluginDir, 'package.json');
    if (fsExistsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        const dmrx = packageJson.dmrx ?? {};
        return {
          id: packageJson.name || 'unknown',
          name: dmrx.name || packageJson.description || packageJson.name || 'Unknown Plugin',
          version: packageJson.version || '0.1.0',
          description: dmrx.description || packageJson.description || '',
          transport: dmrx.transport ?? { type: 'stdio' },
          tools: dmrx.tools,
          permissions: dmrx.permissions ?? {
            accessModalities: [],
            canRegisterAdapters: false,
            canReadCandidates: false,
            canAccessDatabase: false,
          },
        };
      } catch (error) {
        return this.unknownManifest(pluginDir, `Failed to parse ${packageJsonPath}: ${(error as Error).message}`);
      }
    }

    // 4. Nothing readable — fail with an explicit error instead of a fake manifest
    return this.unknownManifest(pluginDir, `No manifest or package.json found at ${pluginDir}`);
  }

  private normalizeJsonManifest(raw: unknown, pluginDir: string): PluginManifest {
    if (!raw || typeof raw !== 'object' || typeof (raw as { id?: unknown }).id !== 'string' ||
        (raw as { id: string }).id.trim() === '') {
      return this.unknownManifest(pluginDir, `Manifest at ${pluginDir} is missing a non-empty "id"`);
    }

    const source = raw as Record<string, any>;
    const manifest: PluginManifest = {
      id: source.id,
      name: typeof source.name === 'string' ? source.name : source.id,
      version: typeof source.version === 'string' ? source.version : '0.1.0',
      description: typeof source.description === 'string' ? source.description : '',
      transport: {
        type: ['stdio', 'sse', 'http', 'embedded'].includes(source.transport?.type) ? source.transport.type : 'stdio',
        ...(source.transport?.type === 'http' && source.transport?.http ? { http: source.transport.http } : {}),
      },
    };

    if (Array.isArray(source.tools)) {
      const tools = source.tools
        .map((t: any) => ({
          name: String(t?.name ?? ''),
          description: String(t?.description ?? ''),
          inputSchema: t?.inputSchema ?? {},
        }))
        .filter((t: { name: string }) => t.name.length > 0);
      if (tools.length > 0) manifest.tools = tools;
    }

    if (source.permissions && typeof source.permissions === 'object') {
      manifest.permissions = {
        accessModalities: Array.isArray(source.permissions.accessModalities) ? source.permissions.accessModalities : [],
        canRegisterAdapters: Boolean(source.permissions.canRegisterAdapters),
        canReadCandidates: Boolean(source.permissions.canReadCandidates),
        canAccessDatabase: Boolean(source.permissions.canAccessDatabase),
      };
    }

    return manifest;
  }

  private unknownManifest(pluginDir: string, error: string): PluginManifest {
    return {
      id: 'unknown',
      name: 'Unknown Plugin',
      version: '0.1.0',
      description: '',
      transport: { type: 'stdio' },
      error,
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
