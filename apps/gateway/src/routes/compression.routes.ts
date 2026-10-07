import { ValidationError } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';
import { getDb } from '@dmr-x/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { cachedAdminKey, DEPLOYMENT_MODE, LOCAL_MODE } from '../middleware/auth.middleware.js';

import { compressionService } from '../services/compression.js';
import { CompressionConfigSchema } from '../services/compression-config.js';

const CompressionRetrieveSchema = z.object({
  compressedId: z.string().min(1),
});

function tenantOf(request: FastifyRequest): { id: string; role?: string; apiKeyId?: string } | undefined {
  return (request as FastifyRequest & { tenant?: { id: string; role?: string; apiKeyId?: string } }).tenant;
}

function isGlobalAdmin(request: FastifyRequest): boolean {
  if (DEPLOYMENT_MODE === 'managed') return false;
  if (LOCAL_MODE) return true;
  const expected = cachedAdminKey;
  if (!expected || expected === 'replace-with-admin-key') return false;
  const bearer = request.headers.authorization;
  const candidate = typeof bearer === 'string' && bearer.startsWith('Bearer ')
    ? bearer.slice(7).trim()
    : typeof request.headers['x-api-key'] === 'string' ? request.headers['x-api-key'] : '';
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  const length = Math.max(256, candidateBuffer.length, expectedBuffer.length);
  const actual = Buffer.alloc(length);
  const configured = Buffer.alloc(length);
  candidateBuffer.copy(actual);
  expectedBuffer.copy(configured);
  return timingSafeEqual(actual, configured) && candidateBuffer.length === expectedBuffer.length && candidateBuffer.length > 0;
}

function tenantExists(tenantId: string): boolean {
  return Boolean(getDb().prepare('SELECT 1 FROM tenants WHERE id = ?').get(tenantId));
}

function apiKeyTenant(apiKeyId: string): string | undefined {
  const row = getDb().prepare('SELECT tenant_id FROM api_keys WHERE id = ?').get(apiKeyId) as { tenant_id: string } | undefined;
  return row?.tenant_id;
}

function publicConfig<T extends Record<string, unknown>>(config: T): Omit<T, 'apiKey'> {
  const { apiKey: _secret, ...safe } = config;
  return safe;
}

