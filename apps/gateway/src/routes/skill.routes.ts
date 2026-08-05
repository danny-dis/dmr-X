import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { agentPermissions } from '../middleware/agent-rbac.middleware.js';
import {
  skillService,
  SkillCreateSchema,
  SkillUpdateSchema,
  SkillListQuerySchema,
  fetchGitHubRepoMdFiles,
  extractZipMdFiles,
} from '@dmr-x/agent-registry';

import { logger } from '@dmr-x/utils';

// ---------------------------------------------------------------------------
// Skill Import Request (mirrors AgentImportRequestSchema)
// ---------------------------------------------------------------------------

const SkillImportRequestSchema = z.object({
  mode: z.enum(['text', 'github', 'zip']),
  // text mode
  content: z.string().optional(),
  filename: z.string().optional(),
  // github mode
  githubUrl: z.string().url().optional(),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerSkillRoutes(server: FastifyInstance): void {
  // ── List skills ────────────────────────────────────────────────────────
  server.get('/skills', {
    preHandler: [agentPermissions.read()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const q = request.query as Record<string, unknown>;
    const coerced = {
      ...q,
      limit: q.limit != null ? Number(q.limit) : undefined,
      offset: q.offset != null ? Number(q.offset) : undefined,
    };
    const query = SkillListQuerySchema.partial().parse(coerced);
    const result = await skillService.listSkills(tenant.id, {
      search: query.search,
      tag: query.tag,
      limit: query.limit,
    });
    return reply.send(result);
  });

  // ── Create skill ───────────────────────────────────────────────────────
  server.post('/skills', {
    preHandler: [agentPermissions.create()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const parsed = SkillCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid request', details: parsed.error.issues } });
    }
    const skill = await skillService.createSkill(tenant.id, parsed.data);
    return reply.code(201).send(skill);
  });

  // ── Get skill ──────────────────────────────────────────────────────────
  server.get('/skills/:id', {
    preHandler: [agentPermissions.read()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };
    const skill = await skillService.getSkill(id);
    if (!skill || skill.tenantId !== tenant.id) {
      return reply.code(404).send({ error: { message: 'Skill not found' } });
    }
    return reply.send(skill);
  });

  // ── Update skill ───────────────────────────────────────────────────────
  server.put('/skills/:id', {
    preHandler: [agentPermissions.update()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };
    const parsed = SkillUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { message: 'Invalid request', details: parsed.error.issues } });
    }
    const skill = await skillService.updateSkill(id, tenant.id, parsed.data);
    if (!skill) {
      return reply.code(404).send({ error: { message: 'Skill not found or wrong tenant' } });
    }
    return reply.send(skill);
  });

  // ── Delete skill ───────────────────────────────────────────────────────
  server.delete('/skills/:id', {
    preHandler: [agentPermissions.delete()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const { id } = request.params as { id: string };
    const deleted = await skillService.deleteSkill(id, tenant.id);
    if (!deleted) {
      return reply.code(404).send({ error: { message: 'Skill not found or wrong tenant' } });
    }
    return reply.code(204).send();
  });

  // ── Import skills (text / github / zip) ─────────────────────────────────
  server.post('/skills/import', {
    preHandler: [agentPermissions.create()],
  }, async (request, reply) => {
    const tenant = (request as any).tenant;
    const contentType = String(request.headers['content-type'] ?? '');

    const items: { markdown: string; source: 'md' | 'zip' | 'github'; externalId?: string }[] = [];

    try {
      if (contentType.includes('multipart/form-data')) {
        const data = await (request as any).file();
        if (!data) {
          return reply.code(400).send({ error: { message: 'No file uploaded' } });
        }
        const buffer: Buffer = await data.toBuffer();
        const files = await extractZipMdFiles(buffer);
        for (const [filename, markdown] of files.entries()) {
          items.push({ markdown, source: 'zip', externalId: filename });
        }
      } else {
        const parsed = SkillImportRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: { message: 'Invalid request', details: parsed.error.issues } });
        }
        const body = parsed.data;

        if (body.mode === 'github') {
          if (!body.githubUrl) {
            return reply.code(400).send({ error: { message: 'githubUrl is required for github mode' } });
          }
          const files = await fetchGitHubRepoMdFiles(body.githubUrl);
          for (const [filename, markdown] of files.entries()) {
            items.push({ markdown, source: 'github', externalId: filename });
          }
        } else if (body.mode === 'text') {
          if (!body.content) {
            return reply.code(400).send({ error: { message: 'content is required for text mode' } });
          }
          items.push({ markdown: body.content, source: 'md', externalId: body.filename });
        } else {
          return reply.code(400).send({ error: { message: `Unsupported mode: ${body.mode}` } });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, 'Skill import failed');
      return reply.code(502).send({ error: { message: `Import failed: ${message}` } });
    }

    if (items.length === 0) {
      return reply.code(200).send({ imported: 0, skipped: 0, errors: [], skills: [] });
    }

    const result = await skillService.bulkImportSkills(tenant.id, items);
    return reply.code(201).send(result);
  });
}
