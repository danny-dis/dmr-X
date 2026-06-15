/**
 * MCP Tool Annotations for DMR-X tools.
 *
 * Annotations are behavioral hints (not guarantees) that help clients
 * determine trust levels and auto-approval policies.
 *
 * @see https://spec.modelcontextprotocol.io/specification/2025-11-25/server/tools/#annotations
 */

export interface ToolAnnotations {
  /** Human-readable display name */
  title?: string;
  /** Tool doesn't modify state (default: false) */
  readOnlyHint?: boolean;
  /** Tool may delete/overwrite data (default: true) */
  destructiveHint?: boolean;
  /** Safe to retry on failure (default: false) */
  idempotentHint?: boolean;
  /** Contacts external services (default: true) */
  openWorldHint?: boolean;
  /** Index signature for MCP SDK compatibility */
  [key: string]: unknown;
}

/**
 * Annotations for each DMR-X MCP tool.
 * Keys match TOOL_NAMES from tools.ts.
 */
export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  dmrx_chat: {
    title: 'Chat Completion',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  dmrx_chat_stream: {
    title: 'Streaming Chat Completion',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  dmrx_generate_image: {
    title: 'Image Generation',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  dmrx_generate_image_stream: {
    title: 'Streaming Image Generation',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  dmrx_generate_video: {
    title: 'Video Generation',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  dmrx_generate_video_stream: {
    title: 'Streaming Video Generation',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  dmrx_generate_music: {
    title: 'Music Generation',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  dmrx_generate_3d: {
    title: '3D Model Generation',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  dmrx_embed: {
    title: 'Text Embeddings',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  dmrx_transcribe: {
    title: 'Speech-to-Text',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  dmrx_speak: {
    title: 'Text-to-Speech',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  dmrx_rerank: {
    title: 'Document Reranking',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  dmrx_models: {
    title: 'List Models',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  dmrx_status: {
    title: 'System Status',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  dmrx_batch: {
    title: 'Batch Tool Execution',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  dmrx_context_save: {
    title: 'Save Context',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  dmrx_context_load: {
    title: 'Load Context',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  dmrx_context_list: {
    title: 'List Contexts',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  dmrx_context_summarize: {
    title: 'Summarize Context',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  dmrx_context_compress: {
    title: 'Compress Context',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  dmrx_workflow: {
    title: 'Workflow Orchestration',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};
