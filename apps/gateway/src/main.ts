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

  // Graceful shutdown with 30-second timeout
  const SHUTDOWN_TIMEOUT_MS = 30_000;
  let shuttingDown = false;

  const shutdown = async (signal?: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down...');

    const forceExitTimer = setTimeout(() => {
      logger.error('Shutdown timed out after 30s, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    // Allow the process to exit even if the timer is still pending
    forceExitTimer.unref();

    try {
      await server.close();
    } catch (err) {
      logger.error({ err }, 'Error during server.close()');
    }
    try {
      await closeDb();
    } catch (err) {
      logger.error({ err }, 'Error during closeDb()');
    }
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Catch unrecoverable errors to ensure clean shutdown
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
    shutdown('unhandledRejection');
  });
}

main();
