import type { UnifiedRequest } from '@dmr-x/core';
import { describe, it, expect } from 'vitest';

import { AudioSeparationAdapter, createAudioSeparationAdapter } from '../../services/adapters/src/audio-separation/index.js';

describe('AudioSeparationAdapter', () => {
  describe('createAudioSeparationAdapter', () => {
    it('should create adapter with demucs providerId', () => {
      const adapter = createAudioSeparationAdapter('demucs');
      expect(adapter.providerId).toBe('demucs');
      expect(adapter.supportedModalities).toContain('audio_separation');
    });

    it('should create adapter with audioshake providerId', () => {
      const adapter = createAudioSeparationAdapter('audioshake');
      expect(adapter.providerId).toBe('audioshake');
    });

    it('should create adapter with stemsplit providerId', () => {
      const adapter = createAudioSeparationAdapter('stemsplit');
      expect(adapter.providerId).toBe('stemsplit');
    });
  });

  describe('listModels', () => {
    it('should list Demucs models', async () => {
      const adapter = createAudioSeparationAdapter('demucs');
      const models = await adapter.listModels();

      expect(models.length).toBeGreaterThan(0);
      expect(models[0].modality).toBe('audio_separation');
      expect(models.map(m => m.modelId)).toContain('htdemucs_ft');
    });

    it('should list AudioShake models', async () => {
      const adapter = createAudioSeparationAdapter('audioshake');
      const models = await adapter.listModels();

      expect(models.length).toBeGreaterThan(0);
      expect(models[0].modelId).toMatch(/audioshake/);
    });

    it('should return empty list for unknown provider', async () => {
      const adapter = createAudioSeparationAdapter('unknown');
      const models = await adapter.listModels();

      expect(models.length).toBe(0);
    });
  });

  describe('execute', () => {
    it('should throw error without audio input', async () => {
      const adapter = createAudioSeparationAdapter('demucs');
      await adapter.initialize({ baseUrl: 'http://localhost:8000' });

      const request: UnifiedRequest = {
        modality: 'audio_separation',
        stream: false,
        metadata: {},
      };

      await expect(() => adapter.execute(request)).rejects.toThrow('Audio input is required');
    });
  });
});