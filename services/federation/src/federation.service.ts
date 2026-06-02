import { getDb, createNamespacedCache } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';
import crypto from 'node:crypto';
import { PeerClient } from './peer-client.js';
import { HealthProber } from './health-prober.js';
import { BenchmarkSync } from './benchmark-sync.js';

const cache = createNamespacedCache('federation');

export interface FederationNode {
  id: string;
  name: string;
  url: string;
  region: string | null;
  status: string;
  privacyLevel: string;
  latencyMs: number | null;
  lastSyncAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface RegisterNodeInput {
  name: string;
  url: string;
  region?: string;
  apiKey?: string;
  privacyLevel?: string;
}

export class FederationService {
  private peerClient: PeerClient;
  private prober: HealthProber;
  private syncer: BenchmarkSync;
  private probeInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.peerClient = new PeerClient();
    this.prober = new HealthProber();
    this.syncer = new BenchmarkSync();
  }

  start(): void {
    this.probeInterval = setInterval(() => this.probeAll(), 30_000);
    logger.info('Federation service started');
  }

  stop(): void {
    if (this.probeInterval) {
      clearInterval(this.probeInterval);
      this.probeInterval = null;
    }
    logger.info('Federation service stopped');
  }

  register(input: RegisterNodeInput): FederationNode {
    const db = getDb();
    const id = crypto.randomUUID();
    const privacyLevel = input.privacyLevel || 'anonymized';

    db.prepare(`
      INSERT INTO federation_nodes (id, name, url, region, status, api_key_ref, privacy_level)
      VALUES (?, ?, ?, ?, 'offline', ?, ?)
    `).run(id, input.name, input.url, input.region || null, input.apiKey || null, privacyLevel);

    logger.info(`Federation peer registered: ${input.name} (${input.url})`);
    return this.getById(id)!;
  }

  getById(id: string): FederationNode | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM federation_nodes WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  list(): FederationNode[] {
    const cached = cache.get('list');
    if (cached) return JSON.parse(cached);

    const db = getDb();
    const rows = db.prepare('SELECT * FROM federation_nodes ORDER BY created_at DESC').all() as any[];
    const nodes = rows.map(r => this.mapRow(r));
    cache.set('list', JSON.stringify(nodes), 30);
    return nodes;
  }

  unregister(id: string): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM federation_nodes WHERE id = ?').run(id);
    cache.delete('list');
    return result.changes > 0;
  }

  async healthCheck(id: string): Promise<FederationNode | null> {
    const node = this.getById(id);
    if (!node) return null;

    const result = await this.prober.check(node.url);

    const db = getDb();
    db.prepare(`
      UPDATE federation_nodes
      SET status = ?, latency_ms = ?, last_seen_at = datetime('now')
      WHERE id = ?
    `).run(result.status, result.latencyMs, id);

    cache.delete('list');
    return this.getById(id);
  }

  async syncBenchmark(id: string): Promise<boolean> {
    const node = this.getById(id);
    if (!node) return false;

    const success = await this.syncer.sync(node.url, node.privacyLevel);
    if (success) {
      const db = getDb();
      db.prepare(`
        UPDATE federation_nodes SET last_sync_at = datetime('now') WHERE id = ?
      `).run(id);
      cache.delete('list');
    }
    return success;
  }

  getBestPeer(): FederationNode | null {
    const nodes = this.list().filter(n => n.status === 'online' || n.status === 'synced');
    if (nodes.length === 0) return null;

    nodes.sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity));
    return nodes[0];
  }

  private async probeAll(): Promise<void> {
    const nodes = this.list();
    for (const node of nodes) {
      try {
        await this.healthCheck(node.id);
      } catch (err) {
        logger.warn({ error: String(err) }, `Federation probe failed for ${node.name}`);
      }
    }
  }

  private mapRow(row: any): FederationNode {
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      region: row.region,
      status: row.status,
      privacyLevel: row.privacy_level,
      latencyMs: row.latency_ms,
      lastSyncAt: row.last_sync_at,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
    };
  }
}

export const federationService = new FederationService();
