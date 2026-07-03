/**
 * Godmode Service — wraps G0DM0D3 API for DMR-X integration.
 *
 * This service provides access to G0DM0D3 features:
 * - Standard chat with AutoTune/Parseltongue/STM pipeline
 * - ULTRAPLINIAN multi-model racing
 * - CONSORTIUM hive-mind synthesis
 * - AutoTune parameter analysis
 * - Parseltongue text obfuscation
 * - STM semantic transformations
 */

import { logger } from '@dmr-x/utils';
import type {
  GodmodeConfig,
  GodmodeChatRequest,
  GodmodeChatResponse,
  UltraplinianRequest,
  UltraplinianResponse,
  ConsortiumRequest,
  ConsortiumResponse,
  AutotuneAnalyzeRequest,
  AutotuneAnalyzeResponse,
  ParseltongueEncodeRequest,
  ParseltongueEncodeResponse,
  TransformRequest,
  TransformResponse,
  GodmodeTierInfo,
} from './types.js';

export class GodmodeService {
  private config: GodmodeConfig;
  private initialized = false;

  constructor(config: GodmodeConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Validate config
    if (!this.config.baseUrl) {
      throw new Error('GodmodeService: baseUrl is required');
    }
    if (!this.config.openrouterApiKey) {
      throw new Error('GodmodeService: openrouterApiKey is required');
    }

    this.initialized = true;
    logger.info({ baseUrl: this.config.baseUrl }, 'GodmodeService initialized');
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('GodmodeService not initialized. Call initialize() first.');
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit & { timeoutMs?: number } = {}
  ): Promise<Response> {
    const { timeoutMs = 60000, ...fetchOptions } = options;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Standard chat completion with G0DM0D3 pipeline
   */
  async chat(request: GodmodeChatRequest): Promise<GodmodeChatResponse> {
    this.assertInitialized();

    const body = {
      ...request,
      openrouter_api_key: this.config.openrouterApiKey,
      model: request.model || 'nousresearch/hermes-3-llama-3.1-70b',
    };

    const response = await this.fetchWithTimeout(
      `${this.config.baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        timeoutMs: 120000,
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`G0DM0D3 chat failed: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<GodmodeChatResponse>;
  }

  /**
   * Standard chat with streaming
   */
  async *chatStream(request: GodmodeChatRequest): AsyncIterable<string> {
    this.assertInitialized();

    const body = {
      ...request,
      openrouter_api_key: this.config.openrouterApiKey,
      model: request.model || 'nousresearch/hermes-3-llama-3.1-70b',
      stream: true,
    };

    const response = await this.fetchWithTimeout(
      `${this.config.baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        timeoutMs: 120000,
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`G0DM0D3 stream failed: ${response.status} ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  }

  /**
   * ULTRAPLINIAN multi-model racing
   */
  async ultraplinian(request: UltraplinianRequest): Promise<UltraplinianResponse> {
    this.assertInitialized();

    const body = {
      ...request,
      openrouter_api_key: this.config.openrouterApiKey,
      tier: request.tier || 'fast',
    };

    const response = await this.fetchWithTimeout(
      `${this.config.baseUrl}/v1/ultraplinian/completions`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        timeoutMs: 180000, // 3 minutes for ULTRAPLINIAN
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`G0DM0D3 ULTRAPLINIAN failed: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<UltraplinianResponse>;
  }

  /**
   * CONSORTIUM hive-mind synthesis
   */
  async consortium(request: ConsortiumRequest): Promise<ConsortiumResponse> {
    this.assertInitialized();

    const body = {
      ...request,
      openrouter_api_key: this.config.openrouterApiKey,
      tier: request.tier || 'fast',
    };

    const response = await this.fetchWithTimeout(
      `${this.config.baseUrl}/v1/consortium/completions`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        timeoutMs: 300000, // 5 minutes for CONSORTIUM
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`G0DM0D3 CONSORTIUM failed: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<ConsortiumResponse>;
  }

  /**
   * AutoTune parameter analysis
   */
  async autotuneAnalyze(request: AutotuneAnalyzeRequest): Promise<AutotuneAnalyzeResponse> {
    this.assertInitialized();

    const response = await this.fetchWithTimeout(
      `${this.config.baseUrl}/v1/autotune/analyze`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(request),
        timeoutMs: 30000,
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`G0DM0D3 AutoTune failed: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<AutotuneAnalyzeResponse>;
  }

  /**
   * Parseltongue text obfuscation
   */
  async parseltongueEncode(request: ParseltongueEncodeRequest): Promise<ParseltongueEncodeResponse> {
    this.assertInitialized();

    const response = await this.fetchWithTimeout(
      `${this.config.baseUrl}/v1/parseltongue/encode`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(request),
        timeoutMs: 30000,
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`G0DM0D3 Parseltongue failed: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<ParseltongueEncodeResponse>;
  }

  /**
   * STM semantic transformation
   */
  async transform(request: TransformRequest): Promise<TransformResponse> {
    this.assertInitialized();

    const response = await this.fetchWithTimeout(
      `${this.config.baseUrl}/v1/transform`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(request),
        timeoutMs: 30000,
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`G0DM0D3 Transform failed: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<TransformResponse>;
  }

  /**
   * Get tier information
   */
  async getTierInfo(): Promise<GodmodeTierInfo> {
    this.assertInitialized();

    const response = await this.fetchWithTimeout(
      `${this.config.baseUrl}/v1/tier`,
      {
        method: 'GET',
        headers: this.getHeaders(),
        timeoutMs: 10000,
      }
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`G0DM0D3 tier info failed: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<GodmodeTierInfo>;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.config.baseUrl}/v1/health`,
        {
          method: 'GET',
          timeoutMs: 5000,
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  dispose(): void {
    this.initialized = false;
  }
}

// Singleton instance
let instance: GodmodeService | null = null;

export function getGodmodeService(): GodmodeService {
  if (!instance) {
    const config: GodmodeConfig = {
      baseUrl: process.env.GODMODE_API_URL || 'http://localhost:7860',
      apiKey: process.env.GODMODE_API_KEY,
      openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
    };
    instance = new GodmodeService(config);
  }
  return instance;
}

export function createGodmodeService(config: GodmodeConfig): GodmodeService {
  instance = new GodmodeService(config);
  return instance;
}
