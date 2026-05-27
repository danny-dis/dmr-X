/**
 * DMR-X Configuration Manager
 *
 * Manages .dmrx/ directory, config.json, and .env file.
 */
export interface DMRXConfig {
    version: string;
    project: {
        name: string;
        created: string;
    };
    providers: RegisteredProvider[];
    defaults: {
        llm: string | null;
        image: string | null;
        embedding: string | null;
        audio_tts: string | null;
        audio_stt: string | null;
        video: string | null;
        music: string | null;
    };
    settings: {
        maxRetries: number;
        timeoutMs: number;
        logLevel: string;
    };
}
export interface RegisteredProvider {
    id: string;
    name: string;
    enabled: boolean;
    addedAt: string;
    models: string[];
    isLocal: boolean;
}
export declare function getDMRXDir(cwd?: string): string;
export declare function getConfigPath(cwd?: string): string;
export declare function getEnvPath(cwd?: string): string;
export declare function getDockerComposePath(cwd?: string): string;
export declare function isInitialized(cwd?: string): boolean;
export declare function createDefaultConfig(projectName: string): DMRXConfig;
export declare function loadConfig(cwd?: string): DMRXConfig;
export declare function saveConfig(config: DMRXConfig, cwd?: string): void;
export declare function ensureEnvFile(cwd?: string): string;
export declare function setEnvVar(key: string, value: string, cwd?: string): void;
export declare function getEnvVar(key: string, cwd?: string): string | undefined;
export declare function initProject(projectName: string, cwd?: string): void;
export declare function createDockerCompose(cwd?: string): void;
//# sourceMappingURL=config.d.ts.map