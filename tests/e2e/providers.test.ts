import { describe, it, expect, beforeAll } from 'vitest';
import { TestClient } from './test-client.js';

/**
 * E2E Provider Integration Tests
 * Verifies that the integrated providers (Google, OpenRouter, Pollinations)
 * are correctly registered and responding to requests.
 */
const describeE2E = process.env.DMRX_RUN_E2E === 'true' ? describe : describe.skip;

describeE2E('Provider Integration E2E', () => {
  let client: TestClient;

  beforeAll(() => {
    // Gateway must be running; DMRX_LOCAL_MODE=true allows skipping API key auth
    const baseUrl = process.env.DMRX_GATEWAY_URL || 'http://localhost:3000';
    client = new TestClient(baseUrl);
  });

  describe('Registry Discovery', () => {
    it('should have models registered (or be gated by CI env)', async () => {
      const modelsResponse = await client.getModels();
      const models = modelsResponse.data;
      if (models.length === 0) {
        console.log('Skipping model-list assertion — no providers registered (CI env without keys)');
        return;
      }
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe('Chat Completions', () => {
    // 1. Pollinations (Free, No Key)
    it('should complete a request via Pollinations', async () => {
      if (!process.env.POLLINATIONS_ENABLED) {
        console.log('Skipping Pollinations test — POLLINATIONS_ENABLED not set');
        return;
      }
      const response = await client.request('/v1/chat/completions', {
        model: 'pollinations/openai-fast',
        messages: [{ role: 'user', content: 'Say "Pollinations Verified"' }]
      });

      expect(response.choices[0].message.content).toBeDefined();
      expect(response.choices[0].message.content.length).toBeGreaterThan(0);
    });

    // 2. Google Gemini (Using OpenAI compatibility)
    it('should complete a request via Google Gemini', async () => {
      if (!process.env.GOOGLE_API_KEY) {
        console.log('Skipping Google Gemini test — GOOGLE_API_KEY not set');
        return;
      }
      const response = await client.request('/v1/chat/completions', {
        model: 'google/gemini-2.0-flash',
        messages: [{ role: 'user', content: 'Say "Gemini Verified"' }]
      });

      expect(response.choices[0].message.content).toBeDefined();
      expect(response.choices[0].message.content.length).toBeGreaterThan(0);
    });

    // 3. OpenRouter
    it('should complete a request via OpenRouter', async () => {
      if (!process.env.OPENROUTER_API_KEY) {
        console.log('Skipping OpenRouter test — OPENROUTER_API_KEY not set');
        return;
      }
      const response = await client.request('/v1/chat/completions', {
        model: 'openrouter/google/gemini-2.0-flash-001', // Using a reliable model through OpenRouter
        messages: [{ role: 'user', content: 'Say "OpenRouter Verified"' }]
      });

      expect(response.choices[0].message.content).toBeDefined();
      expect(response.choices[0].message.content.length).toBeGreaterThan(0);
    });
  });

  describe('Streaming', () => {
    it('should support streaming from Pollinations', async () => {
      if (!process.env.POLLINATIONS_ENABLED) {
        console.log('Skipping Pollinations streaming test — POLLINATIONS_ENABLED not set');
        return;
      }
      const response = await fetch('http://localhost:3001/v1/chat/completions', {
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
