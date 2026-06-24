/**
 * @dmr-x/tool-search
 * 
 * Hybrid tool search engine for MCP proxy
 * 
 * Provides intelligent tool discovery using:
 * - BM25 for fast keyword matching
 * - Semantic embeddings for meaning-based search
 * - Reciprocal Rank Fusion for optimal result combination
 * - Semantic deduplication for tool conflict resolution
 * - Response compression for token optimization
 * 
 * Based on research showing:
 * - BM25 alone: 14% top-1 accuracy (StackOne)
 * - Hybrid BM25 + semantic: 94% top-1 accuracy (Stacklok)
 * - TOON encoding: 98% token reduction on some payloads (MindStudio)
 */

export { BM25Engine, type ToolDocument, type SearchResult, type BM25Config } from './bm25.js';
export { EmbeddingEngine, type EmbeddingConfig } from './embeddings.js';
export { HybridSearchEngine, type HybridSearchConfig } from './hybrid.js';
export { ToolDeduplicator, type DeduplicationConfig, type ToolCluster, type DeduplicationResult } from './dedup.js';
export { ResponseCompressor, TOONEncoder, type CompressionConfig } from './compression.js';
