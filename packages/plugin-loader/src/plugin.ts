/**
 * Minimal plugin contracts for DMR-X.
 *
 * These interfaces live in a dedicated package so plugins can depend on
 * the contract without circular-importing any DMR-X implementation package.
 */

export interface PluginDependencies {
  /** DMR-X routing engine — plugins call route() to dispatch requests */
  router: {
    route(request: UnifiedRequest, options: ClassifyOptions): Promise<RouteResult>;
    setCandidates(candidates: CandidateSet): void;
    setAdapterExecutor(executor: AdapterExecutor): void;
    getCandidateCount(): number;
  };
  /** Adapter registry — plugins register adapters and look them up */
  adapterRegistry: {
    register(adapter: ProviderAdapter): void;
    get(providerId: string): ProviderAdapter | undefined;
    list(): string[];
    initialize(providerId: string, config: ProviderConfig): Promise<void>;
  };
  /** Shared state bag — plugins can store/read persist data */
  stateStore: StateStore;
  /** Node-style logger */
  logger: Logger;
  /** Environment/config accessor */
  config: Record<string, string | undefined>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  transport: PluginTransportConfig;
  tools?: PluginToolDefinition[];
  permissions?: PluginPermissions;
}

export interface PluginTransportConfig {
  type: 'stdio' | 'sse' | 'http' | 'embedded';
  http?: { port: number; host: string };
}

export interface PluginToolDefinition {
  name: string;
  description: string;
  inputSchema: SchemaLike;              // Zod-compatible
}

export interface PluginPermissions {
  accessModalities: Modality[];
  canRegisterAdapters: boolean;
  canReadCandidates: boolean;
  canAccessDatabase: boolean;
}

export interface Plugin {
  /** Unique plugin ID */
  readonly id: string;
  /** Load dependencies injected by the loader */
  init(deps: PluginDependencies): Promise<void> | void;
  /** Start plugin (e.g., open SSE port, begin listening on stdio) */
  start?(): Promise<void> | void;
  /** Stop plugin and release resources */
  stop?(): Promise<void> | void;
}

export interface StateStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

/**
 * Types that are referenced but not defined in this file.
 * These are imported from @dmr-x/core in the implementation.
 */
// These are placeholder types - the actual types will be imported from core
export type UnifiedRequest = any;
export type ClassifyOptions = any;
export type RouteResult = any;
export type CandidateSet = any;
export type AdapterExecutor = any;
export type ProviderAdapter = any;
export type ProviderConfig = any;
export type Logger = any;
export type SchemaLike = any;
export type Modality = any;