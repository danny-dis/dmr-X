"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const test_client_js_1 = require("./test-client.js");
const describeE2E = process.env.DMRX_RUN_E2E === 'true' ? vitest_1.describe : vitest_1.describe.skip;
describeE2E('Gateway Connectivity', () => {
    let client;
    (0, vitest_1.beforeAll)(() => {
        client = new test_client_js_1.TestClient();
    });
    (0, vitest_1.it)('should be reachable and return models', async () => {
        try {
            const models = await client.getModels();
            (0, vitest_1.expect)(models).toBeDefined();
            (0, vitest_1.expect)(Array.isArray(models.data)).toBe(true);
        }
        catch (error) {
            throw new Error(`Gateway unreachable: ${error.message}`);
        }
    });
});
//# sourceMappingURL=connectivity.test.js.map