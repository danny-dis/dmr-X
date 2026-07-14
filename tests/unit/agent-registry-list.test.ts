import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { initDb, closeDb } from '../../packages/db/src/client.js';
import { AgentRegistryService } from '../../services/agent-registry/src/agent-registry.service.js';

let tmpDir: string;
let service: AgentRegistryService;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmr-x-registry-test-'));
  process.env.DMRX_DATA_DIR = tmpDir;
  try {
    await closeDb();
  } catch {
    // first run
  }
  await initDb();
  service = new AgentRegistryService();
});

afterEach(async () => {
  try {
    await closeDb();
  } catch {
    // ignore
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('AgentRegistryService.listDefinitions tag filter', () => {
  it('returns only definitions matching the tag (regression for json_each bind bug)', async () => {
    await service.createDefinition('tenant-1', {
      name: 'billing-agent',
      tags: ['billing', 'finance'],
    });
    await service.createDefinition('tenant-1', {
      name: 'support-agent',
      tags: ['support'],
    });

    const { items, total } = await service.listDefinitions('tenant-1', { tag: 'billing' });

    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('billing-agent');
  });
});
