import { createServer } from './server.js';
import { logger } from '@dmr-x/utils';
import { getPool, closePool, connectRedis, closeRedis } from '@dmr-x/db';
async function main() {
    const port = parseInt(process.env.PORT || '3000', 10);
    // Connect to databases
    try {
        getPool();
        logger.info('Connected to PostgreSQL');
        await connectRedis();
    }
    catch (err) {
        logger.error({ err }, 'Failed to connect to databases');
        process.exit(1);
    }
    // Start server
    const server = await createServer();
    try {
        await server.listen({ port, host: '0.0.0.0' });
        logger.info({ port }, 'DMR-X Gateway running');
    }
    catch (err) {
        logger.error({ err }, 'Failed to start server');
        process.exit(1);
    }
    // Graceful shutdown
    const shutdown = async () => {
        logger.info('Shutting down...');
        await server.close();
        await closePool();
        await closeRedis();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
main();
//# sourceMappingURL=main.js.map