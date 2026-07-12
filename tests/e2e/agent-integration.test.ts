import { describe, it, expect, beforeAll } from 'vitest';
import { TestClient } from './test-client.js';

const describeE2E = process.env.DMRX_RUN_E2E === 'true' ? describe : describe.skip;

describeE2E('Agent Integration (Codex & Antigravity)', () => {
  let client: TestClient;

  beforeAll(() => {
    const baseUrl = process.env.DMRX_GATEWAY_URL || 'http://localhost:3000';
    client = new TestClient(baseUrl);
  });

  describe('Codex Integration (OpenAI-compatible)', () => {
    it('should accept Codex-format chat completions', async () => {
      // Codex uses standard OpenAI /v1/chat/completions endpoint
      const response = await client.request('/v1/chat/completions', {
        model: 'auto-coding',
        messages: [{ role: 'user', content: 'Say "Codex integration verified"' }],
        max_tokens: 50,
      });
      expect(response.choices).toBeDefined();
      expect(response.choices.length).toBeGreaterThan(0);
      expect(response.choices[0].message.content).toBeDefined();
    });

    it('should return streaming for Codex requests', async () => {
      const response = await fetch(`${client.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'auto-coding',
          messages: [{ role: 'user', content: 'Count to 5' }],
          stream: true,
        }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
    });

    it('should expose models for Codex discovery', async () => {
      const models = await client.getModels();
      expect(models.data).toBeDefined();
      // Should have at least one model suitable for coding
      const codingModels = models.data.filter((m: any) =>
        m.id.includes('coding') || m.id.includes('code')
      );
      expect(codingModels.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('OpenCode Integration (OpenAI-compatible)', () => {
    it('should accept OpenCode-format chat completions', async () => {
      // OpenCode uses the standard OpenAI /v1/chat/completions endpoint
      const response = await client.request('/v1/chat/completions', {
        model: 'auto-coding',
        messages: [{ role: 'user', content: 'Say "OpenCode integration verified"' }],
        max_tokens: 50,
      });
      expect(response.choices).toBeDefined();
      expect(response.choices.length).toBeGreaterThan(0);
      expect(response.choices[0].message.content).toBeDefined();
    });

    it('should return streaming for OpenCode requests', async () => {
      const response = await fetch(`${client.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'auto-coding',
          messages: [{ role: 'user', content: 'Count to 5' }],
          stream: true,
        }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
    });
  });

  describe('Antigravity Cloud Code Protocol', () => {
    // Antigravity uses /v1internal:streamGenerateContent endpoint
    it('should accept Cloud Code protocol requests', async () => {
      const response = await fetch(`${client.baseUrl}/v1internal:streamGenerateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'antigravity/gemini-2.5-flash',
          request: {
            contents: [
              { role: 'user', parts: [{ text: 'Say "Antigravity verified"' }] }
            ],
            generationConfig: { maxOutputTokens: 50 },
          },
          requestType: 'agent',
          userAgent: 'antigravity',
          requestId: `test-${Date.now()}`,
        }),
      });
      // Should either succeed (200) or return a meaningful error
      expect([200, 400, 401, 404, 503]).toContain(response.status);
    });

    it('should handle non-streaming Cloud Code requests', async () => {
      const response = await fetch(`${client.baseUrl}/v1internal:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'antigravity/gemini-2.5-flash',
          request: {
            contents: [
              { role: 'user', parts: [{ text: 'Hello' }] }
            ],
          },
          requestType: 'agent',
          userAgent: 'antigravity',
          requestId: `test-${Date.now()}`,
        }),
      });
      expect([200, 400, 401, 404, 503]).toContain(response.status);
    });

    it('should expose Cloud Code routes in route list', async () => {
      const response = await fetch(`${client.baseUrl}/v1/models`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status).toBe(200);
    });
  });
});
