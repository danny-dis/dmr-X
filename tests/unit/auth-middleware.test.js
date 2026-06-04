"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_crypto_1 = require("node:crypto");
/**
 * Auth Middleware Tests
 *
 * Tests the authentication logic extracted from auth.middleware.ts.
 * Since the middleware is tightly coupled to Fastify, we test the
 * core logic functions directly.
 */
// --- Extracted auth logic for testability ---
function extractApiKey(request) {
    const authHeader = request.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        const bearerToken = authHeader.slice(7).trim();
        return bearerToken.length > 0 ? bearerToken : undefined;
    }
    const headerApiKey = request.headers['x-api-key'];
    if (Array.isArray(headerApiKey)) {
        const apiKey = headerApiKey.find(value => value.trim().length > 0)?.trim();
        return apiKey || undefined;
    }
    if (typeof headerApiKey === 'string') {
        const apiKey = headerApiKey.trim();
        return apiKey.length > 0 ? apiKey : undefined;
    }
    return undefined;
}
function checkAdminAuth(request, adminApiKey) {
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
    if (keyBuf.length !== adminBuf.length || !(0, node_crypto_1.timingSafeEqual)(keyBuf, adminBuf)) {
        return { authorized: false, reason: 'Invalid admin API key' };
    }
    return { authorized: true };
}
function isPublicRoute(url) {
    const PUBLIC_ROUTES = new Set(['/health', '/healthz', '/livez', '/ready', '/v1/models']);
    const pathname = url.split('?')[0];
    return PUBLIC_ROUTES.has(pathname);
}
// --- Tests ---
(0, vitest_1.describe)('Auth: extractApiKey', () => {
    (0, vitest_1.it)('should extract Bearer token from Authorization header', () => {
        const request = { headers: { authorization: 'Bearer my-api-key-123' } };
        (0, vitest_1.expect)(extractApiKey(request)).toBe('my-api-key-123');
    });
    (0, vitest_1.it)('should extract x-api-key header', () => {
        const request = { headers: { 'x-api-key': 'my-api-key-456' } };
        (0, vitest_1.expect)(extractApiKey(request)).toBe('my-api-key-456');
    });
    (0, vitest_1.it)('should return undefined when no auth headers present', () => {
        const request = { headers: {} };
        (0, vitest_1.expect)(extractApiKey(request)).toBeUndefined();
    });
    (0, vitest_1.it)('should prefer Bearer token over x-api-key', () => {
        const request = {
            headers: {
                authorization: 'Bearer bearer-key',
                'x-api-key': 'header-key',
            },
        };
        (0, vitest_1.expect)(extractApiKey(request)).toBe('bearer-key');
    });
    (0, vitest_1.it)('should handle Authorization header without Bearer prefix', () => {
        const request = { headers: { authorization: 'Basic abc123' } };
        (0, vitest_1.expect)(extractApiKey(request)).toBeUndefined();
    });
    (0, vitest_1.it)('should handle empty Authorization header', () => {
        const request = { headers: { authorization: '' } };
        (0, vitest_1.expect)(extractApiKey(request)).toBeUndefined();
    });
    (0, vitest_1.it)('should reject an empty Bearer token', () => {
        const request = { headers: { authorization: 'Bearer   ' } };
        (0, vitest_1.expect)(extractApiKey(request)).toBeUndefined();
    });
    (0, vitest_1.it)('should handle x-api-key arrays by using the first non-empty value', () => {
        const request = { headers: { 'x-api-key': [' ', ' array-key '] } };
        (0, vitest_1.expect)(extractApiKey(request)).toBe('array-key');
    });
});
(0, vitest_1.describe)('Auth: isPublicRoute', () => {
    (0, vitest_1.it)('should recognize /health as public', () => {
        (0, vitest_1.expect)(isPublicRoute('/health')).toBe(true);
    });
    (0, vitest_1.it)('should recognize /healthz as public', () => {
        (0, vitest_1.expect)(isPublicRoute('/healthz')).toBe(true);
    });
    (0, vitest_1.it)('should recognize /livez as public', () => {
        (0, vitest_1.expect)(isPublicRoute('/livez')).toBe(true);
    });
    (0, vitest_1.it)('should recognize /ready as public', () => {
        (0, vitest_1.expect)(isPublicRoute('/ready')).toBe(true);
    });
    (0, vitest_1.it)('should recognize /v1/models as public', () => {
        (0, vitest_1.expect)(isPublicRoute('/v1/models')).toBe(true);
    });
    (0, vitest_1.it)('should strip query strings before matching', () => {
        (0, vitest_1.expect)(isPublicRoute('/v1/models?limit=10')).toBe(true);
        (0, vitest_1.expect)(isPublicRoute('/health?detail=true')).toBe(true);
    });
    (0, vitest_1.it)('should reject non-public routes', () => {
        (0, vitest_1.expect)(isPublicRoute('/v1/chat/completions')).toBe(false);
        (0, vitest_1.expect)(isPublicRoute('/v1/admin/providers')).toBe(false);
        (0, vitest_1.expect)(isPublicRoute('/v1/images/generations')).toBe(false);
    });
    (0, vitest_1.it)('should reject partial matches', () => {
        (0, vitest_1.expect)(isPublicRoute('/healthz-extra')).toBe(false);
        (0, vitest_1.expect)(isPublicRoute('/v1/modelsExtra')).toBe(false);
    });
});
(0, vitest_1.describe)('Auth: checkAdminAuth', () => {
    const ADMIN_KEY = 'test-admin-key-12345678';
    (0, vitest_1.it)('should allow non-admin routes without auth', () => {
        const request = {
            headers: {},
            url: '/v1/chat/completions',
        };
        const result = checkAdminAuth(request, ADMIN_KEY);
        (0, vitest_1.expect)(result.authorized).toBe(true);
    });
    (0, vitest_1.it)('should require admin key for /v1/admin routes', () => {
        const request = {
            headers: {},
            url: '/v1/admin/providers',
        };
        const result = checkAdminAuth(request, ADMIN_KEY);
        (0, vitest_1.expect)(result.authorized).toBe(false);
        (0, vitest_1.expect)(result.reason).toBe('Invalid admin API key');
    });
    (0, vitest_1.it)('should fail when admin key is not configured', () => {
        const request = {
            headers: { authorization: `Bearer some-key` },
            url: '/v1/admin/providers',
        };
        const result = checkAdminAuth(request, undefined);
        (0, vitest_1.expect)(result.authorized).toBe(false);
        (0, vitest_1.expect)(result.reason).toBe('Admin API not configured');
    });
    (0, vitest_1.it)('should accept correct admin key', () => {
        const request = {
            headers: { authorization: `Bearer ${ADMIN_KEY}` },
            url: '/v1/admin/providers',
        };
        const result = checkAdminAuth(request, ADMIN_KEY);
        (0, vitest_1.expect)(result.authorized).toBe(true);
    });
    (0, vitest_1.it)('should reject incorrect admin key', () => {
        const request = {
            headers: { authorization: 'Bearer wrong-key' },
            url: '/v1/admin/providers',
        };
        const result = checkAdminAuth(request, ADMIN_KEY);
        (0, vitest_1.expect)(result.authorized).toBe(false);
        (0, vitest_1.expect)(result.reason).toBe('Invalid admin API key');
    });
    (0, vitest_1.it)('should reject admin key with different length', () => {
        const request = {
            headers: { authorization: 'Bearer short' },
            url: '/v1/admin/providers',
        };
        const result = checkAdminAuth(request, ADMIN_KEY);
        (0, vitest_1.expect)(result.authorized).toBe(false);
    });
    (0, vitest_1.it)('should require auth even on admin health-like sub-routes', () => {
        const request = {
            headers: {},
            url: '/v1/admin/providers/test-id',
        };
        const result = checkAdminAuth(request, ADMIN_KEY);
        (0, vitest_1.expect)(result.authorized).toBe(false);
    });
    (0, vitest_1.it)('should accept admin key via x-api-key header', () => {
        const request = {
            headers: { 'x-api-key': ADMIN_KEY },
            url: '/v1/admin/providers',
        };
        const result = checkAdminAuth(request, ADMIN_KEY);
        (0, vitest_1.expect)(result.authorized).toBe(true);
    });
});
//# sourceMappingURL=auth-middleware.test.js.map