import { getDb } from '@dmr-x/db';
import { logger } from '@dmr-x/utils';

/**
 * Named routing profiles for the fallback chain.
 * Users can save/switch routing configurations easily.
 */

export interface RoutingProfile {
  id: number;
  name: string;
  description: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileModel {
  id: number;
  profileId: number;
  providerId: string;
  modelId: string;
  priority: number;
  enabled: boolean;
}

/**
 * Initialize the profiles tables.
 */
export function initProfilesTable(): void {
  try {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS routing_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT '',
        is_default INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS profile_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        FOREIGN KEY (profile_id) REFERENCES routing_profiles(id) ON DELETE CASCADE
      );
    `);
  } catch (error) {
    logger.warn({ err: error }, 'Failed to initialize profiles tables');
  }
}

/**
 * Get all routing profiles.
 */
export function getProfiles(): RoutingProfile[] {
  try {
    const db = getDb();
    return db.prepare('SELECT * FROM routing_profiles ORDER BY is_default DESC, name ASC').all() as RoutingProfile[];
  } catch {
    return [];
  }
}

/**
 * Get a profile by ID.
 */
export function getProfile(id: number): RoutingProfile | null {
  try {
    const db = getDb();
    return db.prepare('SELECT * FROM routing_profiles WHERE id = ?').get(id) as RoutingProfile | null;
  } catch {
    return null;
  }
}

/**
 * Create a new routing profile.
 */
export function createProfile(name: string, description: string = ''): RoutingProfile {
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO routing_profiles (name, description) VALUES (?, ?)'
  ).run(name, description);
  return getProfile(Number(result.lastInsertRowid))!;
}

/**
 * Update a routing profile.
 */
export function updateProfile(id: number, updates: Partial<Pick<RoutingProfile, 'name' | 'description'>>): void {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  fields.push('updated_at = datetime(\'now\')');
  values.push(id);
  db.prepare(`UPDATE routing_profiles SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * Delete a routing profile.
 */
export function deleteProfile(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM profile_models WHERE profile_id = ?').run(id);
  db.prepare('DELETE FROM routing_profiles WHERE id = ?').run(id);
}

/**
 * Set a profile as the default.
 */
export function setDefaultProfile(id: number): void {
  const db = getDb();
  db.prepare('UPDATE routing_profiles SET is_default = 0').run();
  db.prepare('UPDATE routing_profiles SET is_default = 1 WHERE id = ?').run(id);
}

/**
 * Get models for a profile.
 */
export function getProfileModels(profileId: number): ProfileModel[] {
  try {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM profile_models WHERE profile_id = ? ORDER BY priority ASC'
    ).all(profileId) as ProfileModel[];
  } catch {
    return [];
  }
}

/**
 * Add a model to a profile.
 */
export function addModelToProfile(profileId: number, providerId: string, modelId: string, priority: number = 0): ProfileModel {
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO profile_models (profile_id, provider_id, model_id, priority) VALUES (?, ?, ?, ?)'
  ).run(profileId, providerId, modelId, priority);
  return db.prepare('SELECT * FROM profile_models WHERE id = ?').get(result.lastInsertRowid) as ProfileModel;
}

/**
 * Remove a model from a profile.
 */
export function removeModelFromProfile(profileId: number, modelId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM profile_models WHERE profile_id = ? AND model_id = ?').run(profileId, modelId);
}

/**
 * Update model priority in a profile.
 */
export function updateModelPriority(profileId: number, modelId: string, priority: number): void {
  const db = getDb();
  db.prepare('UPDATE profile_models SET priority = ? WHERE profile_id = ? AND model_id = ?').run(priority, profileId, modelId);
}

/**
 * Toggle model enabled state in a profile.
 */
export function toggleModelEnabled(profileId: number, modelId: string, enabled: boolean): void {
  const db = getDb();
  db.prepare('UPDATE profile_models SET enabled = ? WHERE profile_id = ? AND model_id = ?').run(enabled ? 1 : 0, profileId, modelId);
}

/**
 * Get the active profile ID (from settings).
 */
export function getActiveProfileId(): number | null {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'active_profile_id'").get() as { value?: string } | undefined;
    return row?.value ? parseInt(row.value, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Set the active profile ID.
 */
export function setActiveProfileId(id: number | null): void {
  try {
    const db = getDb();
    if (id === null) {
      db.prepare("DELETE FROM settings WHERE key = 'active_profile_id'").run();
    } else {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES ('active_profile_id', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(id));
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to set active profile');
  }
}
