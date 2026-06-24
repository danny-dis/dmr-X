import type { UnifiedRequest } from '@dmr-x/core';
import { describe, it, expect } from 'vitest';

import { OcrAdapter, createOcrAdapter } from '../../services/adapters/src/ocr/index.js';

describe('OcrAdapter', () => {
  describe('createOcrAdapter', () => {
    it('should create adapter with tesseract providerId', () => {
      const adapter = createOcrAdapter('tesseract');
      expect(adapter.providerId).toBe('tesseract');
      expect(adapter.supportedModalities).toContain('ocr');
    });

    it('should create adapter with paddleocr providerId', () => {
      const adapter = createOcrAdapter('paddleocr');
      expect(adapter.providerId).toBe('paddleocr');
    });

    it('should create adapter with huggingface providerId', () => {
      const adapter = createOcrAdapter('huggingface');
      expect(adapter.providerId).toBe('huggingface');
    });
  });

  describe('listModels', () => {
    it('should list Tesseract models', async () => {
      const adapter = createOcrAdapter('tesseract');
      const models = await adapter.listModels();

      expect(models.length).toBeGreaterThan(0);
      expect(models[0].modality).toBe('ocr');
      expect(models.map(m => m.modelId)).toContain('tesseract-5');
    });

    it('should list PaddleOCR models', async () => {
      const adapter = createOcrAdapter('paddleocr');
      const models = await adapter.listModels();

      expect(models.length).toBeGreaterThan(0);
      expect(models[0].modelId).toBe('paddleocr');
    });

    it('should list HuggingFace TrOCR models', async () => {
      const adapter = createOcrAdapter('huggingface');
      const models = await adapter.listModels();

      expect(models.length).toBeGreaterThan(0);
      expect(models[0].modality).toBe('ocr');
      expect(models[0].modelId).toContain('trocr');
    });
  });

  describe('execute', () => {
    it('should throw error without image input', async () => {
      const adapter = createOcrAdapter('tesseract');
      await adapter.initialize({ baseUrl: 'http://localhost:8000' });

      const request: UnifiedRequest = {
        modality: 'ocr',
        stream: false,
        metadata: {},
      };

      await expect(() => adapter.execute(request)).rejects.toThrow('Image input');
    });
  });
});