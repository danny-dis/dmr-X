"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestClient = void 0;
class TestClient {
    baseUrl;
    apiKey;
    constructor(baseUrl = 'http://localhost:3000', apiKey) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }
    async request(path, requestBody) {
        const headers = {
            'Content-Type': 'application/json',
        };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        const response = await fetch(`${this.baseUrl}${path}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
    }
    async getModels() {
        const response = await fetch(`${this.baseUrl}/v1/models`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
    }
}
exports.TestClient = TestClient;
//# sourceMappingURL=test-client.js.map