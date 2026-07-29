import { logger } from '@dmr-x/utils';
import { getRateLimitTracker, type KeyQuotaStatus } from './rate-limit-tracker.js';
import { compareKeyQuota } from './dynamic-limits.js';

export interface KeyInfo {
  providerId: string;
  keyIndex: number;
  keyId: string; // masked identifier for logging
  keyHash: string; // hashed key for DB lookups
  isActive: boolean;
  penaltyScore: number;
  lastUsed: number;
}

export type RotationStrategy = 'round-robin' | 'smart' | 'least-recently-used';

/**
 * Manages multiple API keys per provider with intelligent rotation.
 *
 * Supports three rotation strategies:
 * - round-robin: Classic sequential rotation
 * - smart: Prefers keys with more remaining quota
 * - least-recently-used: Prefers keys used least recently
 *
 * Keys are loaded from env vars:
 *   GROQ_API_KEYS=key1,key2,key3  (comma-separated)
 *   or GROQ_API_KEY_1, GROQ_API_KEY_2, GROQ_API_KEY_3
 */
export class KeyRotationService {
  private keys = new Map<string, string[]>(); // providerId -> keys[]
  private currentIndex = new Map<string, number>(); // providerId -> round-robin index
  private keyMetadata = new Map<string, KeyInfo[]>(); // providerId -> key metadata
  private rotationStrategy: RotationStrategy = 'smart';

  /**
   * Set the rotation strategy
   */
  setStrategy(strategy: RotationStrategy): void {
    this.rotationStrategy = strategy;
    logger.info({ strategy }, 'Key rotation strategy updated');
  }

  /**
   * Load keys for a provider from environment variables
   */
  loadKeys(providerId: string): string[] {
    const envPrefix = providerId.toUpperCase().replace(/-/g, '_');

    // Try comma-separated first: GROQ_API_KEYS=key1,key2
    const multiKey = process.env[`${envPrefix}_API_KEYS`];
    if (multiKey) {
      const keys = multiKey.split(',').map((k) => k.trim()).filter(Boolean);
      if (keys.length > 0) {
        this.keys.set(providerId, keys);
        this.currentIndex.set(providerId, 0);
        this.initKeyMetadata(providerId, keys);
        logger.info({ providerId, keyCount: keys.length }, 'Loaded multiple API keys');
        return keys;
      }
    }

    // Try numbered: GROQ_API_KEY_1, GROQ_API_KEY_2, ...
    const numberedKeys: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const key = process.env[`${envPrefix}_API_KEY_${i}`];
      if (key) {
        numberedKeys.push(key);
      } else {
        break;
      }
    }

    if (numberedKeys.length > 0) {
      this.keys.set(providerId, numberedKeys);
      this.currentIndex.set(providerId, 0);
      this.initKeyMetadata(providerId, numberedKeys);
      logger.info({ providerId, keyCount: numberedKeys.length }, 'Loaded numbered API keys');
      return numberedKeys;
    }

    // Fall back to single key: GROQ_API_KEY
    const singleKey = process.env[`${envPrefix}_API_KEY`];
    if (singleKey) {
      this.keys.set(providerId, [singleKey]);
      this.currentIndex.set(providerId, 0);
      this.initKeyMetadata(providerId, [singleKey]);
      return [singleKey];
    }

