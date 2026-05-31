import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { timingSafeEqual } from 'node:crypto';

/**
 * Auth Middleware Tests
 *
 * Tests the authentication logic extracted from auth.middleware.ts.
 * Since the middleware is tightly coupled to Fastify, we test the
 * core logic functions directly.
 */

// --- Extracted auth logic for testability ---

function extractApiKey(request: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  if (request.headers['x-api-key']) {
    return request.headers['x-api-key'] as string;
  }
  return undefined;
}

function checkAdminAuth(
  request: { headers: Record<string, string | string[] | undefined>; url: string },
  adminApiKey: string | undefined
): { authorized: boolean; reason?: string } {
  const pathname = request.url.split('?')[0];

  if (!pathname.startsWith('/v1/admin')) {
    return { authorized: true };
  }

  if (!adminApiKey) {
    return { authorized: false, reason: 'Admin API not configured' };
  }

  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return { authorized: false, reason: 'Invalid admin API key' };
  }

  const keyBuf = Buffer.from(apiKey);
  const adminBuf = Buffer.from(adminApiKey);
  if (keyBuf.length !== adminBuf.length || !timingSafeEqual(keyBuf, adminBuf)) {
    return { authorized: false, reason: 'Invalid admin API key' };
  }

  return { authorized: true };
}

function isPublicRoute(url: string): boolean {
  const PUBLIC_ROUTES = new Set(['/health', '/healthz', '/livez', '/ready', '/v1/models']);
  const pathname = url.split('?')[0];
  return PUBLIC_ROUTES.has(pathname);
}

// --- Tests ---

describe('Auth: extractApiKey', () => {
  it('should extract Bearer token from Authorization header', () => {
    const request = { headers: { authorization: 'Bearer my-api-key-123' } };
    expect(extractApiKey(request)).toBe('my-api-key-123');
  });

  it('should extract x-api-key header', () => {
    const request = { headers: { 'x-api-key': 'my-api-key-456' } };
    expect(extractApiKey(request)).toBe('my-api-key-456');
  });

  it('should return undefined when no auth headers present', () => {
    const request = { headers: {} };
    expect(extractApiKey(request)).toBeUndefined();
  });

  it('should prefer Bearer token over x-api-key', () => {
    const request = {
      headers: {
        authorization: 'Bearer bearer-key',
        'x-api-key': 'header-key',
      },
    };
    expect(extractApiKey(request)).toBe('bearer-key');
  });

  it('should handle Authorization header without Bearer prefix', () => {
    const request = { headers: { authorization: 'Basic abc123' } };
    expect(extractApiKey(request)).toBeUndefined();
  });

  it('should handle empty Authorization header', () => {
    const request = { headers: { authorization: '' } };
    expect(extractApiKey(request)).toBeUndefined();
  });
});

describe('Auth: isPublicRoute', () => {
  it('should recognize /health as public', () => {
    expect(isPublicRoute('/health')).toBe(true);
  });

  it('should recognize /healthz as public', () => {
    expect(isPublicRoute('/healthz')).toBe(true);
  });

  it('should recognize /livez as public', () => {
    expect(isPublicRoute('/livez')).toBe(true);
  });

  it('should recognize /ready as public', () => {
    expect(isPublicRoute('/ready')).toBe(true);
  });

  it('should recognize /v1/models as public', () => {
    expect(isPublicRoute('/v1/models')).toBe(true);
  });

  it('should strip query strings before matching', () => {
    expect(isPublicRoute('/v1/models?limit=10')).toBe(true);
    expect(isPublicRoute('/health?detail=true')).toBe(true);
  });

  it('should reject non-public routes', () => {
    expect(isPublicRoute('/v1/chat/completions')).toBe(false);
    expect(isPublicRoute('/v1/admin/providers')).toBe(false);
    expect(isPublicRoute('/v1/images/generations')).toBe(false);
  });

  it('should reject partial matches', () => {
    expect(isPublicRoute('/healthz-extra')).toBe(false);
    expect(isPublicRoute('/v1/modelsExtra')).toBe(false);
  });
});

describe('Auth: checkAdminAuth', () => {
  const ADMIN_KEY = 'test-admin-key-12345678';

  it('should allow non-admin routes without auth', () => {
    const request = {
      headers: {},
      url: '/v1/chat/completions',
    };
    const result = checkAdminAuth(request, ADMIN_KEY);
    expect(result.authorized).toBe(true);
  });

  it('should require admin key for /v1/admin routes', () => {
    const request = {
      headers: {},
      url: '/v1/admin/providers',
    };
    const result = checkAdminAuth(request, ADMIN_KEY);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('Invalid admin API key');
  });

  it('should fail when admin key is not configured', () => {
    const request = {
      headers: { authorization: `Bearer some-key` },
      url: '/v1/admin/providers',
    };
    const result = checkAdminAuth(request, undefined);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('Admin API not configured');
  });

  it('should accept correct admin key', () => {
    const request = {
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      url: '/v1/admin/providers',
    };
    const result = checkAdminAuth(request, ADMIN_KEY);
    expect(result.authorized).toBe(true);
  });

  it('should reject incorrect admin key', () => {
    const request = {
      headers: { authorization: 'Bearer wrong-key' },
      url: '/v1/admin/providers',
    };
    const result = checkAdminAuth(request, ADMIN_KEY);
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('Invalid admin API key');
  });

  it('should reject admin key with different length', () => {
    const request = {
      headers: { authorization: 'Bearer short' },
      url: '/v1/admin/providers',
    };
    const result = checkAdminAuth(request, ADMIN_KEY);
    expect(result.authorized).toBe(false);
  });

  it('should require auth even on admin health-like sub-routes', () => {
    const request = {
      headers: {},
      url: '/v1/admin/providers/test-id',
    };
    const result = checkAdminAuth(request, ADMIN_KEY);
    expect(result.authorized).toBe(false);
  });

  it('should accept admin key via x-api-key header', () => {
    const request = {
      headers: { 'x-api-key': ADMIN_KEY },
      url: '/v1/admin/providers',
    };
    const result = checkAdminAuth(request, ADMIN_KEY);
    expect(result.authorized).toBe(true);
  });
});
