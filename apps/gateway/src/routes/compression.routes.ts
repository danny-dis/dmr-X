import { ValidationError } from '@dmr-x/core';
import { logger } from '@dmr-x/utils';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { compressionService } from '../services/compression.js';

const CompressionConfigSchema = z.object({
  enabled: z.boolean().optional(),
  proxyUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  reversible: z.boolean().optional(),
  minTokensToCompress: z.number().positive().optional(),
  engine: z.enum(['headroom', 'rtk', 'caveman', 'comment-strip', 'auto']).optional(),
});

const CompressionRetrieveSchema = z.object({
  compressedId: z.string().min(1),
});

const CompressionPreviewSchema = z.object({
  text: z.string().min(1).max(20000),
  engine: z.enum(['headroom', 'rtk', 'caveman', 'comment-strip', 'auto']).optional(),
  rtkOptions: z
    .object({
      maxRepeated: z.number().optional(),
      maxItems: z.number().optional(),
      trimWhitespace: z.boolean().optional(),
      collapseBlankLines: z.boolean().optional(),
    })
    .optional(),
  cavemanOptions: z
    .object({
      aggressiveness: z.number().optional(),
      preserveTechnical: z.boolean().optional(),
      maxLineLength: z.number().optional(),
    })
    .optional(),
  commentStripOptions: z
    .object({
      removeSingleLine: z.boolean().optional(),
      removeMultiLine: z.boolean().optional(),
      removeDocblocks: z.boolean().optional(),
      language: z.string().optional(),
    })
    .optional(),
  minTokensToCompress: z.number().int().min(0).max(1000000).optional(),
});

export async function compressionRoutes(server: FastifyInstance): Promise<void> {
  // Get global compression config
  server.get('/compression/config', async (_request, reply) => {
    try {
      const config = compressionService.getGlobalConfig();
      return config;
    } catch (err) {
      logger.error({ err }, 'Failed to get compression config');
      reply.status(500);
      return { error: 'Failed to get compression config' };
    }
  });

  // Update global compression config
  server.put('/compression/config', async (request, reply) => {
    const parsed = CompressionConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request', details: parsed.error.errors };
    }

    try {
      await compressionService.updateGlobalConfig(parsed.data);
      return compressionService.getGlobalConfig();
    } catch (err) {
      logger.error({ err }, 'Failed to update compression config');
      reply.status(500);
      return { error: 'Failed to update compression config' };
    }
  });

  // Preview a compression pass over raw sample text (no cache/DB side effects).
  server.post('/compression/preview', async (request, reply) => {
    const parsed = CompressionPreviewSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request', details: parsed.error.errors };
    }
    try {
      const preview = await compressionService.previewCompression(parsed.data.text, {
        engine: parsed.data.engine,
        rtkOptions: parsed.data.rtkOptions,
        cavemanOptions: parsed.data.cavemanOptions,
        commentStripOptions: parsed.data.commentStripOptions as
          import('../services/engines/comment-stripper').CommentStripOptions,
        minTokensToCompress: parsed.data.minTokensToCompress,
      });
      return preview;
    } catch (err) {
      logger.error({ err }, 'Failed to preview compression');
      reply.status(500);
      return { error: 'Failed to preview compression' };
    }
  });

  // Get tenant compression config
  server.get('/compression/tenant/:tenantId', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
  
    try {
      const config = compressionService.getTenantConfig(tenantId);
      return config || compressionService.getGlobalConfig();
    } catch (err) {
      logger.error({ err, tenantId }, 'Failed to get tenant compression config');
      reply.status(500);
      return { error: 'Failed to get tenant compression config' };
    }
  });

  // Update tenant compression config
  server.put('/compression/tenant/:tenantId', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const parsed = CompressionConfigSchema.safeParse(request.body);
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
    
    try {
      const config = compressionService.getApiKeyConfig(apiKeyId);
      return config || compressionService.getGlobalConfig();
    } catch (err) {
      logger.error({ err, apiKeyId }, 'Failed to get API key compression config');
      reply.status(500);
      return { error: 'Failed to get API key compression config' };
    }
  });

  // Update API key compression config
  server.put('/compression/apikey/:apiKeyId', async (request, reply) => {
    const { apiKeyId } = request.params as { apiKeyId: string };
    const parsed = CompressionConfigSchema.safeParse(request.body);
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

    try {
      const original = await compressionService.retrieveOriginal(compressedId);
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
    
    try {
      const stats = await compressionService.getCompressionStats(tenantId);
      return stats;
    } catch (err) {
      logger.error({ err }, 'Failed to get compression stats');
      reply.status(500);
      return { error: 'Failed to get compression stats' };
    }
  });

  // Cleanup expired cache
  server.post('/compression/cleanup', async (_request, reply) => {
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