/**
 * A2A persistence + push-notification layer.
 *
 * - Tasks are mirrored to a local sqlite file so they survive a process
 *   restart (single-instance; not a shared cluster store). This replaces
 *   the "in-memory only" ceiling noted in task-manager.ts.
 * - When a task reaches a terminal state, any configured
 *   pushNotificationConfig URL is POSTed the task (push-notifications fire,
 *   closing the "stored but never sent" gap).
 *
 * Uses Node's built-in `node:sqlite` (Node 22.5+) — no new dependency.
 */

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Task, PushNotificationConfig } from './task-manager.js';

export interface A2APersistenceConfig {
  /** Absolute path to the sqlite file. Empty/in-memory if not set. */
  dbPath?: string;
  /** When true, push webhooks are actually fired (default true). */
  pushEnabled?: boolean;
}

let db: DatabaseSync | null = null;
let cfg: A2APersistenceConfig = {};
const pushConfigs = new Map<string, PushNotificationConfig>();

export function initPersistence(config: A2APersistenceConfig = {}): void {
  cfg = { pushEnabled: true, ...config };
  if (!cfg.dbPath) return; // in-memory only
  try {
    const dir = dirname(cfg.dbPath);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(cfg.dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS a2a_tasks (
        id TEXT PRIMARY KEY,
        context_id TEXT,
        state TEXT,
        data TEXT,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS a2a_push_configs (
        task_id TEXT PRIMARY KEY,
        url TEXT,
        token TEXT,
        updated_at INTEGER
      );
    `);
  } catch (e) {
    console.error('[a2a] persistence init failed, falling back to memory:', (e as Error).message);
    db = null;
  }
}

export function persistTask(task: Task): void {
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO a2a_tasks (id, context_id, state, data, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET context_id=excluded.context_id, state=excluded.state, data=excluded.data, updated_at=excluded.updated_at`
    ).run(task.id, task.contextId, task.status.state, JSON.stringify(task), Date.now());
  } catch (e) {
    console.error('[a2a] persistTask failed:', (e as Error).message);
  }
}

export function loadPersistedTasks(): Task[] {
  if (!db) return [];
  try {
    const rows = db.prepare('SELECT data FROM a2a_tasks').all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as Task);
  } catch {
    return [];
  }
}

export function setPushConfig(taskId: string, config: PushNotificationConfig): void {
  pushConfigs.set(taskId, config);
  if (db) {
    try {
      db.prepare(
        `INSERT INTO a2a_push_configs (task_id, url, token, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET url=excluded.url, token=excluded.token, updated_at=excluded.updated_at`
      ).run(taskId, config.url, config.token ?? '', Date.now());
    } catch (e) {
      console.error('[a2a] setPushConfig failed:', (e as Error).message);
    }
  }
}

export function getPushConfig(taskId: string): PushNotificationConfig | undefined {
  return pushConfigs.get(taskId);
}

/**
 * Fire the task's push webhook if configured. Best-effort: failures are
 * logged but never throw (a dead webhook must not break task completion).
 */
export async function firePushNotification(task: Task): Promise<void> {
  if (!cfg.pushEnabled) return;
  const pc = pushConfigs.get(task.id);
  if (!pc?.url) return;
  try {
    const res = await fetch(pc.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(pc.token ? { authorization: `Bearer ${pc.token}` } : {}),
      },
      body: JSON.stringify({ id: task.id, contextId: task.contextId, status: task.status, artifacts: task.artifacts }),
    });
    if (!res.ok) console.warn(`[a2a] push to ${pc.url} returned ${res.status}`);
  } catch (e) {
    console.warn(`[a2a] push to ${pc.url} failed:`, (e as Error).message);
  }
}

export function closePersistence(): void {
  try { db?.close(); } catch {}
  db = null;
}

export const _internal = { randomUUID };
