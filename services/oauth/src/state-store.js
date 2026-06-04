import { randomBytes } from 'node:crypto';
/**
 * In-memory state store for OAuth CSRF protection.
 * Entries expire after 10 minutes.
 */
class OAuthStateStore {
    states = new Map();
    TTL_MS = 10 * 60 * 1000; // 10 minutes
    constructor() {
        // Clean up expired entries every 5 minutes
        setInterval(() => this.cleanup(), 5 * 60 * 1000).unref();
    }
    /**
     * Store a state parameter with optional PKCE code verifier.
     * Returns the generated state string.
     */
    set(providerId, codeVerifier) {
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
    consume(state) {
        const entry = this.states.get(state);
        if (!entry)
            return null;
        this.states.delete(state);
        if (entry.expiresAt < Date.now())
            return null;
        return entry;
    }
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.states) {
            if (entry.expiresAt < now) {
                this.states.delete(key);
            }
        }
    }
}
export const oauthStateStore = new OAuthStateStore();
//# sourceMappingURL=state-store.js.map