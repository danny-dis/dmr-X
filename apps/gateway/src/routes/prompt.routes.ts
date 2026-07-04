/**
 * Prompt Library Routes — L1B3RT4S prompt integration for DMR-X.
 *
 * Provides:
 * - GET  /v1/prompts — List all prompts
 * - GET  /v1/prompts/providers — List providers
 * - GET  /v1/prompts/categories — List categories
 * - GET  /v1/prompts/stats — Get library stats
 * - GET  /v1/prompts/:provider — Get prompts for provider
 * - GET  /v1/prompts/:id — Get single prompt
 * - GET  /v1/prompts/:id/content — Get prompt content
 * - POST /v1/prompts/:id/preview — Preview prompt with sample input
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '@dmr-x/core';
import { getPromptLibrary } from '@dmr-x/prompts';

// ─── Schemas ────────────────────────────────────────────────────────────────

const ListPromptsSchema = z.object({
  provider: z.string().optional(),
  category: z.string().optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().positive().optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});

const PreviewPromptSchema = z.object({
  sample_input: z.string().optional(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

export async function promptRoutes(server: FastifyInstance): Promise<void> {
  const library = getPromptLibrary();

  // Initialize library on first request (lazy init)
  let initialized = false;
  const ensureInitialized = async () => {
    if (!initialized) {
      await library.initialize();
      initialized = true;
    }
  };

  // List all prompts
  server.get('/prompts', async (request) => {
    await ensureInitialized();

    const query = request.query as Record<string, string>;
    const parsed = ListPromptsSchema.safeParse(query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', { errors: parsed.error.errors });
    }

    return library.list(parsed.data);
  });

  // List providers
  server.get('/prompts/providers', async () => {
    await ensureInitialized();
    return { providers: library.getProviders() };
  });

  // List categories
  server.get('/prompts/categories', async () => {
    await ensureInitialized();
    return { categories: library.getCategories() };
  });

  // Get stats
  server.get('/prompts/stats', async () => {
    await ensureInitialized();
    return library.getStats();
  });

  // Get prompts for provider
  server.get('/prompts/:provider', async (request, reply) => {
    await ensureInitialized();

    const { provider } = request.params as { provider: string };
    const prompts = library.getByProvider(provider);

    if (prompts.length === 0) {
      return reply.status(404).send({ error: `No prompts found for provider: ${provider}` });
    }

    return { provider, prompts, count: prompts.length };
  });

  // Get single prompt
  server.get('/prompts/:id', async (request, reply) => {
    await ensureInitialized();

    const { id } = request.params as { id: string };
    const prompt = library.getById(id);

    if (!prompt) {
      return reply.status(404).send({ error: `Prompt not found: ${id}` });
    }

    return prompt;
  });

  // Get prompt content
  server.get('/prompts/:id/content', async (request, reply) => {
    await ensureInitialized();

    const { id } = request.params as { id: string };
    const content = library.getContent(id);

    if (!content) {
      return reply.status(404).send({ error: `Prompt not found: ${id}` });
    }

    return { id, content };
  });

  // Preview prompt
  server.post('/prompts/:id/preview', async (request, reply) => {
    await ensureInitialized();

    const { id } = request.params as { id: string };
    const parsed = PreviewPromptSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { errors: parsed.error.errors });
    }
    const body = parsed.data;

    const result = library.preview({
      prompt_id: id,
      sample_input: body.sample_input,
    });

    if (!result) {
      return reply.status(404).send({ error: `Prompt not found: ${id}` });
    }

    return result;
  });

  // Search prompts
  server.get('/prompts/search/:query', async (request) => {
    await ensureInitialized();

    const { query } = request.params as { query: string };
    const limit = (request.query as Record<string, string>).limit;
    const results = library.search(query, limit ? parseInt(limit) : 10);

    return { query, results, count: results.length };
  });
}
