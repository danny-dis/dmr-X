import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleA2ARoutes } from '../../services/mcp-server/src/a2a/handler.js';
import { setOwnerResolver } from '../../services/mcp-server/src/a2a/owner.js';

afterEach(() => setOwnerResolver(undefined));

describe('A2A routing boundary', () => {
  it.each(['/health', '/mcp', '/sse', '/oauth/token'])('does not authenticate or handle the non-A2A path %s', async (url) => {
    const resolve = vi.fn(async () => 'fixture-owner');
    setOwnerResolver(resolve);
    const request = { url, method: 'GET', headers: { host: 'localhost' } } as IncomingMessage;
    const response = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() } as unknown as ServerResponse;
    const handled = await handleA2ARoutes(request, response, { enabled: true });
    expect(handled).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    expect(response.writeHead).not.toHaveBeenCalled();
    expect(response.end).not.toHaveBeenCalled();
  });
});
