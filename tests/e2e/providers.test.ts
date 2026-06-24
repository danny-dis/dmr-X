import { describe, it, expect, beforeAll } from 'vitest';

import { TestClient } from './test-client.js';

const describeE2E = process.env.DMRX_RUN_E2E === 'true' ? describe : describe.skip;

/**
 * E2E Provider Integration Tests
 * Verifies that the integrated providers (Google, OpenRouter, Pollinations)
 * are correctly registered and responding to requests.
 *
 * IMPORTANT: These tests require:
 * 1. Gateway running on the URL set by DMRX_GATEWAY_URL (default: localhost:3000)
 * 2. DMRX_LOCAL_MODE=true to skip API key auth
 * 3. Or valid API keys configured for the providers
 * 4. Set DMRX_RUN_E2E=true to enable these tests
 */
describeE2E('Provider Integration E2E', () => {
  let client: TestClient;

  beforeAll(() => {
    // Gateway URL is configurable via DMRX_GATEWAY_URL (matches stress-test suite)
    // DMRX_LOCAL_MODE=true allows us to skip API key auth for local tests
    client = new TestClient(process.env.DMRX_GATEWAY_URL || 'http://localhost:3000');
  });

  describe('Registry Discovery', () => {
    it('should have all target providers registered in the model list', async () => {
      const modelsResponse = await client.getModels() as { data: Array<{ id: string; owned_by?: string }> };
      const models = modelsResponse.data;
      
      const providers = new Set(models.map((m) => m.owned_by || m.id.split('/')[0]));
      console.log('Detected providers:', Array.from(providers));
      
      expect(providers.has('google') || providers.has('gemini')).toBe(true);
      expect(providers.has('openrouter') || providers.has('openrouter-free')).toBe(true);
      expect(providers.has('pollinations')).toBe(true);
    });
  });

  describe('Chat Completions', () => {
    // 1. Pollinations (Free, No Key)
    it('should complete a request via Pollinations', async () => {
      const response = await client.request('/v1/chat/completions', {
        model: 'pollinations/openai-fast',
        messages: [{ role: 'user', content: 'Say "Pollinations Verified"' }],
        modality: 'llm',
        stream: false,
        metadata: {},
      });

      expect(response).toBeDefined();
      expect(response.message).toBeDefined();
      expect(response.message?.content).toBeDefined();
    }, 30000);

    // 2. Google Gemini (Using OpenAI compatibility)
    it('should complete a request via Google Gemini', async () => {
      const response = await client.request('/v1/chat/completions', {
        model: 'google/gemini-2.0-flash',
        messages: [{ role: 'user', content: 'Say "Gemini Verified"' }],
        modality: 'llm',
        stream: false,
        metadata: {},
      });

      expect(response).toBeDefined();
      expect(response.message).toBeDefined();
      expect(response.message?.content).toBeDefined();
    }, 30000);

    // 3. OpenRouter
    it('should complete a request via OpenRouter', async () => {
      const response = await client.request('/v1/chat/completions', {
        model: 'openrouter-free/google/gemini-2.0-flash-001',
        messages: [{ role: 'user', content: 'Say "OpenRouter Verified"' }],
        modality: 'llm',
        stream: false,
        metadata: {},
      });

      expect(response).toBeDefined();
      expect(response.message).toBeDefined();
      expect(response.message?.content).toBeDefined();
    }, 30000);
  });

  describe('Streaming', () => {
    it('should support streaming from Pollinations', async () => {
      const response = await fetch(`${client.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'pollinations/openai-fast',
          messages: [{ role: 'user', content: 'Count to 3' }],
          stream: true
        })
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      const reader = response.body?.getReader();
      let chunksReceived = 0;
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunksReceived++;
        }
      }
      expect(chunksReceived).toBeGreaterThan(0);
    });
  });
});
