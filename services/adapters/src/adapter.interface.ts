import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';

export interface HealthStatus {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

export interface ModelInfo {
  modelId: string;
  modality: Modality;
  capabilities: string[];
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
  [key: string]: unknown;
}

export interface ExecuteOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProviderAdapter {
  readonly providerId: string;
  readonly supportedModalities: Modality[];

  initialize(config: ProviderConfig): Promise<void>;
  healthCheck(): Promise<HealthStatus>;

  execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse>;
  executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk>;

  listModels(): Promise<ModelInfo[]>;

  dispose(): Promise<void>;
}
