import { describe, it, expect, beforeAll } from 'vitest';
import { TestClient } from './test-client.js';

describe('Gateway Connectivity', () => {
  let client: TestClient;

  beforeAll(() => {
    client = new TestClient();
  });

  it('should be reachable and return models', async () => {
    try {
      const models = await client.getModels();
      expect(models).toBeDefined();
      expect(Array.isArray(models.data)).toBe(true);
    } catch (error: any) {
      throw new Error(`Gateway unreachable: ${error.message}`);
    }
  });
});
