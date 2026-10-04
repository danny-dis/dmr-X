import { describe, expect, it, vi } from 'vitest';
import {
  buildBearerAuthPolicy,
  authenticateBearer,
  type AuthConfigInput,
} from '../../services/mcp-server/src/auth-runtime.js';
import {
  BoundSessionRegistry,
  readSessionBinding,
  type SessionBinding,
} from '../../services/mcp-server/src/session-runtime.js';

const request = (authorization?: string, tenantKey?: string | string[]) => ({
  headers: {
    authorization,
    'x-dmr-tenant-key': tenantKey,
  },
});

function policy(input: Partial<AuthConfigInput>) {
  return buildBearerAuthPolicy({
    simpleKeys: '',
    fileKeyConfigs: undefined,
    envKeyConfigsRaw: undefined,
    ...input,
  });
}

describe('MCP production bearer policy', () => {
  it('enables auth for config-only key records instead of failing open', () => {
    const configured = policy({
      fileKeyConfigs: [{ key: 'config-only', allowedTools: ['dmrx_status'] }],
    });

    expect(configured.configured).toBe(true);
    expect(authenticateBearer(request(), configured).authorized).toBe(false);
    const accepted = authenticateBearer(request('Bearer config-only'), configured);
    expect(accepted).toMatchObject({ authorized: true, allowedTools: ['dmrx_status'] });
    expect(accepted.principalId).not.toContain('config-only');
  });

  it('accepts valid env-only key configuration', () => {
    const configured = policy({
      envKeyConfigsRaw: JSON.stringify([{ key: 'env-only', allowedTools: ['dmrx_status'] }]),
    });

    expect(configured.configured).toBe(true);
    expect(authenticateBearer(request('Bearer env-only'), configured).authorized).toBe(true);
    expect(authenticateBearer(request('Bearer wrong'), configured).authorized).toBe(false);
  });

  it.each([
    '{',
    '{}',
    '[{"allowedTools":[]}]',
    '[{"key":"ok","allowedTools":"dmrx_status"}]',
  ])('fails closed for malformed configured auth: %s', (envKeyConfigsRaw) => {
    const configured = policy({ envKeyConfigsRaw });

    expect(configured).toMatchObject({ configured: true, malformed: true });
    expect(authenticateBearer(request('Bearer ok'), configured).authorized).toBe(false);
  });

  it('does not enable auth when no source is configured', () => {
    const configured = policy({});
    expect(configured).toMatchObject({ configured: false, malformed: false });
    expect(authenticateBearer(request(), configured)).toMatchObject({
      authorized: true,
      principalId: 'anonymous',
    });
  });
});

describe('MCP production session binding and cleanup', () => {
  const binding = (principalId: string, tenantKey?: string): SessionBinding => ({ principalId, tenantKey });

  it('binds sessions to both authenticated principal and downstream tenant key', () => {
    const close = vi.fn(async () => undefined);
    const registry = new BoundSessionRegistry<{ transport: { close: typeof close }; server: { close: typeof close } }>(2);
    registry.add('session', binding('principal-a', 'tenant-a'), {
      transport: { close },
      server: { close },
    });

    expect(registry.get('session', binding('principal-a', 'tenant-a'))).toBeDefined();
    expect(registry.get('session', binding('principal-b', 'tenant-a'))).toBeUndefined();
    expect(registry.get('session', binding('principal-a', 'tenant-b'))).toBeUndefined();
    expect(registry.get('session', binding('principal-a'))).toBeUndefined();
  });

  it('rejects ambiguous tenant headers rather than changing a binding', () => {
    expect(readSessionBinding(request('Bearer key', ['tenant-a', 'tenant-b']).headers, 'principal')).toEqual({ ok: false });
    expect(readSessionBinding(request('Bearer key', 'tenant-a').headers, 'principal')).toEqual({
      ok: true,
      binding: binding('principal', 'tenant-a'),
    });
  });

  it('closes transport and server when capacity eviction removes the oldest session', async () => {
    const firstTransportClose = vi.fn(async () => undefined);
    const firstServerClose = vi.fn(async () => undefined);
    const registry = new BoundSessionRegistry(1);
    registry.add('first', binding('principal-a'), {
      transport: { close: firstTransportClose },
      server: { close: firstServerClose },
    });

    await registry.add('second', binding('principal-b'), {
      transport: { close: vi.fn(async () => undefined) },
      server: { close: vi.fn(async () => undefined) },
    });

    expect(registry.has('first')).toBe(false);
    expect(registry.has('second')).toBe(true);
    expect(firstTransportClose).toHaveBeenCalledOnce();
    expect(firstServerClose).toHaveBeenCalledOnce();
  });

  it('closes both resources exactly once after initialization failure cleanup', async () => {
    const transportClose = vi.fn(async () => undefined);
    const serverClose = vi.fn(async () => undefined);
    const registry = new BoundSessionRegistry(2);
    registry.add('failed', binding('principal'), {
      transport: { close: transportClose },
      server: { close: serverClose },
    });

    await registry.close('failed');
    await registry.close('failed');

    expect(transportClose).toHaveBeenCalledOnce();
    expect(serverClose).toHaveBeenCalledOnce();
  });
});
