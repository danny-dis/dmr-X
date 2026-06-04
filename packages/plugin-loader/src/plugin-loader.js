"use strict";
/**
 * Plugin Loader — discovers, loads, and composes plugins into DMR-X.
 *
 * Key principle: the loader imports plugins dynamically; plugins never
 * statically import the gateway or router. Dependency injection is the
 * only coupling mechanism.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginLoader = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_url_1 = require("node:url");
class PluginLoader {
    plugins = new Map();
    manifests = new Map();
    async load(config) {
        const pluginDirs = this.discoverPlugins(config?.pluginsDir);
        const manifests = [];
        for (const pluginDir of pluginDirs) {
            const manifest = this.loadManifest(pluginDir);
            if (config?.enabledPlugins && !config.enabledPlugins.includes(manifest.id)) {
                continue;
            }
            this.manifests.set(manifest.id, manifest);
            const pluginModule = await this.dynamicImport(pluginDir, manifest.id);
            const plugin = pluginModule.default ?? pluginModule;
            // TODO: Implement dependency injection wrapping
            // For now, we'll call init with undefined deps - this will be implemented properly
            // when we integrate with the gateway
            try {
                await plugin.init({});
            }
            catch (error) {
                console.error(`Failed to initialize plugin ${manifest.id}:`, error);
                continue;
            }
            this.plugins.set(manifest.id, plugin);
            manifests.push(manifest);
            if (plugin.start) {
                try {
                    await plugin.start();
                }
                catch (error) {
                    console.error(`Failed to start plugin ${manifest.id}:`, error);
                }
            }
        }
        return manifests;
    }
    async stopAll() {
        for (const [id, plugin] of this.plugins) {
            if (plugin.stop) {
                try {
                    await plugin.stop();
                }
                catch (error) {
                    console.error(`Failed to stop plugin ${manifest.id}:`, error);
                }
            }
        }
    }
    discoverPlugins(pluginsDir) {
        const baseDir = pluginsDir || (0, node_path_1.join)((0, node_path_1.dirname)((0, node_url_1.fileURLToPath)(import.meta.url)), '..', '..', '..', 'services');
        const pluginDirs = [];
        try {
            const entries = (0, node_fs_1.readdirSync)(baseDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const pluginPath = (0, node_path_1.join)(baseDir, entry.name);
                    // Check if it looks like a plugin directory (has package.json or index.ts)
                    if (this.isPluginDirectory(pluginPath)) {
                        pluginDirs.push(pluginPath);
                    }
                }
            }
        }
        catch (error) {
            console.error('Error discovering plugins:', error);
        }
        return pluginDirs;
    }
    isPluginDirectory(dir) {
        try {
            const packageJsonPath = (0, node_path_1.join)(dir, 'package.json');
            const indexTsPath = (0, node_path_1.join)(dir, 'src', 'index.ts');
            const indexJsPath = (0, node_path_1.join)(dir, 'dist', 'index.js');
            return (existsSync(packageJsonPath) ||
                existsSync(indexTsPath) ||
                existsSync(indexJsPath));
        }
        catch (error) {
            return false;
        }
    }
    loadManifest(pluginDir) {
        // Try to load from package.json first
        const packageJsonPath = (0, node_path_1.join)(pluginDir, 'package.json');
        if (existsSync(packageJsonPath)) {
            const packageJson = JSON.parse((0, node_fs_1.readFileSync)(packageJsonPath, 'utf8'));
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
            (0, node_path_1.join)(pluginDir, 'manifest.ts'),
            (0, node_path_1.join)(pluginDir, 'manifest.js'),
            (0, node_path_1.join)(pluginDir, 'src', 'manifest.ts'),
            (0, node_path_1.join)(pluginDir, 'src', 'manifest.js')
        ];
        for (const manifestPath of manifestPaths) {
            if (existsSync(manifestPath)) {
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
    async dynamicImport(pluginDir, pluginId) {
        // Try several entry points
        const entryPaths = [
            (0, node_path_1.join)(pluginDir, 'src', 'index.ts'),
            (0, node_path_1.join)(pluginDir, 'index.ts'),
            (0, node_path_1.join)(pluginDir, 'src', 'plugin.ts'),
            (0, node_path_1.join)(pluginDir, 'plugin.ts')
        ];
        for (const entryPath of entryPaths) {
            if (existsSync(entryPath)) {
                try {
                    // Use dynamic import() - no static coupling
                    return import(entryPath);
                }
                catch (error) {
                    console.error(`Failed to import plugin ${pluginId} from ${entryPath}:`, error);
                    // Continue to try other paths
                }
            }
        }
        throw new Error(`Could not find entry point for plugin ${pluginId}`);
    }
}
exports.PluginLoader = PluginLoader;
function existsSync(path) {
    try {
        return (0, node_fs_1.statSync)(path).isFile();
    }
    catch (error) {
        return false;
    }
}
//# sourceMappingURL=plugin-loader.js.map