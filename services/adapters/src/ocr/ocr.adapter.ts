import { BaseAdapter } from '../base.adapter.js';
import type { ProviderConfig, ModelInfo, ExecuteOptions } from '../adapter.interface.js';
import type { Modality, UnifiedRequest, UnifiedResponse, StreamChunk } from '@dmr-x/core';
import { ProviderError } from '@dmr-x/core';

/**
 * OCR adapter — supports Tesseract (local), PaddleOCR (local + HuggingFace), and other OCR providers.
 *
 * Tesseract pattern (local):
 *   - HTTP service wraps Tesseract CLI
 *   - POST /ocr with image (base64 or URL)
 *   - Returns structured JSON with text and bounding boxes
 *
 * PaddleOCR pattern (local/cloud):
 *   - POST /ocr with image
 *   - Returns JSON with text lines, paragraphs, words with confidence scores
 *
 * HuggingFace Inference API pattern:
 *   - POST https://api-inference.huggingface.co/models/<model>/pipeline
 *   - Returns JSON with OCR results
 */
export class OcrAdapter extends BaseAdapter {
  readonly providerId = 'tesseract';
  readonly supportedModalities: Modality[] = ['ocr'];

  private apiKey = '';
  private baseUrl = '';

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.apiKey = (config.apiKey as string) || '';
    this.baseUrl = (config.baseUrl as string) || 'http://localhost:8000';

    // Tesseract local doesn't require API key
    if (this.providerId !== 'tesseract' && !this.apiKey) {
      throw new Error(`${this.providerId} API key is required`);
    }
  }

  protected async checkHealth(): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await this.fetchWithTimeout(`${this.baseUrl}/health`, {
      method: 'GET',
      headers,
      timeoutMs: 5000,
    });

    if (!response.ok && response.status >= 500) {
      throw new Error(`${this.providerId} health check failed`);
    }
  }

  async execute(request: UnifiedRequest, options?: ExecuteOptions): Promise<UnifiedResponse> {
    this.assertInitialized();
    const start = Date.now();
    const modelId = request.model || 'tesseract-5';

    if (!request.audio && !request.image) {
      throw new Error('Image input (ocr_image or image) is required for OCR');
    }

    const imageInput = (request as any).ocr_image || request.image;

    try {
      let response: Response;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      response = await this.fetchWithTimeout(`${this.baseUrl}/ocr`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          image: imageInput,
          language: request.ocr_language || 'en',
          detect_direction: request.ocr_detect_direction,
          paragraph: request.ocr_paragraph,
          lines: request.ocr_lines,
          words: request.ocr_words,
        }),
        timeoutMs: options?.timeoutMs ?? 30000,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new ProviderError(`OCR: ${response.status} ${body}`, this.providerId, response.status);
      }

      const data = await response.json() as {
        text?: string;
        ocr_texts?: Array<{ text: string; confidence?: number; bounding_box?: [number, number, number, number]; page?: number }>;
        full_text_annotation?: string;
      };

      const ocrResult = {
        text: data.text || '',
        ocrTexts: data.ocr_texts?.map((t) => ({
          text: t.text,
          confidence: t.confidence,
          boundingBox: t.bounding_box,
          page: t.page,
        })),
        fullTextAnnotation: data.full_text_annotation,
      };

      return {
        modality: 'ocr',
        requestId: `ocr_${Date.now()}`,
        providerId: this.providerId,
        modelId,
        ocr: ocrResult,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      throw this.handleAdapterError(err);
    }
  }

  async *executeStream(request: UnifiedRequest, options?: ExecuteOptions): AsyncIterable<StreamChunk> {
    this.assertInitialized();
    const response = await this.execute(request, options);

    yield {
      type: 'image_partial',
      data: { ocr: response.ocr },
      index: 0,
    };

    yield {
      type: 'done',
      data: { requestId: response.requestId, modelId: response.modelId },
      index: 1,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    if (this.providerId === 'tesseract') {
      return [
        { modelId: 'tesseract-5', modality: 'ocr', capabilities: ['printed-text', 'multilingual'] },
      ];
    }

    if (this.providerId === 'paddleocr') {
      return [
        { modelId: 'paddleocr', modality: 'ocr', capabilities: ['printed-text', 'handwritten', '80+languages', 'structured-output'] },
      ];
    }

    if (this.providerId === 'huggingface') {
      return [
        { modelId: 'microsoft/trocr-base-printed', modality: 'ocr', capabilities: ['printed-text'] },
        { modelId: 'microsoft/trocr-large-printed', modality: 'ocr', capabilities: ['printed-text'] },
        { modelId: 'microsoft/trocr-base-handwritten', modality: 'ocr', capabilities: ['handwritten'] },
      ];
    }

    return [];
  }
}

export function createOcrAdapter(providerId: string): OcrAdapter {
  const adapter = new OcrAdapter();
  (adapter as any).providerId = providerId;
  return adapter;
}