/**
 * Response compression for token optimization
 * 
 * Reduces MCP tool result token usage by:
 * - Structured truncation (return only requested fields)
 * - JSON compression (minimize whitespace, optimize keys)
 * - Response caching (deduplicate identical requests)
 * - Smart summarization (compress large payloads)
 */

import { createLogger } from '@dmr-x/utils';

const logger = createLogger('tool-search:compression');

export interface CompressionConfig {
  /** Enable response compression */
  enabled?: boolean;
  /** Maximum tokens per response (approximate) */
  maxTokens?: number;
  /** Fields to always include in responses */
  essentialFields?: string[];
  /** Enable response caching */
  cacheEnabled?: boolean;
  /** Cache TTL in milliseconds */
  cacheTtlMs?: number;
  /** Maximum cache size */
  cacheMaxSize?: number;
}

interface CacheEntry {
  key: string;
  value: unknown;
  timestamp: number;
}

/**
 * Approximate token count (rough estimate: 1 token ≈ 4 chars)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Minify JSON by removing unnecessary whitespace
 */
function minifyJson(obj: unknown): string {
  return JSON.stringify(obj);
}

/**
 * Compress JSON by removing null/undefined values and empty arrays/objects
 */
function compressJson(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return null;
  }

  if (Array.isArray(obj)) {
    const compressed = obj.map(compressJson).filter((v) => v !== null);
    return compressed.length > 0 ? compressed : null;
  }

  if (typeof obj === 'object') {
    const compressed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const compressedValue = compressJson(value);
      if (compressedValue !== null && compressedValue !== undefined) {
        compressed[key] = compressedValue;
      }
    }
    return Object.keys(compressed).length > 0 ? compressed : null;
  }

  return obj;
}

/**
 * Extract only specified fields from an object
 */
function extractFields(obj: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  for (const field of fields) {
    if (field in obj) {
      result[field] = obj[field];
    }
  }
  
  return result;
}

/**
 * Truncate text to fit within token limit
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const estimatedTokens = estimateTokens(text);
  if (estimatedTokens <= maxTokens) {
    return text;
  }
  
  // Truncate characters (rough approximation)
  const maxChars = maxTokens * 4;
  return text.slice(0, maxChars) + '\n... [truncated]';
}

/**
 * Response compressor for MCP tool results
 */
export class ResponseCompressor {
  private cache = new Map<string, CacheEntry>();
  private config: Required<CompressionConfig>;

  constructor(config?: CompressionConfig) {
    this.config = {
      enabled: true,
      maxTokens: 4000,
      essentialFields: ['id', 'name', 'description', 'status', 'error'],
      cacheEnabled: true,
      cacheTtlMs: 5 * 60 * 1000, // 5 minutes
      cacheMaxSize: 1000,
      ...config,
    };
  }

  /**
   * Compress a tool response
   */
  compress(
    response: unknown,
    options?: {
      fields?: string[];
      maxTokens?: number;
      skipCache?: boolean;
    }
  ): { compressed: unknown; tokensSaved: number } {
    if (!this.config.enabled) {
      return { compressed: response, tokensSaved: 0 };
    }

    // Check cache first
    if (this.config.cacheEnabled && !options?.skipCache) {
      const cacheKey = this.getCacheKey(response);
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTtlMs) {
        const originalTokens = estimateTokens(JSON.stringify(response));
        const cachedTokens = estimateTokens(JSON.stringify(cached.value));
        return { compressed: cached.value, tokensSaved: originalTokens - cachedTokens };
      }
    }

    const originalStr = JSON.stringify(response);
    const originalTokens = estimateTokens(originalStr);

    let compressed = response;

    // Step 1: Extract specific fields if requested
    if (options?.fields && typeof response === 'object' && response !== null) {
      compressed = extractFields(response as Record<string, unknown>, options.fields);
    }

    // Step 2: Compress JSON structure
    compressed = compressJson(compressed);

    // Step 3: Minify JSON
    let compressedStr = minifyJson(compressed);

