import { createServer } from './server.js';
import { logger } from '@dmr-x/utils';
import { initDb, closeDb } from '@dmr-x/db';
import { memoryService } from '@dmr-x/memory';
import { workersService } from '@dmr-x/workers';
import { federationService } from '@dmr-x/federation';
const MIN_ADMIN_API_KEY_LENGTH = 32;
function validateStartupConfig() {
    const errors = [];
    const portValue = process.env.PORT || '3000';
    const port = Number(portValue);
    const isProduction = process.env.NODE_ENV === 'production';
    if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push('PORT must be an integer between 1 and 65535');
    }
    if (!isProduction) {
        return failIfInvalid(errors);
    }
    const adminApiKey = process.env.DMRX_ADMIN_API_KEY;
    const encryptionKey = process.env.DMRX_ENCRYPTION_KEY;
    const corsOrigin = process.env.DMRX_CORS_ORIGIN;
    if (process.env.DMRX_LOCAL_MODE === 'true') {
        errors.push('DMRX_LOCAL_MODE must be false in production');
    }
    if (!adminApiKey?.trim() ||
        adminApiKey === 'replace-with-admin-key' ||
        adminApiKey.trim().length < MIN_ADMIN_API_KEY_LENGTH) {
        errors.push(`DMRX_ADMIN_API_KEY must be set to at least ${MIN_ADMIN_API_KEY_LENGTH} characters in production`);
    }
    if (!encryptionKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
        errors.push('DMRX_ENCRYPTION_KEY must be set to 64 hex characters in production');
    }
    if (!corsOrigin || corsOrigin.split(',').some(origin => {
        const value = origin.trim();
        return value.length === 0 || value === '*';
    })) {
        errors.push('DMRX_CORS_ORIGIN must be set to explicit origins in production');
    }
    failIfInvalid(errors);
}
function failIfInvalid(errors) {
    if (errors.length === 0)
        return;
    for (const error of errors) {
        logger.error({ configError: error }, 'Invalid gateway startup configuration');
    }
    process.exit(1);
}
async function main() {
    validateStartupConfig();
    const port = parseInt(process.env.PORT || '3000', 10);
    // Initialize SQLite database (async — loads WASM, runs migrations)
    try {
        await initDb();
        logger.info('SQLite database ready');
    }
    catch (err) {
        logger.error({ err }, 'Failed to initialize database');
        process.exit(1);
    }
    // Start platform services
    memoryService.start();
    workersService.start();
    federationService.start();
    logger.info('Platform services started');
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
    // Graceful shutdown with 30-second timeout
    const SHUTDOWN_TIMEOUT_MS = 30_000;
    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        logger.info({ signal }, 'Shutting down...');
        const forceExitTimer = setTimeout(() => {
            logger.error('Shutdown timed out after 30s, forcing exit');
            process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);
        forceExitTimer.unref();
        try {
            memoryService.stop();
            workersService.stop();
            federationService.stop();
        }
        catch (err) {
            logger.error({ err }, 'Error stopping platform services');
        }
        try {
            await server.close();
        }
        catch (err) {
            logger.error({ err }, 'Error during server.close()');
        }
        try {
            await closeDb();
        }
        catch (err) {
            logger.error({ err }, 'Error during closeDb()');
        }
        logger.info('Shutdown complete');
        process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
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
//# sourceMappingURL=main.js.map