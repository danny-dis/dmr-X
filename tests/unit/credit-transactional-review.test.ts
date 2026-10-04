import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getDb, initDb } from '@dmr-x/db';
import { CreditService } from '../../services/billing/src/credit.service.js';
import { QuotaService } from '../../services/quota/src/quota.service.js';

const directory = mkdtempSync(join(tmpdir(), 'dmrx-credit-transactional-review-'));
const previousDataDir = process.env.DMRX_DATA_DIR;
const credit = new CreditService();
let db: ReturnType<typeof getDb>;

function uniqueTenant(label: string): string {
  return `credit-review-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function insertTenant(tenantId: string): void {
  db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run(tenantId, tenantId);
}

function runChildDebit(tenantId: string, requestId: string): Promise<{ ok: boolean; output: string }> {
    const script = `
    const { initDb, closeDb } = await import('@dmr-x/db');
    const { CreditService } = await import('./src/credit.service.ts');
    await initDb();
    const ok = new CreditService().deductUsage(${JSON.stringify(tenantId)}, 600, ${JSON.stringify(requestId)});
    console.log(JSON.stringify({ ok }));
    await closeDb();
  `;
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['-e', script], {
      cwd: join(process.cwd(), 'services/billing'),
      env: { ...process.env, DMRX_DATA_DIR: directory },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ ok: code === 0, output }));
  });
}

beforeAll(async () => {
  process.env.DMRX_DATA_DIR = directory;
  mkdirSync(directory, { recursive: true });
  await initDb();
  db = getDb();
});

afterAll(async () => {
  await closeDb();
  if (previousDataDir === undefined) delete process.env.DMRX_DATA_DIR;
  else process.env.DMRX_DATA_DIR = previousDataDir;
});

describe('transactional credit accounting review', () => {
  it('charges a repeated requestId once while preserving the audit transaction', () => {
    const tenantId = uniqueTenant('idempotent');
    insertTenant(tenantId);
    credit.topUp(tenantId, 1000);

    expect(credit.deductUsage(tenantId, 100, 'request-once')).toBe(true);
    expect(credit.deductUsage(tenantId, 100, 'request-once')).toBe(true);
    expect(credit.deductUsage(tenantId, 100, 'request-once')).toBe(true);

    expect(credit.getBalance(tenantId)?.balanceCents).toBe(900);
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM credit_transactions WHERE tenant_id = ? AND type = 'usage'").get(tenantId) as { count: number }).count,
    ).toBe(1);
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM credit_usage_claims WHERE tenant_id = ?').get(tenantId) as { count: number }).count,
    ).toBe(1);
  });

  it('keeps legacy calls without requestId as independent charges', () => {
    const tenantId = uniqueTenant('legacy');
    insertTenant(tenantId);
    credit.topUp(tenantId, 1000);

    expect(credit.deductUsage(tenantId, 100)).toBe(true);
    expect(credit.deductUsage(tenantId, 100)).toBe(true);

    expect(credit.getBalance(tenantId)?.balanceCents).toBe(800);
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM credit_transactions WHERE tenant_id = ? AND type = 'usage'").get(tenantId) as { count: number }).count,
    ).toBe(2);
  });

  it('leaves the balance and ledger unchanged when credits are insufficient', () => {
    const tenantId = uniqueTenant('insufficient');
    insertTenant(tenantId);
    credit.topUp(tenantId, 100);

    expect(credit.deductUsage(tenantId, 101, 'too-expensive')).toBe(false);
    expect(credit.getBalance(tenantId)?.balanceCents).toBe(100);
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM credit_transactions WHERE tenant_id = ? AND type = 'usage'").get(tenantId) as { count: number }).count,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM credit_usage_claims WHERE tenant_id = ?').get(tenantId) as { count: number }).count,
    ).toBe(0);
  });

  it('does not overspend when two independent SQLite processes compete', async () => {
    const tenantId = uniqueTenant('cross-process');
    insertTenant(tenantId);
    credit.topUp(tenantId, 1000);

    const [first, second] = await Promise.all([
      runChildDebit(tenantId, 'process-a'),
      runChildDebit(tenantId, 'process-b'),
    ]);
    expect(first.ok, first.output).toBe(true);
    expect(second.ok, second.output).toBe(true);

    const results = [first.output, second.output].map((output) => output.match(/\{"ok":(true|false)\}/)?.[1]);
    expect(results.filter((value) => value === 'true')).toHaveLength(1);
    expect(results.filter((value) => value === 'false')).toHaveLength(1);
    expect(credit.getBalance(tenantId)?.balanceCents).toBe(400);
  }, 60_000);

  it('uses the durable debit key when a paid quota settlement is retried', async () => {
    const tenantId = uniqueTenant('settlement-retry');
    insertTenant(tenantId);
    credit.topUp(tenantId, 1000);
    const quota = new QuotaService();
    const hold = await quota.reserveAgentRun(tenantId, 'fixture-provider', 1, 100);
    expect(hold.ok).toBe(true);

    const actual = { tokens: 1, costDollars: 1 };
    const context = { tenantId, providerKey: 'fixture-provider', modelId: 'fixture-model' };
    await quota.settleAgentHold(hold.holdId!, actual, context);
    await quota.settleAgentHold(hold.holdId!, actual, context);
    await quota.settleAgentHold(hold.holdId!, actual, context);

    expect(credit.getBalance(tenantId)?.balanceCents).toBe(900);
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM agent_quota_settlements WHERE hold_id = ?').get(hold.holdId) as { count: number }).count,
    ).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM credit_transactions WHERE tenant_id = ? AND type = 'usage'").get(tenantId) as { count: number }).count,
    ).toBe(1);
  });
});