    // Step 4: Truncate if still too large
    const maxTokens = options?.maxTokens ?? this.config.maxTokens;
    compressedStr = truncateToTokens(compressedStr, maxTokens);

    // Parse back to object if possible
    try {
      compressed = JSON.parse(compressedStr);
    } catch {
      compressed = compressedStr;
    }

    const compressedTokens = estimateTokens(compressedStr);
    const tokensSaved = originalTokens - compressedTokens;

    // Cache the result
    if (this.config.cacheEnabled) {
      this.addToCache(response, compressed);
    }

    logger.debug({ originalTokens, compressedTokens, tokensSaved }, 'Response compressed');

    return { compressed, tokensSaved };
  }

  /**
   * Compress an array of responses (batch optimization)
   */
  compressBatch(
    responses: unknown[],
    options?: {
      fields?: string[];
      maxTokensPerItem?: number;
      maxTotalTokens?: number;
    }
  ): { compressed: unknown[]; totalTokensSaved: number } {
    const maxTotalTokens = options?.maxTotalTokens ?? this.config.maxTokens * responses.length;
    const maxTokensPerItem = options?.maxTokensPerItem ?? Math.floor(maxTotalTokens / responses.length);

    const compressed: unknown[] = [];
    let totalTokensSaved = 0;

    for (const response of responses) {
      const result = this.compress(response, { maxTokens: maxTokensPerItem });
      compressed.push(result.compressed);
      totalTokensSaved += result.tokensSaved;
    }

    return { compressed, totalTokensSaved };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.cache.size,
      hitRate: 0, // Would need to track hits/misses
    };
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  private getCacheKey(response: unknown): string {
    // Simple hash for cache key
    return JSON.stringify(response).slice(0, 100);
  }

  private addToCache(original: unknown, compressed: unknown): void {
    // Evict oldest entries if cache is full
    if (this.cache.size >= this.config.cacheMaxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(this.getCacheKey(original), {
      key: this.getCacheKey(original),
      value: compressed,
      timestamp: Date.now(),
    });
  }
}

/**
 * TOON (Token-Optimized Object Notation) encoder
 * 
 * Encodes JSON in a token-efficient format by:
 * - Using short keys
 * - Removing redundant information
 * - Encoding common patterns efficiently
 */
export class TOONEncoder {
  private keyMap = new Map<string, string>();
  private reverseKeyMap = new Map<string, string>();

  /**
   * Encode an object to TOON format
   */
  encode(obj: unknown): string {
    if (obj === null || obj === undefined) {
      return 'n';
    }

    if (typeof obj === 'boolean') {
      return obj ? 't' : 'f';
    }

    if (typeof obj === 'number') {
      return String(obj);
    }

    if (typeof obj === 'string') {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) return '[]';
      const items = obj.map((item) => this.encode(item));
      return `[${items.join(',')}]`;
    }

    if (typeof obj === 'object') {
      const entries = Object.entries(obj);
      if (entries.length === 0) return '{}';
      
      const pairs = entries.map(([key, value]) => {
        const shortKey = this.getShortKey(key);
        return `${shortKey}:${this.encode(value)}`;
      });
      return `{${pairs.join(',')}}`;
    }

    return String(obj);
  }

  /**
   * Decode a TOON string back to JSON
   */
  decode(toon: string): unknown {
    // Simplified decoder - in production, implement full parser
    try {
      // Try to parse as JSON first
      return JSON.parse(toon);
    } catch {
      // Handle TOON-specific syntax
      return toon;
    }
  }

  private getShortKey(key: string): string {
    if (this.keyMap.has(key)) {
      return this.keyMap.get(key)!;
    }

    // Generate short key based on index
    const index = this.keyMap.size;
    const shortKey = this.toBase62(index);
    
    this.keyMap.set(key, shortKey);
    this.reverseKeyMap.set(shortKey, key);
    
    return shortKey;
  }

  private toBase62(num: number): string {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (num === 0) return chars[0];
    
    let result = '';
    while (num > 0) {
      result = chars[num % 62] + result;
      num = Math.floor(num / 62);
    }
    return result;
  }
}
