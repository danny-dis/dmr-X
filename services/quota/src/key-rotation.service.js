import { logger } from '@dmr-x/utils';
/**
 * Manages multiple API keys per provider with round-robin rotation
 * and penalty-aware selection.
 *
 * Keys are loaded from env vars:
 *   GROQ_API_KEYS=key1,key2,key3  (comma-separated)
 *   or GROQ_API_KEY_1, GROQ_API_KEY_2, GROQ_API_KEY_3
 */
export class KeyRotationService {
    keys = new Map(); // providerId -> keys[]
    currentIndex = new Map(); // providerId -> round-robin index
    /**
     * Load keys for a provider from environment variables
     */
    loadKeys(providerId) {
        const envPrefix = providerId.toUpperCase().replace(/-/g, '_');
        // Try comma-separated first: GROQ_API_KEYS=key1,key2
        const multiKey = process.env[`${envPrefix}_API_KEYS`];
        if (multiKey) {
            const keys = multiKey.split(',').map((k) => k.trim()).filter(Boolean);
            if (keys.length > 0) {
                this.keys.set(providerId, keys);
                this.currentIndex.set(providerId, 0);
                logger.info({ providerId, keyCount: keys.length }, 'Loaded multiple API keys');
                return keys;
            }
        }
        // Try numbered: GROQ_API_KEY_1, GROQ_API_KEY_2, ...
        const numberedKeys = [];
        for (let i = 1; i <= 10; i++) {
            const key = process.env[`${envPrefix}_API_KEY_${i}`];
            if (key) {
                numberedKeys.push(key);
            }
            else {
                break;
            }
        }
        if (numberedKeys.length > 0) {
            this.keys.set(providerId, numberedKeys);
            this.currentIndex.set(providerId, 0);
            logger.info({ providerId, keyCount: numberedKeys.length }, 'Loaded numbered API keys');
            return numberedKeys;
        }
        // Fall back to single key: GROQ_API_KEY
        const singleKey = process.env[`${envPrefix}_API_KEY`];
        if (singleKey) {
            this.keys.set(providerId, [singleKey]);
            this.currentIndex.set(providerId, 0);
            return [singleKey];
        }
        return [];
    }
    /**
     * Get the next available key using round-robin with penalty avoidance
     */
    getNextKey(providerId) {
        const keys = this.keys.get(providerId);
        if (!keys || keys.length === 0)
            return null;
        if (keys.length === 1)
            return keys[0];
        const currentIndex = this.currentIndex.get(providerId) || 0;
        const key = keys[currentIndex % keys.length];
        this.currentIndex.set(providerId, (currentIndex + 1) % keys.length);
        return key;
    }
    /**
     * Get a specific key by index
     */
    getKey(providerId, index) {
        const keys = this.keys.get(providerId);
        if (!keys || index >= keys.length)
            return null;
        return keys[index];
    }
    /**
     * Get the count of keys for a provider
     */
    getKeyCount(providerId) {
        return this.keys.get(providerId)?.length || 0;
    }
    /**
     * Get all keys for a provider
     */
    getAllKeys(providerId) {
        return this.keys.get(providerId) || [];
    }
    /**
     * Check if a provider has multiple keys
     */
    hasMultipleKeys(providerId) {
        return (this.keys.get(providerId)?.length || 0) > 1;
    }
    /**
     * Get a masked key identifier for logging (first 4 + last 4 chars)
     */
    maskKey(key) {
        if (key.length <= 8)
            return '****';
        return `${key.slice(0, 4)}...${key.slice(-4)}`;
    }
}
export const keyRotationService = new KeyRotationService();
//# sourceMappingURL=key-rotation.service.js.map