import type { FastifyInstance } from 'fastify';

export async function requestIdMiddleware(server: FastifyInstance): Promise<void> {
  server.addHook('onRequest', async (request) => {
    if (!request.id) {
      request.id = crypto.randomUUID();
    }
  });
}
