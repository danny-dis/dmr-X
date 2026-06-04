import pino from 'pino';
const isBun = typeof Bun !== 'undefined';
export function createLogger(name) {
    return pino({
        name,
        level: process.env.LOG_LEVEL || 'info',
        transport: !isBun && process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
    });
}
export const logger = createLogger('dmr-x');
//# sourceMappingURL=logger.js.map