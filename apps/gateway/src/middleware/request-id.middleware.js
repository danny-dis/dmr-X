export async function requestIdMiddleware(server) {
    server.addHook('onRequest', async (request) => {
        if (!request.id) {
            request.id = crypto.randomUUID();
        }
    });
}
// Ensure middleware is not encapsulated
requestIdMiddleware[Symbol.for('skip-override')] = true;
//# sourceMappingURL=request-id.middleware.js.map