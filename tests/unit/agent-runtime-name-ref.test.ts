// loadContext name-ref resolution: a definition NAME (e.g. `__receptionist`)
// resolves to the tenant's active instance, auto-deploying on first use.
// Runs against real SQLite, matching the repo's test convention.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { agentRuntimeService } from '@dmr-x/agent-runtime';
import { agentRegistryService } from '@dmr-x/agent-registry';

let initDb: any;
let closeDb: any;
let getDb: any;
let tmpDir: string;

const TENANT = 'tenant-nameref-test';

beforeAll(async () => {
  const dbMod = await import('@dmr-x/db');
  initDb = dbMod.initDb;
  closeDb = dbMod.closeDb;
  getDb = dbMod.getDb;

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmr-x-nameref-test-'));
  process.env.DMRX_DATA_DIR = tmpDir;
  try {
    await closeDb();
  } catch {
    // no open handle on a cold run
  }
  await initDb();
  getDb()
    .prepare('INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)')
    .run(TENANT, 'nameref-test');
});

afterAll(async () => {
  try {
    await closeDb();
  } catch {
    // ignore
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadContext by definition name', () => {
  it('auto-deploys an instance when addressed by definition name', async () => {
    const def = await agentRegistryService.createDefinition(TENANT, {
      name: '__test_coordinator',
      description: 'system-style coordinator for tests',
      version: '1.0.0',
      systemPrompt: 'coordinate things',
      modelTier: 'premium',
      visibility: 'private',
    } as any);
    expect(def).toBeTruthy();

    const ctx = await agentRuntimeService.loadContext('__test_coordinator', TENANT);
    expect(ctx).not.toBeNull();
    expect(ctx!.definition.name).toBe('__test_coordinator');
    // The context must carry the real instance id, not the name passed in.
    const instance = await agentRegistryService.getInstance(ctx!.instanceId);
    expect(instance?.agentDefinitionId).toBe(def!.id);
  });

  it('reuses the existing active instance on the second lookup (no duplicate deploy)', async () => {
    await agentRegistryService.createDefinition(TENANT, {
      name: '__test_reuse',
      description: 'second coordinator',
      version: '1.0.0',
      systemPrompt: 'x',
      modelTier: 'budget',
      visibility: 'private',
    } as any);

    const first = await agentRuntimeService.loadContext('__test_reuse', TENANT);
    const second = await agentRuntimeService.loadContext('__test_reuse', TENANT);
    expect(first?.instanceId).toBe(second?.instanceId);
  });

  it('returns null for an unknown name and still resolves real instance ids', async () => {
    expect(await agentRuntimeService.loadContext('__no_such_agent', TENANT)).toBeNull();

    // Instance ids keep working through the same entry point.
    const def = await agentRegistryService.createDefinition(TENANT, {
      name: 'plain_worker',
      description: 'regular agent',
      version: '1.0.0',
      systemPrompt: 'work',
      modelTier: 'budget',
      visibility: 'private',
    } as any);
    const inst = await agentRegistryService.createInstance(TENANT, {
      agentDefinitionId: def!.id,
      configOverride: {},
    });
    const byId = await agentRuntimeService.loadContext(inst!.id, TENANT);
    expect(byId?.definition.name).toBe('plain_worker');
  });
});
