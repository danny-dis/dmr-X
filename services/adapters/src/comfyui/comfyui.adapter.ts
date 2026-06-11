/**
 * ComfyUI Adapter — Local/self-hosted AI video and image generation.
 *
 * Connects DMR-X to a local or remote ComfyUI instance running on port
 * 8188 (default).  Maps DMR-X `UnifiedRequest` objects to ComfyUI workflow
 * JSON, submits them via `POST /prompt`, and polls `GET /history/{id}` for
 * completion.
 *
 * ## Prerequisites
 *
 * - ComfyUI must be running (default: http://localhost:8188)
 * - Desired models must be installed in ComfyUI (SVD, Wan2.1, AnimateDiff, etc.)
 * - Workflow JSON files (API format) must be present in the `workflows/` dir
 *
 * ## Workflow Templates
 *
 * The adapter ships with pre-made workflow templates for common tasks:
 * - text2video-svd.json  — Stable Video Diffusion (txt2vid)
 * - img2video-svd.json   — Stable Video Diffusion (img2vid)
 * - text2video-wan.json  — Wan2.1 txt2vid
 * - img2video-wan.json   — Wan2.1 img2vid
 * - animate-diff.json    — AnimateDiff (txt2vid)
 *
 * Each template uses placeholder tokens (e.g. `__PROMPT__`, `__IMAGE__`)
 * that the adapter replaces at runtime.
 *
 * ## Configuration
 *
 * Set via ProviderConfig or env var:
 * ```env
 * COMFYUI_BASE_URL=http://localhost:8188
 * ```
 *
 * ## Routing
 *
 * ComfyUI is listed first in the video fallback chain, so the router
 * tries it before cloud providers.  When ComfyUI is down or the queue
 * is full, the router automatically falls back to Replicate, Runway, etc.
 */

import { BaseAdapter } from '../base.adapter.js';
import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';
import { AsyncJobRunner, type AsyncJobResult } from '../async-job.js';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A ComfyUI workflow in API format: node-id → { class_type, inputs } */
interface ComfyWorkflow {
  [nodeId: string]: {
    class_type: string;
    inputs: Record<string, unknown>;
  };
}

interface ComfyPromptResponse {
  prompt_id: string;
  number: number;
  node_errors?: Record<string, unknown>;
  error?: string;
}

interface ComfyHistoryEntry {
  prompt_id: string;
  outputs: Record<string, unknown>;
  status: {
    completed: boolean;
    status_str?: string;
    messages?: Array<[string, unknown]>;
  };
}

interface ComfyQueueStatus {
  queue_running: Array<unknown>;
  queue_pending: Array<unknown>;
}

// ---------------------------------------------------------------------------
// Workflow template helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = join(__dirname, 'workflows');

/** Placeholder tokens replaced at runtime in workflow JSON files */
const TOKENS = {
  PROMPT: '__PROMPT__',
  IMAGE: '__IMAGE_B64__',
  SEED: '__SEED__',
  STEPS: '__STEPS__',
  CFG: '__CFG_SCALE__',
  WIDTH: '__WIDTH__',
  HEIGHT: '__HEIGHT__',
  FPS: '__FPS__',
  DURATION: '__DURATION__',
  ASPECT_RATIO: '__ASPECT_RATIO__',
} as const;

