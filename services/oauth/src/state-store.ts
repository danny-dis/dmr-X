import { randomBytes } from 'node:crypto';

interface StateEntry {
  codeVerifier?: string;
  providerId: string;
  expiresAt: number;
}

/**
 * In-memory state store for OAuth CSRF protection.
 * Entries expire after 10 minutes.
 */
class OAuthStateStore {
  private states = new Map<string, StateEntry>();
  private readonly TTL_MS = 10 * 60 * 1000; // 10 minutes

  constructor() {
    // Clean up expired entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
  }

  /**
   * Store a state parameter with optional PKCE code verifier.
   * Returns the generated state string.
   */
  set(providerId: string, codeVerifier?: string): string {
    const state = randomBytes(32).toString('hex');
    this.states.set(state, {
      codeVerifier,
      providerId,
      expiresAt: Date.now() + this.TTL_MS,
    });
    return state;
  }

  /**
   * Retrieve and consume a state entry (one-time use).
   * Returns null if the state is missing or expired.
   */
  consume(state: string): StateEntry | null {
    const entry = this.states.get(state);
    if (!entry) return null;
    this.states.delete(state);
    if (entry.expiresAt < Date.now()) return null;
    return entry;
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.states) {
      if (entry.expiresAt < now) {
        this.states.delete(key);
      }
    }
  }
}

export const oauthStateStore = new OAuthStateStore();
