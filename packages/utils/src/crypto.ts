import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

export function generateId(): string {
  return randomBytes(16).toString('hex');
}

export function generateRequestId(): string {
  return `req_${generateId()}`;
}

export function generateApiKey(): string {
  return `dmr-${randomBytes(32).toString('hex')}`;
}

/**
 * @deprecated Use hashApiKeyWithSalt() for new keys. This function is kept
 * for backward compatibility during migration.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Hash an API key with a random salt for secure storage.
 * Returns format: "salt:hash" where salt is 16 bytes hex and hash is SHA-256.
 *
 * This prevents rainbow table attacks if the database is compromised.
 */
export function hashApiKeyWithSalt(key: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(salt + key).digest('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify an API key against a stored hash.
 * Supports both legacy unsalted hashes and new salted hashes.
 *
 * @param key - The plaintext API key to verify
 * @param storedHash - The hash from the database (either "hash" or "salt:hash" format)
 * @returns true if the key matches
 */
export function verifyApiKey(key: string, storedHash: string): boolean {
  // Check if this is a salted hash (contains exactly one colon separator)
  const colonIndex = storedHash.indexOf(':');
  const secondColonIndex = storedHash.indexOf(':', colonIndex + 1);

  if (colonIndex !== -1 && secondColonIndex === -1) {
    // Salted hash format: "salt:hash"
    const salt = storedHash.substring(0, colonIndex);
    const expectedHash = storedHash.substring(colonIndex + 1);
    const computedHash = createHash('sha256').update(salt + key).digest('hex');

    // Constant-time comparison to prevent timing attacks
    try {
      return timingSafeEqual(Buffer.from(computedHash), Buffer.from(expectedHash));
    } catch {
      return false;
    }
  } else {
    // Legacy unsalted hash format: just "hash"
    // Still works but is less secure
    const computedHash = createHash('sha256').update(key).digest('hex');
    try {
      return timingSafeEqual(Buffer.from(computedHash), Buffer.from(storedHash));
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// AES-256-GCM encryption for sensitive data at rest (e.g. API keys)
// Uses a 32-byte key from DMRX_ENCRYPTION_KEY env var (hex-encoded).
// Format: iv(12 bytes) + authTag(16 bytes) + ciphertext
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer | null {
  const hexKey = process.env.DMRX_ENCRYPTION_KEY;
  if (!hexKey) return null;
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) {
    throw new Error('DMRX_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)');
  }
  return key;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a hex-encoded string: iv + authTag + ciphertext.
 * If DMRX_ENCRYPTION_KEY is not set, returns the plaintext unchanged (graceful fallback).
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) return plaintext; // graceful fallback

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: iv || authTag || ciphertext
  return Buffer.concat([iv, authTag, encrypted]).toString('hex');
}

/**
 * Decrypt a hex-encoded string produced by encrypt().
 * If DMRX_ENCRYPTION_KEY is not set, returns the input unchanged (graceful fallback).
 */
export function decrypt(encryptedHex: string): string {
  const key = getEncryptionKey();
  if (!key) return encryptedHex; // graceful fallback

  const data = Buffer.from(encryptedHex, 'hex');
  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('Encrypted data is too short');
  }

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}

/**
 * Encrypt the `apiKey` field inside a config object (in-place).
 * If DMRX_ENCRYPTION_KEY is not set, the value passes through unchanged.
 */
export function encryptConfigApiKey(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof config.apiKey === 'string' && config.apiKey.length > 0) {
    config.apiKey = encrypt(config.apiKey);
  }
  return config;
}

/**
 * Decrypt the `apiKey` field inside a config object (in-place).
 * If DMRX_ENCRYPTION_KEY is not set, the value passes through unchanged.
 * If decryption fails (e.g. already plaintext during migration), the value is left as-is.
 */
export function decryptConfigApiKey(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof config.apiKey === 'string' && config.apiKey.length > 0) {
    try {
      config.apiKey = decrypt(config.apiKey);
    } catch (err) {
      // Value may already be plaintext (migration period) — log and leave as-is
      console.warn(`[dmr-x] Failed to decrypt config apiKey, treating as plaintext: ${err instanceof Error ? err.message : err}`);
    }
  }
  return config;
}

/**
 * Encrypt OAuth tokens (access + refresh) stored in provider config (in-place).
 */
export function encryptOAuthTokens(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof config.oauthAccessToken === 'string' && config.oauthAccessToken.length > 0) {
    config.oauthAccessToken = encrypt(config.oauthAccessToken);
  }
  if (typeof config.oauthRefreshToken === 'string' && config.oauthRefreshToken.length > 0) {
    config.oauthRefreshToken = encrypt(config.oauthRefreshToken);
  }
  return config;
}

/**
 * Decrypt OAuth tokens (access + refresh) stored in provider config (in-place).
 */
export function decryptOAuthTokens(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof config.oauthAccessToken === 'string' && config.oauthAccessToken.length > 0) {
    try {
      config.oauthAccessToken = decrypt(config.oauthAccessToken);
    } catch (err) {
      console.warn(`[dmr-x] Failed to decrypt oauthAccessToken, treating as plaintext: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (typeof config.oauthRefreshToken === 'string' && config.oauthRefreshToken.length > 0) {
    try {
      config.oauthRefreshToken = decrypt(config.oauthRefreshToken);
    } catch (err) {
      console.warn(`[dmr-x] Failed to decrypt oauthRefreshToken, treating as plaintext: ${err instanceof Error ? err.message : err}`);
    }
  }
  return config;
}
