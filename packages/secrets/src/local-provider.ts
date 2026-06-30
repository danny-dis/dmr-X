import { getDb } from '@dmr-x/db';
import { encrypt, decrypt } from '@dmr-x/utils';
import crypto from 'node:crypto';
import type { SecretVersion, SecretsProvider } from './types.js';

export class LocalSecretsProvider implements SecretsProvider {
  async get(secretId: string): Promise<SecretVersion | null> {
    const db = getDb();
    const row = db.prepare(
      `SELECT * FROM secret_versions WHERE secret_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1`
    ).get(secretId) as any;
    return row ? this.mapRow(row) : null;
  }

  async getActiveVersion(secretId: string): Promise<SecretVersion | null> {
    return this.get(secretId);
  }

  async put(secretId: string, plaintext: string): Promise<SecretVersion> {
    const db = getDb();
    const id = crypto.randomUUID();
    
    // Get next version number
    const maxVersion = db.prepare(
      `SELECT COALESCE(MAX(version), 0) as max_ver FROM secret_versions WHERE secret_id = ?`
    ).get(secretId) as { max_ver: number };
    
    const newVersion = maxVersion.max_ver + 1;
    const encryptedValue = encrypt(plaintext);
    
    db.prepare(`
      INSERT INTO secret_versions (id, secret_id, version, encrypted_value, status)
      VALUES (?, ?, ?, ?, 'active')
    `).run(id, secretId, newVersion, encryptedValue);
    
    // Mark previous versions as rotated
    db.prepare(`
      UPDATE secret_versions SET status = 'rotated', rotated_at = datetime('now')
      WHERE secret_id = ? AND version < ? AND status = 'active'
    `).run(secretId, newVersion);
    
    return {
      id,
      secretId,
      version: newVersion,
      encryptedValue,
      status: 'active',
      createdAt: new Date().toISOString(),
      rotatedAt: null,
      revokedAt: null,
    };
  }

  async rotate(secretId: string, newPlaintext: string): Promise<SecretVersion> {
    return this.put(secretId, newPlaintext);
  }

  async revoke(secretId: string): Promise<void> {
    const db = getDb();
    db.prepare(`
      UPDATE secret_versions SET status = 'revoked', revoked_at = datetime('now')
      WHERE secret_id = ? AND status = 'active'
    `).run(secretId);
  }

  async listVersions(secretId: string): Promise<SecretVersion[]> {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM secret_versions WHERE secret_id = ? ORDER BY version DESC`
    ).all(secretId) as any[];
    return rows.map(r => this.mapRow(r));
  }

  decryptValue(encryptedValue: string): string {
    return decrypt(encryptedValue);
  }

  private mapRow(row: any): SecretVersion {
    return {
      id: row.id,
      secretId: row.secret_id,
      version: row.version,
      encryptedValue: row.encrypted_value,
      status: row.status,
      createdAt: row.created_at,
      rotatedAt: row.rotated_at,
      revokedAt: row.revoked_at,
    };
  }
}