    return [];
  }

  /**
   * Register a key pool from a source other than the environment — in
   * practice the encrypted `provider_keys` vault, handed over by the
   * adapter's `setKeys()`.
   *
   * Without this, `loadKeys` was the only way into the pool map, so the
   * vault was invisible to rotation: a provider with one env key and five
   * vault keys resolved `getNextKey()` against the single env key and
   * returned it for every request. Smart rotation looked healthy while
   * actually pinning all traffic to one credential, which is precisely
   * what exhausts a free tier.
   *
   * Re-registering an identical pool is a no-op so repeated adapter
   * initialisation does not reset the round-robin cursor or the
   * last-used timestamps that drive LRU and smart selection.
   */
  registerKeys(providerId: string, keys: string[]): void {
    const deduped = [...new Set(keys.filter(Boolean))];
    if (deduped.length === 0) return;

    const existing = this.keys.get(providerId);
    if (
      existing &&
      existing.length === deduped.length &&
      existing.every((k, i) => k === deduped[i])
    ) {
      return;
    }

    this.keys.set(providerId, deduped);
    this.currentIndex.set(providerId, 0);
    this.initKeyMetadata(providerId, deduped);
    logger.info(
      { providerId, keyCount: deduped.length },
      'Registered API key pool from provider vault',
    );
  }

  /**
   * Per-key selection counts, `providerId -> keyHash -> count`.
   *
   * Rotation was previously unobservable: nothing recorded which credential
   * served a request, so "is the pool actually balancing?" could only be
   * guessed at from upstream 429 rates. These counters make the distribution
   * directly inspectable (see `getRotationStats`).
   */
  private selectionCounts = new Map<string, Map<string, number>>();

  private recordSelection(providerId: string, key: string): void {
    let perKey = this.selectionCounts.get(providerId);
    if (!perKey) {
      perKey = new Map();
      this.selectionCounts.set(providerId, perKey);
    }
    const id = this.maskKey(key);
    perKey.set(id, (perKey.get(id) ?? 0) + 1);
  }

  /**
   * Selection counts per provider, for operators checking that a multi-key
   * pool is spreading load rather than pinning to one credential.
   */
  getRotationStats(): Array<{
    providerId: string;
    keyCount: number;
    strategy: RotationStrategy;
    selections: Array<{ key: string; count: number }>;
  }> {
    const out: Array<{
      providerId: string;
      keyCount: number;
      strategy: RotationStrategy;
      selections: Array<{ key: string; count: number }>;
    }> = [];
    for (const [providerId, keys] of this.keys) {
      const perKey = this.selectionCounts.get(providerId);
      // Include every key in the pool, even ones never chosen — a zero is the
      // most important number here, because it means that key is dead weight.
      const selections = keys.map((k) => ({
        key: this.maskKey(k),
        count: perKey?.get(this.maskKey(k)) ?? 0,
      }));
      out.push({ providerId, keyCount: keys.length, strategy: this.rotationStrategy, selections });
    }
    return out;
  }

  /**
   * Get the next available key using the configured rotation strategy
   */
  getNextKey(providerId: string, modelId?: string): string | null {
    const keys = this.keys.get(providerId);
    if (!keys || keys.length === 0) return null;

    if (keys.length === 1) {
      this.recordSelection(providerId, keys[0]);
      return keys[0];
    }

    let selected: string | null;
    switch (this.rotationStrategy) {
      case 'smart':
        selected = this.getSmartKey(providerId, modelId);
        break;
      case 'least-recently-used':
        selected = this.getLRUKey(providerId);
        break;
      case 'round-robin':
      default:
        selected = this.getRoundRobinKey(providerId);
        break;
    }
    if (selected) this.recordSelection(providerId, selected);
    return selected;
  }

  /**
   * Get key with most remaining quota (smart rotation)
   */
  private getSmartKey(providerId: string, modelId?: string): string | null {
    const keys = this.keys.get(providerId);
    if (!keys || keys.length === 0) return null;

    const tracker = getRateLimitTracker();
    const quotaStatuses = tracker.getKeysWithQuota(providerId, modelId);

    // If we have quota data, use it
    if (quotaStatuses.length > 0) {
      // Filter out exhausted keys
      const availableKeys = quotaStatuses.filter(s => !s.isExhausted);
      
      if (availableKeys.length > 0) {
        // Sort by quota (most remaining first)
        availableKeys.sort(compareKeyQuota);
        
        // Find the corresponding raw key
        const bestStatus = availableKeys[0];
        const keyIndex = keys.findIndex(k => this.hashKey(k) === bestStatus.keyId);
        if (keyIndex >= 0) {
          this.updateLastUsed(providerId, keyIndex);
          return keys[keyIndex];
        }
      }
    }

    // Fallback to round-robin if no quota data
    return this.getRoundRobinKey(providerId);
  }

  /**
   * Get least recently used key
   */
  private getLRUKey(providerId: string): string | null {
    const keys = this.keys.get(providerId);
    const metadata = this.keyMetadata.get(providerId);
    if (!keys || !metadata || keys.length === 0) return null;

    // Find the key with oldest lastUsed timestamp
    let oldestIndex = 0;
    let oldestTime = Infinity;

    for (let i = 0; i < metadata.length; i++) {
      if (metadata[i].isActive && metadata[i].lastUsed < oldestTime) {
        oldestTime = metadata[i].lastUsed;
        oldestIndex = i;
      }
    }

    this.updateLastUsed(providerId, oldestIndex);
    return keys[oldestIndex];
  }

  /**
   * Classic round-robin rotation
   */
  private getRoundRobinKey(providerId: string): string | null {
    const keys = this.keys.get(providerId);
    if (!keys || keys.length === 0) return null;

    const currentIndex = this.currentIndex.get(providerId) || 0;
    const key = keys[currentIndex % keys.length];
    this.currentIndex.set(providerId, (currentIndex + 1) % keys.length);

    return key;
  }

  /**
   * Get a specific key by index
   */
  getKey(providerId: string, index: number): string | null {
    const keys = this.keys.get(providerId);
    if (!keys || index >= keys.length) return null;
    return keys[index];
  }

  /**
   * Get the count of keys for a provider
   */
  getKeyCount(providerId: string): number {
    return this.keys.get(providerId)?.length || 0;
  }

  /**
   * Get all keys for a provider
   */
  getAllKeys(providerId: string): string[] {
    return this.keys.get(providerId) || [];
  }

  /**
   * Check if a provider has multiple keys
   */
  hasMultipleKeys(providerId: string): boolean {
    return (this.keys.get(providerId)?.length || 0) > 1;
  }

  /**
   * Get a masked key identifier for logging (first 4 + last 4 chars)
   */
  maskKey(key: string): string {
    if (key.length <= 8) return '****';
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }

  /**
   * Hash a key for DB lookups (SHA-256, first 16 chars)
   */
  hashKey(key: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  }

  /**
   * Get quota status for all keys of a provider
   */
  getQuotaStatuses(providerId: string, modelId?: string): KeyQuotaStatus[] {
    const tracker = getRateLimitTracker();
    return tracker.getKeysWithQuota(providerId, modelId);
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private initKeyMetadata(providerId: string, keys: string[]): void {
    const metadata: KeyInfo[] = keys.map((key, index) => ({
      providerId,
      keyIndex: index,
      keyId: this.maskKey(key),
      keyHash: this.hashKey(key),
      isActive: true,
      penaltyScore: 0,
      lastUsed: 0,
    }));
    this.keyMetadata.set(providerId, metadata);
  }

  private updateLastUsed(providerId: string, keyIndex: number): void {
    const metadata = this.keyMetadata.get(providerId);
    if (metadata && metadata[keyIndex]) {
      metadata[keyIndex].lastUsed = Date.now();
    }
  }
}

export const keyRotationService = new KeyRotationService();