export async function compressionRoutes(server: FastifyInstance): Promise<void> {
  // Get global compression config
  server.get('/compression/config', async (request, reply) => {
    if (!isGlobalAdmin(request)) return reply.code(401).send({ error: 'Unauthorized' });
    try {
      return publicConfig(compressionService.getGlobalConfig() as unknown as Record<string, unknown>);
    } catch (err) {
      logger.error({ err }, 'Failed to get compression config');
      reply.status(500);
      return { error: 'Failed to get compression config' };
    }
  });

  // Update global compression config
  server.put('/compression/config', async (request, reply) => {
    if (!isGlobalAdmin(request)) return reply.code(401).send({ error: 'Unauthorized' });
    const parsed = CompressionConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request', details: parsed.error.errors };
    }

    try {
      await compressionService.updateGlobalConfig(parsed.data);
      return publicConfig(compressionService.getGlobalConfig() as unknown as Record<string, unknown>);
    } catch (err) {
      logger.error({ err }, 'Failed to update compression config');
      reply.status(500);
      return { error: 'Failed to update compression config' };
    }
  });

  // Get tenant compression config
  server.get('/compression/tenant/:tenantId', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const caller = tenantOf(request);
    if (!caller) return reply.code(401).send({ error: 'Unauthorized' });
    if (caller.id !== tenantId || !tenantExists(tenantId)) return reply.code(404).send({ error: 'Not found' });
    
    try {
      const config = compressionService.getTenantConfig(tenantId);
      return config ? publicConfig(config as Record<string, unknown>) : null;
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to get tenant compression config');
      reply.status(500);
      return { error: 'Failed to get tenant compression config' };
    }
  });

  // Update tenant compression config
  server.put('/compression/tenant/:tenantId', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const caller = tenantOf(request);
    if (!caller) return reply.code(401).send({ error: 'Unauthorized' });
    if (caller.id !== tenantId || !tenantExists(tenantId)) return reply.code(404).send({ error: 'Not found' });
    const parsed = CompressionConfigSchema.safeParse(request.body);
    if (parsed.success && (parsed.data.proxyUrl !== undefined || parsed.data.apiKey !== undefined || parsed.data.minTokensToCompress !== undefined)) {
      return reply.code(400).send({ error: 'Global-only compression settings are not supported here' });
    }
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request', details: parsed.error.errors };
    }

    try {
      await compressionService.updateTenantConfig(tenantId, parsed.data);
      return compressionService.getTenantConfig(tenantId);
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to update tenant compression config');
      reply.status(500);
      return { error: 'Failed to update tenant compression config' };
    }
  });

  // Get API key compression config
  server.get('/compression/apikey/:apiKeyId', async (request, reply) => {
    const { apiKeyId } = request.params as { apiKeyId: string };
    const caller = tenantOf(request);
    if (!caller) return reply.code(401).send({ error: 'Unauthorized' });
    const ownerTenant = apiKeyTenant(apiKeyId);
    if (!ownerTenant || ownerTenant !== caller.id || (caller.apiKeyId !== apiKeyId && caller.role !== 'admin')) return reply.code(404).send({ error: 'Not found' });
    
    try {
      const config = compressionService.getApiKeyConfig(apiKeyId);
      return config ? publicConfig(config as Record<string, unknown>) : null;
    } catch (err) {
      logger.error({ err, apiKeyId }, 'Failed to get API key compression config');
      reply.status(500);
      return { error: 'Failed to get API key compression config' };
    }
  });

  // Update API key compression config
  server.put('/compression/apikey/:apiKeyId', async (request, reply) => {
    const { apiKeyId } = request.params as { apiKeyId: string };
    const caller = tenantOf(request);
    if (!caller) return reply.code(401).send({ error: 'Unauthorized' });
    const ownerTenant = apiKeyTenant(apiKeyId);
    if (!ownerTenant || ownerTenant !== caller.id || (caller.apiKeyId !== apiKeyId && caller.role !== 'admin')) return reply.code(404).send({ error: 'Not found' });
    const parsed = CompressionConfigSchema.safeParse(request.body);
    if (parsed.success && (parsed.data.proxyUrl !== undefined || parsed.data.apiKey !== undefined || parsed.data.minTokensToCompress !== undefined)) {
      return reply.code(400).send({ error: 'Global-only compression settings are not supported here' });
    }
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request', details: parsed.error.errors };
    }

    try {
      await compressionService.updateApiKeyConfig(apiKeyId, parsed.data);
      return compressionService.getApiKeyConfig(apiKeyId);
    } catch (err) {
      logger.error({ err, apiKeyId }, 'Failed to update API key compression config');
      reply.status(500);
      return { error: 'Failed to update API key compression config' };
    }
  });

  // Retrieve original content (CCR)
  server.post('/compression/retrieve', async (request, reply) => {
    const parsed = CompressionRetrieveSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const { compressedId } = parsed.data;
    const caller = tenantOf(request);
    if (!caller) return reply.code(401).send({ error: 'Unauthorized' });

    try {
      const original = await compressionService.retrieveOriginal(compressedId, { tenantId: caller.id, apiKeyId: caller.apiKeyId });
      if (!original) {
        reply.status(404);
        return { error: 'Original content not found or expired' };
      }
      return { original };
    } catch (err) {
      logger.error({ err, compressedId }, 'Failed to retrieve original content');
      reply.status(500);
      return { error: 'Failed to retrieve original content' };
    }
  });

  // Get compression statistics
  server.get('/compression/stats', async (request, reply) => {
    const { tenantId } = request.query as { tenantId?: string };
    const caller = tenantOf(request);
    if (!caller && !isGlobalAdmin(request)) return reply.code(401).send({ error: 'Unauthorized' });
    if (caller && tenantId && tenantId !== caller.id) return reply.code(403).send({ error: 'Forbidden' });
    const scopedTenantId = caller ? caller.id : tenantId;
    
    try {
      const stats = await compressionService.getCompressionStats(scopedTenantId);
      return stats;
    } catch (err) {
      logger.error({ err }, 'Failed to get compression stats');
      reply.status(500);
      return { error: 'Failed to get compression stats' };
    }
  });

  // Cleanup expired cache
  server.post('/compression/cleanup', async (request, reply) => {
    if (!isGlobalAdmin(request)) return reply.code(401).send({ error: 'Unauthorized' });
    try {
      await compressionService.cleanupExpiredCache();
      return { success: true };
    } catch (err) {
      logger.error({ err }, 'Failed to cleanup compression cache');
      reply.status(500);
      return { error: 'Failed to cleanup compression cache' };
    }
  });
}