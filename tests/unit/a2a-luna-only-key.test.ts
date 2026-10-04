import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { guardHttpRequest } from '../../services/mcp-server/src/http-security.js';
import {
  buildHttpBearerPolicy,
  authenticateHttpRequest,
  createHttpBearerAuth,
} from '../../services/mcp-server/src/http-auth-session.js';
import {
  authenticateA2ARequest,
  buildA2ABearerPolicy,
  setA2ABearerPolicy,
} from '../../services/mcp-server/src/a2a/security.js';
import {
  installAuthenticatedOwnerResolver,
  resolveOwnerId,
  setOwnerResolver,
} from '../../services/mcp-server/src/a2a/owner.js';

const ENV_KEYS = [
  'DMRX_A2A_API_KEY',
  'DMRX_MCP_API_KEY',
  'DMRX_MCP_API_KEYS_CONFIG',
  'DMRX_A2A_REQUIRE_AUTH',
  'NODE_ENV',
] as const;

const savedEnv: Record<string, string | undefined> = {};

type ResponseStub = {
  status?: number;
  body?: string;
  writeHead: (status: number) => void;
  end: (body: string) => void;
  setHeader: () => void;
};

function responseStub(): ResponseStub {
  return {
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.body = body;
    },
    setHeader() {},
  };
}

function request(path: string, authorization?: string) {
  return {
    method: path === '/sse' ? 'GET' : 'POST',
    url: path,
    headers: authorization ? { authorization } : {},
  } as never;
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  setOwnerResolver(null);
  setA2ABearerPolicy(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  setOwnerResolver(null);
  setA2ABearerPolicy(null);
});

describe('A2A-only static key boundary and ownership', () => {
  it('accepts the static key on A2A, rejects it on both MCP transports, and binds one stable owner', async () => {
    process.env.DMRX_A2A_API_KEY = 'fixture-main';
    process.env.DMRX_MCP_API_KEYS_CONFIG = JSON.stringify([
      { key: 'fixture-restricted', allowedTools: ['dmrx_status'] },
    ]);

    const a2aPolicy = buildA2ABearerPolicy(null);
    setA2ABearerPolicy(a2aPolicy);
    installAuthenticatedOwnerResolver(a2aPolicy);

    expect(authenticateA2ARequest({ authorization: 'Bearer fixture-main' })).toMatchObject({ ok: true });
    expect(authenticateA2ARequest({ authorization: 'Bearer unknown' })).toMatchObject({ ok: false });
    expect(authenticateA2ARequest({ authorization: 'Bearer fixture-restricted' })).toMatchObject({ ok: false });

    const owner = await resolveOwnerId({ authorization: 'Bearer fixture-main' });
    expect(owner).toMatch(/^[0-9a-f]{64}$/);
    await expect(resolveOwnerId({ authorization: 'Bearer fixture-main' })).resolves.toBe(owner);
    await expect(resolveOwnerId({ authorization: 'Bearer unknown' })).resolves.toBeUndefined();
    await expect(resolveOwnerId({ authorization: 'Bearer fixture-restricted' })).resolves.toBeUndefined();

    const a2aAuth = createHttpBearerAuth({ policy: () => a2aPolicy });
    expect(a2aAuth(
      { headers: { authorization: 'Bearer fixture-main' } } as never,
      responseStub() as never,
    ).authorized).toBe(true);

    const mcpPolicy = buildHttpBearerPolicy(null);
    const mcpAuth = (req: never, res: never) => authenticateHttpRequest(req, res, null);

    for (const path of ['/mcp', '/sse']) {
      const response = responseStub();
      expect(guardHttpRequest(request(path, 'Bearer fixture-main'), response as never, '', mcpAuth)).toBe(true);
      expect(mcpAuth(
        { headers: { authorization: 'Bearer fixture-main' } } as never,
        response as never,
      ).authorized).toBe(false);
      expect(response.status).toBe(401);
      expect(mcpPolicy.keys.map(({ key }) => key)).not.toContain('fixture-main');
    }
  });
});
