"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const crypto_js_1 = require("../../packages/utils/src/crypto.js");
(0, vitest_1.describe)('Crypto: generateId', () => {
    (0, vitest_1.it)('should generate a 32-character hex string', () => {
        const id = (0, crypto_js_1.generateId)();
        (0, vitest_1.expect)(id).toMatch(/^[0-9a-f]{32}$/);
    });
    (0, vitest_1.it)('should generate unique IDs', () => {
        const ids = new Set(Array.from({ length: 100 }, () => (0, crypto_js_1.generateId)()));
        (0, vitest_1.expect)(ids.size).toBe(100);
    });
});
(0, vitest_1.describe)('Crypto: generateRequestId', () => {
    (0, vitest_1.it)('should start with req_ prefix', () => {
        const id = (0, crypto_js_1.generateRequestId)();
        (0, vitest_1.expect)(id).toMatch(/^req_[0-9a-f]{32}$/);
    });
    (0, vitest_1.it)('should generate unique request IDs', () => {
        const ids = new Set(Array.from({ length: 100 }, () => (0, crypto_js_1.generateRequestId)()));
        (0, vitest_1.expect)(ids.size).toBe(100);
    });
});
(0, vitest_1.describe)('Crypto: generateApiKey', () => {
    (0, vitest_1.it)('should start with dmr- prefix', () => {
        const key = (0, crypto_js_1.generateApiKey)();
        (0, vitest_1.expect)(key).toMatch(/^dmr-[0-9a-f]{64}$/);
    });
    (0, vitest_1.it)('should generate unique API keys', () => {
        const keys = new Set(Array.from({ length: 100 }, () => (0, crypto_js_1.generateApiKey)()));
        (0, vitest_1.expect)(keys.size).toBe(100);
    });
});
(0, vitest_1.describe)('Crypto: hashApiKey', () => {
    (0, vitest_1.it)('should produce a SHA-256 hex hash', () => {
        const hash = (0, crypto_js_1.hashApiKey)('test-key');
        (0, vitest_1.expect)(hash).toMatch(/^[0-9a-f]{64}$/);
    });
    (0, vitest_1.it)('should be deterministic', () => {
        const hash1 = (0, crypto_js_1.hashApiKey)('same-key');
        const hash2 = (0, crypto_js_1.hashApiKey)('same-key');
        (0, vitest_1.expect)(hash1).toBe(hash2);
    });
    (0, vitest_1.it)('should produce different hashes for different inputs', () => {
        const hash1 = (0, crypto_js_1.hashApiKey)('key-1');
        const hash2 = (0, crypto_js_1.hashApiKey)('key-2');
        (0, vitest_1.expect)(hash1).not.toBe(hash2);
    });
});
(0, vitest_1.describe)('Crypto: encrypt/decrypt round-trip', () => {
    const originalEnv = process.env.DMRX_ENCRYPTION_KEY;
    (0, vitest_1.beforeEach)(() => {
        // Use a test encryption key (32 bytes = 64 hex chars)
        process.env.DMRX_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    });
    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.DMRX_ENCRYPTION_KEY = originalEnv;
        }
        else {
            delete process.env.DMRX_ENCRYPTION_KEY;
        }
    });
    (0, vitest_1.it)('should round-trip a simple string', () => {
        const plaintext = 'my-secret-api-key-12345';
        const encrypted = (0, crypto_js_1.encrypt)(plaintext);
        const decrypted = (0, crypto_js_1.decrypt)(encrypted);
        (0, vitest_1.expect)(decrypted).toBe(plaintext);
    });
    (0, vitest_1.it)('should fail to decrypt an empty encrypted string (no ciphertext)', () => {
        // Empty plaintext produces only IV + authTag with no ciphertext,
        // which is too short for the decrypt guard to accept.
        const plaintext = '';
        const encrypted = (0, crypto_js_1.encrypt)(plaintext);
        (0, vitest_1.expect)(() => (0, crypto_js_1.decrypt)(encrypted)).toThrow('Encrypted data is too short');
    });
    (0, vitest_1.it)('should round-trip a long string', () => {
        const plaintext = 'a'.repeat(10000);
        const encrypted = (0, crypto_js_1.encrypt)(plaintext);
        const decrypted = (0, crypto_js_1.decrypt)(encrypted);
        (0, vitest_1.expect)(decrypted).toBe(plaintext);
    });
    (0, vitest_1.it)('should round-trip a string with special characters', () => {
        const plaintext = 'key-with-spaces & special=chars!@#$%^&*()';
        const encrypted = (0, crypto_js_1.encrypt)(plaintext);
        const decrypted = (0, crypto_js_1.decrypt)(encrypted);
        (0, vitest_1.expect)(decrypted).toBe(plaintext);
    });
    (0, vitest_1.it)('should produce different ciphertext for the same plaintext (random IV)', () => {
        const plaintext = 'same-plaintext';
        const encrypted1 = (0, crypto_js_1.encrypt)(plaintext);
        const encrypted2 = (0, crypto_js_1.encrypt)(plaintext);
        (0, vitest_1.expect)(encrypted1).not.toBe(encrypted2);
        // Both should decrypt to the same value
        (0, vitest_1.expect)((0, crypto_js_1.decrypt)(encrypted1)).toBe(plaintext);
        (0, vitest_1.expect)((0, crypto_js_1.decrypt)(encrypted2)).toBe(plaintext);
    });
    (0, vitest_1.it)('should fail to decrypt with wrong key', () => {
        const plaintext = 'secret-data';
        const encrypted = (0, crypto_js_1.encrypt)(plaintext);
        // Change to a different key
        process.env.DMRX_ENCRYPTION_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
        (0, vitest_1.expect)(() => (0, crypto_js_1.decrypt)(encrypted)).toThrow();
    });
    (0, vitest_1.it)('should fail to decrypt garbage data', () => {
        (0, vitest_1.expect)(() => (0, crypto_js_1.decrypt)('not-valid-hex-data')).toThrow();
    });
});
(0, vitest_1.describe)('Crypto: encrypt/decrypt graceful fallback', () => {
    const originalEnv = process.env.DMRX_ENCRYPTION_KEY;
    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.DMRX_ENCRYPTION_KEY = originalEnv;
        }
        else {
            delete process.env.DMRX_ENCRYPTION_KEY;
        }
    });
    (0, vitest_1.it)('should return plaintext when no encryption key is set (encrypt)', () => {
        delete process.env.DMRX_ENCRYPTION_KEY;
        const plaintext = 'my-api-key';
        (0, vitest_1.expect)((0, crypto_js_1.encrypt)(plaintext)).toBe(plaintext);
    });
    (0, vitest_1.it)('should return input unchanged when no encryption key is set (decrypt)', () => {
        delete process.env.DMRX_ENCRYPTION_KEY;
        const input = 'my-api-key';
        (0, vitest_1.expect)((0, crypto_js_1.decrypt)(input)).toBe(input);
    });
});
(0, vitest_1.describe)('Crypto: encryptConfigApiKey/decryptConfigApiKey', () => {
    const originalEnv = process.env.DMRX_ENCRYPTION_KEY;
    (0, vitest_1.beforeEach)(() => {
        process.env.DMRX_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    });
    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.DMRX_ENCRYPTION_KEY = originalEnv;
        }
        else {
            delete process.env.DMRX_ENCRYPTION_KEY;
        }
    });
    (0, vitest_1.it)('should encrypt the apiKey field in a config object', () => {
        const config = { apiKey: 'secret-key', other: 'value' };
        const encrypted = (0, crypto_js_1.encryptConfigApiKey)(config);
        (0, vitest_1.expect)(encrypted.apiKey).not.toBe('secret-key');
        (0, vitest_1.expect)(typeof encrypted.apiKey).toBe('string');
    });
    (0, vitest_1.it)('should round-trip through encryptConfigApiKey then decryptConfigApiKey', () => {
        const config = { apiKey: 'secret-key', other: 'value' };
        (0, crypto_js_1.encryptConfigApiKey)(config);
        (0, crypto_js_1.decryptConfigApiKey)(config);
        (0, vitest_1.expect)(config.apiKey).toBe('secret-key');
    });
    (0, vitest_1.it)('should skip empty apiKey', () => {
        const config = { apiKey: '' };
        (0, crypto_js_1.encryptConfigApiKey)(config);
        (0, vitest_1.expect)(config.apiKey).toBe('');
    });
    (0, vitest_1.it)('should skip non-string apiKey', () => {
        const config = { apiKey: 12345 };
        (0, crypto_js_1.encryptConfigApiKey)(config);
        (0, vitest_1.expect)(config.apiKey).toBe(12345);
    });
    (0, vitest_1.it)('should handle config without apiKey', () => {
        const config = { baseUrl: 'https://api.openai.com' };
        const result = (0, crypto_js_1.encryptConfigApiKey)(config);
        (0, vitest_1.expect)(result).toEqual({ baseUrl: 'https://api.openai.com' });
    });
});
(0, vitest_1.describe)('Crypto: encryptConfigApiKey fallback', () => {
    const originalEnv = process.env.DMRX_ENCRYPTION_KEY;
    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.DMRX_ENCRYPTION_KEY = originalEnv;
        }
        else {
            delete process.env.DMRX_ENCRYPTION_KEY;
        }
    });
    (0, vitest_1.it)('should leave apiKey unchanged when no encryption key', () => {
        delete process.env.DMRX_ENCRYPTION_KEY;
        const config = { apiKey: 'plaintext-key' };
        (0, crypto_js_1.encryptConfigApiKey)(config);
        (0, vitest_1.expect)(config.apiKey).toBe('plaintext-key');
    });
    (0, vitest_1.it)('should leave already-encrypted key unchanged via decryptConfigApiKey', () => {
        process.env.DMRX_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
        const config = { apiKey: 'secret' };
        (0, crypto_js_1.encryptConfigApiKey)(config);
        const encrypted = config.apiKey;
        // Switch to different key
        process.env.DMRX_ENCRYPTION_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
        config.apiKey = encrypted;
        // Should not throw — graceful fallback leaves value as-is
        (0, crypto_js_1.decryptConfigApiKey)(config);
        (0, vitest_1.expect)(config.apiKey).toBe(encrypted);
    });
});
(0, vitest_1.describe)('Crypto: invalid encryption key', () => {
    const originalEnv = process.env.DMRX_ENCRYPTION_KEY;
    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.DMRX_ENCRYPTION_KEY = originalEnv;
        }
        else {
            delete process.env.DMRX_ENCRYPTION_KEY;
        }
    });
    (0, vitest_1.it)('should throw on invalid key length', () => {
        process.env.DMRX_ENCRYPTION_KEY = 'tooshort';
        (0, vitest_1.expect)(() => (0, crypto_js_1.encrypt)('test')).toThrow('DMRX_ENCRYPTION_KEY must be exactly 32 bytes');
    });
    (0, vitest_1.it)('should throw on non-hex key', () => {
        process.env.DMRX_ENCRYPTION_KEY = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
        (0, vitest_1.expect)(() => (0, crypto_js_1.encrypt)('test')).toThrow();
    });
});
//# sourceMappingURL=crypto.test.js.map