import { createServer } from './server.js';
import { logger } from '@dmr-x/utils';
import { initDb, closeDb } from '@dmr-x/db';

async function main(): Promise<void> {
  const port = parseInt(process.env.PORT || '3000', 10);

  // Initialize SQLite database (async — loads WASM, runs migrations)
  try {
    await initDb();
    logger.info('SQLite database ready');
  } catch (err) {
    logger.error({ err }, 'Failed to initialize database');
    process.exit(1);
  }

  // Start server
  const server = await createServer();

  try {
    await server.listen({ port, host: '0.0.0.0' });
    logger.info({ port }, 'DMR-X Gateway running');
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await server.close();
    closeDb();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