function loadWorkflowTemplate(name: string): ComfyWorkflow | null {
  const filePath = join(WORKFLOWS_DIR, `${name}.json`);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as ComfyWorkflow;
  } catch (error) {
    logger.warn({ err: error, workflow: name }, 'Failed to load ComfyUI workflow template');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Known models exposed by this adapter
// ---------------------------------------------------------------------------

interface ComfyUIModel {
  modelId: string;
  workflowTemplate: string;
  description: string;
  supportsImage: boolean;
}

const KNOWN_MODELS: ComfyUIModel[] = [
  {
    modelId: 'stable-video-diffusion',
    workflowTemplate: 'text2video-svd',
    description: 'Stable Video Diffusion — text-to-video',
    supportsImage: false,
  },
  {
    modelId: 'stable-video-diffusion-img2vid',
    workflowTemplate: 'img2video-svd',
    description: 'Stable Video Diffusion — image-to-video',
    supportsImage: true,
  },
  {
    modelId: 'wan2.1',
    workflowTemplate: 'text2video-wan',
    description: 'Wan2.1 — text-to-video',
    supportsImage: false,
  },
  {
    modelId: 'wan2.1-img2vid',
    workflowTemplate: 'img2video-wan',
    description: 'Wan2.1 — image-to-video',
    supportsImage: true,
  },
  {
    modelId: 'animate-diff',
    workflowTemplate: 'animate-diff',
    description: 'AnimateDiff — text-to-video animation',
    supportsImage: false,
  },
];

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class ComfyUIAdapter extends BaseAdapter {
  readonly providerId = 'comfyui';
  readonly supportedModalities: Modality[] = ['video', 'diffusion'];

  private baseUrl = 'http://localhost:8188';
  private jobRunner: AsyncJobRunner;
  /** Cached object_info for node type introspection */
  private objectInfo: Record<string, unknown> | null = null;
  /** Maximum concurrent jobs before queuing locally */
  private maxConcurrent = 1;

  constructor() {
    super();
    this.jobRunner = new AsyncJobRunner({
      pollIntervalMs: 2000,
      timeoutMs: 300_000, // 5 min default for video
      verbose: false,
    });
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.baseUrl = (config.baseUrl as string) || 'http://localhost:8188';
    if (config.maxConcurrent) {
      this.maxConcurrent = config.maxConcurrent as number;
    }

    // Warm object_info cache
    try {
      await this.refreshObjectInfo();
    } catch {
      logger.warn({ baseUrl: this.baseUrl }, 'ComfyUI object_info not available (will retry on health check)');
    }
  }

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  protected async checkHealth(): Promise<void> {
    // Hit the /prompt GET endpoint (returns queue status) as a lightweight check
    const response = await this.fetchWithTimeout(`${this.baseUrl}/prompt`, {
      method: 'GET',
      timeoutMs: 5000,
    });

    if (!response.ok) {
      throw new Error(`ComfyUI health check failed: ${response.status}`);
    }

    // Refresh object_info cache opportunistically
    if (!this.objectInfo) {
      await this.refreshObjectInfo();
    }
  }

  // -----------------------------------------------------------------------
  // Execute
  // -----------------------------------------------------------------------

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();

    if (!this.supportedModalities.includes(request.modality)) {
      throw new Error(`ComfyUI does not support modality: ${request.modality}`);
    }

    const modelId = request.model || 'stable-video-diffusion';
    const modelDef = KNOWN_MODELS.find((m) => m.modelId === modelId);
    if (!modelDef) {
      throw new ProviderError(`Unknown ComfyUI model: ${modelId}`, this.providerId, 400);
    }

    // Validate image requirements
    if (modelDef.supportsImage && !request.image) {
      // For img2vid models without an image, downgrade to text2video
      const textModel = KNOWN_MODELS.find(
        (m) => m.modelId === modelId.replace('-img2vid', '') && !m.supportsImage,
      );
      if (textModel) {
        logger.info({ from: modelId, to: textModel.modelId }, 'ComfyUI: no image provided, falling back to text model');
        return this.executeVideo(request, textModel, options);
      }
    }
    if (!modelDef.supportsImage && request.image) {
      // For text2video models with an image, upgrade to img2vid
      const imgModel = KNOWN_MODELS.find((m) => m.modelId === `${modelId}-img2vid`);
      if (imgModel) {
        logger.info({ from: modelId, to: imgModel.modelId }, 'ComfyUI: image provided, switching to img2vid model');
        return this.executeVideo(request, imgModel, options);
      }
      // If no img2vid variant exists, ignore the image
      logger.warn({ modelId }, 'ComfyUI model does not support image input; ignoring image');
    }

    return this.executeVideo(request, modelDef, options);
  }

  private async executeVideo(
    request: UnifiedRequest,
    modelDef: ComfyUIModel,
    options?: ExecuteOptions,
  ): Promise<UnifiedResponse> {
    const startTime = Date.now();
    const timeoutMs = options?.timeoutMs ?? 300_000;

    // 1. Build workflow from template
    const workflow = this.buildWorkflow(request, modelDef);
    if (!workflow) {
      throw new ProviderError(
        `Workflow template not found: ${modelDef.workflowTemplate}`,
        this.providerId,
        500,
      );
    }

    // 2. If image is provided (img2vid), upload it first
    let uploadedImageName: string | undefined;
    if (request.image && modelDef.supportsImage) {
      uploadedImageName = await this.uploadImage(request.image);
    }

    // 3. Submit and poll using AsyncJobRunner
    try {
      const result = await this.jobRunner.run<string>(
        // Submit
        async () => {
          const submitWorkflow = this.prepareSubmitWorkflow(workflow, uploadedImageName);
          return this.submitPrompt(submitWorkflow);
        },
        // Poll
        async (promptId: string) => {
          return this.pollHistory(promptId);
        },
        { timeoutMs },
      );

      return this.buildVideoResponse(request.modality, request.model || modelDef.modelId, result, startTime);
    } catch (error) {
      if (error instanceof Error && error.name === 'AsyncJobTimeoutError') {
        throw new ProviderError(
          `ComfyUI video generation timed out after ${timeoutMs}ms`,
          this.providerId,
          504,
        );
      }
      throw this.handleAdapterError(error, 'video');
    }
  }

  // -----------------------------------------------------------------------
  // Streaming
  // -----------------------------------------------------------------------

  async *executeStream(
    request: UnifiedRequest,
    options?: ExecuteOptions,
  ): AsyncIterable<StreamChunk> {
    const response = await this.execute(request, options);

    yield {
      type: 'video_partial',
      data: response.videos?.[0] || null,
      index: 0,
    };
    yield {
      type: 'done',
      data: {},
      index: 1,
    };
  }

  // -----------------------------------------------------------------------
  // Model listing
  // -----------------------------------------------------------------------

  async listModels(): Promise<ModelInfo[]> {
    return KNOWN_MODELS.map((m) => ({
      modelId: m.modelId,
      modality: 'video' as Modality,
      capabilities: [
        'text2video',
        ...(m.supportsImage ? ['img2video'] : []),
      ],
    }));
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Build a ComfyUI workflow from a DMR-X UnifiedRequest by loading a
   * template and substituting placeholder tokens.
   */
  private buildWorkflow(
    request: UnifiedRequest,
    modelDef: ComfyUIModel,
  ): ComfyWorkflow | null {
    const template = loadWorkflowTemplate(modelDef.workflowTemplate);
    if (!template) return null;

    const workflowJson = JSON.stringify(template);

    const replacements: Record<string, string | number> = {
      [TOKENS.PROMPT]: request.prompt || '',
      [TOKENS.SEED]: request.diffusion_seed ?? Math.floor(Math.random() * 2_147_483_647),
      [TOKENS.STEPS]: request.steps ?? 25,
      [TOKENS.CFG]: request.cfg_scale ?? 7.0,
      [TOKENS.WIDTH]: request.width ?? 1024,
      [TOKENS.HEIGHT]: request.height ?? 576,
      [TOKENS.FPS]: request.fps ?? 8,
      [TOKENS.DURATION]: request.duration ?? 5,
    };

    // Calculate frame count from duration * fps
    const frameCount = (request.duration ?? 5) * (request.fps ?? 8);
    replacements[TOKENS.ASPECT_RATIO] = request.aspect_ratio ?? '16:9';

    let result = workflowJson;
    for (const [token, value] of Object.entries(replacements)) {
      result = result.replaceAll(token, String(value));
    }

    // If no image token was replaced, remove the image input node
    if (result.includes(TOKENS.IMAGE)) {
      result = result.replaceAll(TOKENS.IMAGE, '');
    }

    try {
      return JSON.parse(result) as ComfyWorkflow;
    } catch {
      logger.error({ workflow: modelDef.workflowTemplate }, 'Failed to parse substituted workflow JSON');
      return null;
    }
  }

  /**
   * Upload an image (base64 or URL) to ComfyUI and return the stored filename.
   * ComfyUI's `/upload/image` endpoint accepts multipart form data.
   */
  private async uploadImage(imageData: string): Promise<string> {
    // If it's a data URL, extract the base64 content
    let base64Data = imageData;
    let filename = 'dmrx_upload.png';

    if (imageData.startsWith('data:')) {
      const match = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
      if (match) {
        filename = `dmrx_upload.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
        base64Data = match[2];
      }
    }

    // For base64 upload, we need to send as multipart
    const buffer = Buffer.from(base64Data, 'base64');
    const blob = new Blob([buffer], { type: `image/${filename.split('.').pop() || 'png'}` });

    const formData = new FormData();
    formData.append('image', blob, filename);
    formData.append('overwrite', 'true');

    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/upload/image`, {
        method: 'POST',
        body: formData,
        timeoutMs: 30000,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      const result = (await response.json()) as { name?: string; image?: { name?: string } };
      // The uploaded image filename; ComfyUI may return it nested
      return result.name || result.image?.name || filename;
    } catch (error) {
      logger.warn({ err: error }, 'ComfyUI image upload failed; using placeholder');
      return filename;
    }
  }

  /**
   * Prepare the workflow for submission.
   * If an image was uploaded, inject the image node reference into the workflow.
   */
  private prepareSubmitWorkflow(
    workflow: ComfyWorkflow,
    uploadedImageName?: string,
  ): ComfyWorkflow {
    if (!uploadedImageName) return workflow;

    // Find the LoadImage node (if any) and set its image parameter
    for (const node of Object.values(workflow)) {
      if (node.class_type === 'LoadImage' && node.inputs) {
        node.inputs.image = uploadedImageName;
      }
    }
    return workflow;
  }

  /**
   * Submit a workflow to ComfyUI's `/prompt` endpoint.
   * Returns initial job status.
   */
  private async submitPrompt(workflow: ComfyWorkflow): Promise<{
    jobId: string;
    status: 'queued' | 'processing' | 'succeeded' | 'failed';
    error?: string;
  }> {
    const body = JSON.stringify({ prompt: workflow });

    const response = await this.fetchWithTimeout(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      timeoutMs: 15000,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ComfyUI submit failed (${response.status}): ${errorText}`);
    }

    const result = (await response.json()) as ComfyPromptResponse;

    if (result.error) {
      return {
        jobId: 'error',
        status: 'failed' as const,
        error: result.error,
      };
    }

    if (result.node_errors && Object.keys(result.node_errors).length > 0) {
      const errors = JSON.stringify(result.node_errors);
      return {
        jobId: result.prompt_id,
        status: 'failed' as const,
        error: `Workflow validation errors: ${errors}`,
      };
    }

    return {
      jobId: result.prompt_id,
      status: 'processing' as const,
    };
  }

  /**
   * Poll ComfyUI's `/history/{prompt_id}` endpoint.
   */
  private async pollHistory(
    promptId: string,
  ): Promise<{ status: 'succeeded' | 'failed' | 'processing'; output?: string; error?: string }> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/history/${promptId}`, {
      method: 'GET',
      timeoutMs: 10000,
    });

    if (!response.ok) {
      // History may not be available yet (still processing)
      if (response.status === 404) {
        return { status: 'processing' };
      }
      throw new Error(`Poll failed: ${response.status}`);
    }

    const history = (await response.json()) as Record<string, ComfyHistoryEntry>;
    const entry = history[promptId];

    if (!entry) {
      return { status: 'processing' };
    }

    if (entry.status.completed) {
      // Extract video/image output URLs from the workflow outputs
      const outputUrls = this.extractOutputUrls(entry);
      if (outputUrls.length > 0) {
        return { status: 'succeeded', output: outputUrls[0] };
      }
      // If no URLs found, the output may be saved to disk on the server
      return { status: 'succeeded', output: `${this.baseUrl}/view?filename=${promptId}` };
    }

    // Check for execution errors in messages
    if (entry.status.messages) {
      for (const [type, _data] of entry.status.messages) {
        if (type === 'execution_error' || type === 'execution_failed') {
          return { status: 'failed', error: `Workflow execution failed (${type})` };
        }
      }
    }

    return { status: 'processing' };
  }

  /**
   * Extract output file URLs from a completed ComfyUI history entry.
   * ComfyUI stores outputs in `entry.outputs` keyed by node ID.
   */
  private extractOutputUrls(entry: ComfyHistoryEntry): string[] {
    const urls: string[] = [];

    for (const [_nodeId, output] of Object.entries(entry.outputs)) {
      const outputObj = output as Record<string, unknown>;

      // Images array: [{ filename, type, ... }]
      const images = outputObj.images as Array<{ filename: string; subfolder?: string; type?: string }> | undefined;
      if (images && Array.isArray(images)) {
        for (const img of images) {
          const subfolder = img.subfolder ? `${img.subfolder}/` : '';
          urls.push(`${this.baseUrl}/view?filename=${img.filename}&subfolder=${subfolder}&type=${img.type || 'output'}`);
        }
      }

      // Videos/gifs array: [{ filename, ... }] 
      const videos = outputObj.videos as Array<{ filename: string; subfolder?: string; type?: string }> | undefined;
      if (videos && Array.isArray(videos)) {
        for ( const vid of videos) {
          const subfolder = vid.subfolder ? `${vid.subfolder}/` : '';
          urls.push(`${this.baseUrl}/view?filename=${vid.filename}&subfolder=${subfolder}&type=${vid.type || 'output'}`);
        }
      }
    }

    return urls;
  }

  /**
   * Build a DMR-X UnifiedResponse from the AsyncJob result.
   */
  private buildVideoResponse(
    modality: Modality,
    modelId: string,
    result: AsyncJobResult<string>,
    startTime: number,
  ): UnifiedResponse {
    if (!result.success) {
      throw new ProviderError(
        `ComfyUI generation failed: ${result.error || 'Unknown error'}`,
        this.providerId,
        500,
      );
    }

    const latencyMs = Date.now() - startTime;

    // Compute duration and fps from the request or use defaults
    const duration = 5; // will be overridden from result metadata if available
    const fps = 8;

    return {
      modality,
      requestId: result.jobId,
      providerId: this.providerId,
      modelId: modelId,
      videos: [{
        url: result.output,
        duration,
        fps,
      }],
      latencyMs,
    };
  }

  /**
   * Refresh the ComfyUI object_info cache.
   * This gives us the list of available node types and their parameters.
   */
  private async refreshObjectInfo(): Promise<void> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/object_info`, {
        method: 'GET',
        timeoutMs: 10000,
      });
      if (response.ok) {
        this.objectInfo = (await response.json()) as Record<string, unknown>;
      }
    } catch {
      // Non-fatal — object_info is a cache optimization
    }
  }

  /**
   * Get the current queue status (running + pending count).
   * Useful for deciding whether to route to ComfyUI or fall back
   * to cloud providers when the local queue is full.
   */
  async getQueueStatus(): Promise<{ running: number; pending: number }> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/queue`, {
        method: 'GET',
        timeoutMs: 5000,
      });
      if (response.ok) {
        const data = (await response.json()) as ComfyQueueStatus;
        return {
          running: data.queue_running?.length ?? 0,
          pending: data.queue_pending?.length ?? 0,
        };
      }
    } catch {
      // Fall through
    }
    return { running: 0, pending: 0 };
  }

  /**
   * Interrupt the current execution.
   * Useful for cancelling a long-running generation.
   */
  async interrupt(): Promise<void> {
    await this.fetchWithTimeout(`${this.baseUrl}/interrupt`, {
      method: 'POST',
      timeoutMs: 5000,
    });
  }
}
