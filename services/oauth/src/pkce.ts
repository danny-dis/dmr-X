import { randomBytes, createHash } from 'node:crypto';

/**
 * Generate a PKCE code verifier (RFC 7636 §4.1).
 * 128 bytes of random data, base64url encoded.
 */
export function generateCodeVerifier(): string {
  return randomBytes(128).toString('base64url');
}

/**
 * Generate a PKCE code challenge from a verifier (RFC 7636 §4.2).
 * SHA-256 hash of verifier, base64url encoded.
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
