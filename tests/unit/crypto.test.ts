import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateId,
  generateRequestId,
  generateApiKey,
  hashApiKey,
  encrypt,
  decrypt,
  encryptConfigApiKey,
  decryptConfigApiKey,
} from '../../packages/utils/src/crypto.js';

describe('Crypto: generateId', () => {
  it('should generate a 32-character hex string', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe('Crypto: generateRequestId', () => {
  it('should start with req_ prefix', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^req_[0-9a-f]{32}$/);
  });

  it('should generate unique request IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
    expect(ids.size).toBe(100);
  });
});

describe('Crypto: generateApiKey', () => {
  it('should start with dmr- prefix', () => {
    const key = generateApiKey();
    expect(key).toMatch(/^dmr-[0-9a-f]{64}$/);
  });

  it('should generate unique API keys', () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateApiKey()));
    expect(keys.size).toBe(100);
  });
});

describe('Crypto: hashApiKey', () => {
  it('should produce a SHA-256 hex hash', () => {
    const hash = hashApiKey('test-key');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should be deterministic', () => {
    const hash1 = hashApiKey('same-key');
    const hash2 = hashApiKey('same-key');
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different inputs', () => {
    const hash1 = hashApiKey('key-1');
    const hash2 = hashApiKey('key-2');
    expect(hash1).not.toBe(hash2);
  });
});

describe('Crypto: encrypt/decrypt round-trip', () => {
  const originalEnv = process.env.DMRX_ENCRYPTION_KEY;

  beforeEach(() => {
    // Use a test encryption key (32 bytes = 64 hex chars)
    process.env.DMRX_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.DMRX_ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.DMRX_ENCRYPTION_KEY;
    }
  });

  it('should round-trip a simple string', () => {
    const plaintext = 'my-secret-api-key-12345';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should fail to decrypt an empty encrypted string (no ciphertext)', () => {
    // Empty plaintext produces only IV + authTag with no ciphertext,
    // which is too short for the decrypt guard to accept.
    const plaintext = '';
    const encrypted = encrypt(plaintext);
    expect(() => decrypt(encrypted)).toThrow('Encrypted data is too short');
  });

  it('should round-trip a long string', () => {
    const plaintext = 'a'.repeat(10000);
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should round-trip a string with special characters', () => {
    const plaintext = 'key-with-spaces & special=chars!@#$%^&*()';
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for the same plaintext (random IV)', () => {
    const plaintext = 'same-plaintext';
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);
    expect(encrypted1).not.toBe(encrypted2);
    // Both should decrypt to the same value
    expect(decrypt(encrypted1)).toBe(plaintext);
    expect(decrypt(encrypted2)).toBe(plaintext);
  });

  it('should fail to decrypt with wrong key', () => {
    const plaintext = 'secret-data';
    const encrypted = encrypt(plaintext);

    // Change to a different key
    process.env.DMRX_ENCRYPTION_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    expect(() => decrypt(encrypted)).toThrow();
  });

  it('should fail to decrypt garbage data', () => {
    expect(() => decrypt('not-valid-hex-data')).toThrow();
  });
});

describe('Crypto: encrypt/decrypt graceful fallback', () => {
  const originalEnv = process.env.DMRX_ENCRYPTION_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.DMRX_ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.DMRX_ENCRYPTION_KEY;
    }
  });

  it('should return plaintext when no encryption key is set (encrypt)', () => {
    delete process.env.DMRX_ENCRYPTION_KEY;
    const plaintext = 'my-api-key';
    expect(encrypt(plaintext)).toBe(plaintext);
  });

  it('should return input unchanged when no encryption key is set (decrypt)', () => {
    delete process.env.DMRX_ENCRYPTION_KEY;
    const input = 'my-api-key';
    expect(decrypt(input)).toBe(input);
  });
});

describe('Crypto: encryptConfigApiKey/decryptConfigApiKey', () => {
  const originalEnv = process.env.DMRX_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.DMRX_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.DMRX_ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.DMRX_ENCRYPTION_KEY;
    }
  });

  it('should encrypt the apiKey field in a config object', () => {
    const config = { apiKey: 'secret-key', other: 'value' };
    const encrypted = encryptConfigApiKey(config);
    expect(encrypted.apiKey).not.toBe('secret-key');
    expect(typeof encrypted.apiKey).toBe('string');
  });

  it('should round-trip through encryptConfigApiKey then decryptConfigApiKey', () => {
    const config = { apiKey: 'secret-key', other: 'value' };
    encryptConfigApiKey(config);
    decryptConfigApiKey(config);
    expect(config.apiKey).toBe('secret-key');
  });

  it('should skip empty apiKey', () => {
    const config = { apiKey: '' };
    encryptConfigApiKey(config);
    expect(config.apiKey).toBe('');
  });

  it('should skip non-string apiKey', () => {
    const config = { apiKey: 12345 };
    encryptConfigApiKey(config);
    expect(config.apiKey).toBe(12345);
  });

  it('should handle config without apiKey', () => {
    const config = { baseUrl: 'https://api.openai.com' };
    const result = encryptConfigApiKey(config);
    expect(result).toEqual({ baseUrl: 'https://api.openai.com' });
  });
});

describe('Crypto: encryptConfigApiKey fallback', () => {
  const originalEnv = process.env.DMRX_ENCRYPTION_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.DMRX_ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.DMRX_ENCRYPTION_KEY;
    }
  });

  it('should leave apiKey unchanged when no encryption key', () => {
    delete process.env.DMRX_ENCRYPTION_KEY;
    const config = { apiKey: 'plaintext-key' };
    encryptConfigApiKey(config);
    expect(config.apiKey).toBe('plaintext-key');
  });

  it('should leave already-encrypted key unchanged via decryptConfigApiKey', () => {
    process.env.DMRX_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const config = { apiKey: 'secret' };
    encryptConfigApiKey(config);
    const encrypted = config.apiKey;

    // Switch to different key
    process.env.DMRX_ENCRYPTION_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    config.apiKey = encrypted;

    // Should not throw — graceful fallback leaves value as-is
    decryptConfigApiKey(config);
    expect(config.apiKey).toBe(encrypted);
  });
});

describe('Crypto: invalid encryption key', () => {
  const originalEnv = process.env.DMRX_ENCRYPTION_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.DMRX_ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.DMRX_ENCRYPTION_KEY;
    }
  });

  it('should throw on invalid key length', () => {
    process.env.DMRX_ENCRYPTION_KEY = 'tooshort';
    expect(() => encrypt('test')).toThrow('DMRX_ENCRYPTION_KEY must be exactly 32 bytes');
  });

  it('should throw on non-hex key', () => {
    process.env.DMRX_ENCRYPTION_KEY = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
    expect(() => encrypt('test')).toThrow();
  });
});
