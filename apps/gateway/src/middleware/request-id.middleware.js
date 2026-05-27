export async function requestIdMiddleware(server) {
    server.addHook('onRequest', async (request) => {
        if (!request.id) {
            request.id = crypto.randomUUID();
        }
    });
}
//# sourceMappingURL=request-id.middleware.js.map