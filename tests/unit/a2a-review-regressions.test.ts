/**
 * A2A review regressions.
 *
 * Each block pins one independent-review finding against the code, not against
 * a mock of it. Written RED first: the assertion describes the required
 * behaviour, and it fails on the reviewed build.
 *
 * Findings covered:
 *   SEC-1  ownership must derive from the VALIDATED principal (the installed
 *          resolver seam), never from a caller-chosen bearer string
 *   SEC-2  the push webhook token must not sit in the db file as plaintext,
 *          and must still round-trip so no durable callback is dropped
 *   SEC-3  IPv6 egress policy must refuse NAT64 / Teredo embeddings
 *   LOGIC-1 a refused inline push webhook must not leave a durable orphan task
 *   LOGIC-2 a cross-owner continuation must answer TASK_NOT_FOUND
 *   LOGIC-3 the webhook address policy must be the ONE egress policy
 *   CONF-1 A2A-Version 1.0 must use one result envelope for every method spelling
 *   CONF-2 one state -> enum map for the whole 1.0 surface
 *   CONF-3 webhook DNS at registration must be bounded
 *
 * DNS is mocked to never answer: every policy refusal below is decided on the
 * address itself (IP literals never consult a resolver), so the mock cannot
 * mask a policy bug — and CONF-3 needs a resolver that stalls.
 */

import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsonRpcResponse } from '../../services/mcp-server/src/a2a/jsonrpc.js';

vi.mock('node:dns/promises', () => ({
  lookup: () => new Promise<never>(() => {}),
  default: { lookup: () => new Promise<never>(() => {}) },
}));

const { handleRpc, handleRpcStream, A2A_ERR } = await import(
  '../../services/mcp-server/src/a2a/jsonrpc.js'
);
const { getTaskManager, resetTaskManager, textMessage } = await import(
  '../../services/mcp-server/src/a2a/task-manager.js'
);
const { resolveOwnerId, setOwnerResolver, installAuthenticatedOwnerResolver } = await import(
  '../../services/mcp-server/src/a2a/owner.js'
);
const { assertWebhookUrlAllowed, isPublicAddress, WebhookPolicyError } = await import(
  '../../services/mcp-server/src/a2a/egress.js'
);
const { validateWebhookUrl } = await import('../../services/mcp-server/src/a2a/security.js');
const { wireStatus } = await import('../../services/mcp-server/src/a2a/v1-codec.js');
const { buildHttpBearerPolicy } = await import('../../services/mcp-server/src/http-auth-session.js');
const {
  closePersistence,
  initPersistence,
  setPushConfig,
  getPushConfig,
  waitForPersistenceReady,
} = await import('../../services/mcp-server/src/a2a/persistence.js');

const OWNER = { authorization: 'Bearer review-owner', 'x-dmr-tenant-key': 'review-key' };
const STRANGER = { authorization: 'Bearer review-stranger', 'x-dmr-tenant-key': 'review-key' };

const ENV_KEYS = [
  'DMRX_A2A_WEBHOOK_ALLOWED_IPS',
  'DMRX_A2A_DNS_TIMEOUT_MS',
  'DMRX_MCP_API_KEY',
  'DMRX_MCP_API_KEYS_CONFIG',
  'DMRX_A2A_API_KEY',
  'DMRX_ENCRYPTION_KEY',
  'DMRX_GATEWAY_URL',
  'DMRX_MCP_KEY',
] as const;
const savedEnv: Record<string, string | undefined> = {};
let tempDir: string;
let gateway: Server;

async function startGateway(): Promise<void> {
  gateway = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: 'review-result' }));
    });
  });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  process.env.DMRX_GATEWAY_URL = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
}

function rpc(
  method: string,
  params: unknown = {},
  headers: Record<string, string> = OWNER,
  version?: string,
): Promise<JsonRpcResponse> {
  return handleRpc({ jsonrpc: '2.0', id: 1, method, params } as never, headers as never, { version });
}

async function stream(
  method: string,
  params: unknown,
  headers: Record<string, string> = OWNER,
): Promise<JsonRpcResponse[]> {
  const events: JsonRpcResponse[] = [];
  await handleRpcStream(
    { jsonrpc: '2.0', id: 7, method, params } as never,
    headers as never,
    { send: (event) => events.push(event), end: () => {} },
  );
  return events;
}

const textMessageParams = (extra: Record<string, unknown> = {}) => ({
  message: { role: 'user', parts: [{ kind: 'text', text: 'hello' }], ...extra },
});

beforeEach(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  closePersistence();
  resetTaskManager();
  setOwnerResolver(null);
  tempDir = mkdtempSync(join(tmpdir(), 'dmrx-a2a-review-'));
  initPersistence({ dbPath: join(tempDir, 'a2a.sqlite'), pushEnabled: false });
  await waitForPersistenceReady().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  await startGateway();
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  closePersistence();
  resetTaskManager();
  setOwnerResolver(null);
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
  gateway.closeAllConnections();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('SEC-1 ownership follows the validated principal, not an asserted bearer', () => {
  it('installs a resolver over the shared bearer policy so an invalid key resolves to no owner', async () => {
    process.env.DMRX_MCP_API_KEY = 'valid-key';
    installAuthenticatedOwnerResolver(buildHttpBearerPolicy(null));

    const owner = await resolveOwnerId({ authorization: 'Bearer valid-key' });
    expect(owner, 'a validated key must resolve to an owner').toBeTruthy();

    // The reviewed build hashed whatever bearer the caller chose, so ANY string
    // minted its own owner. With a policy configured, only a valid key does.
    await expect(resolveOwnerId({ authorization: 'Bearer attacker-chosen' })).resolves.toBeUndefined();
    await expect(resolveOwnerId({})).resolves.toBeUndefined();
    expect(owner).not.toContain('valid-key');
  });

  it('separates principals and tenants, and refuses an ambiguous tenant header', async () => {
    process.env.DMRX_MCP_API_KEY = 'key-a,key-b';
    installAuthenticatedOwnerResolver(buildHttpBearerPolicy(null));

    const a = await resolveOwnerId({ authorization: 'Bearer key-a' });
    const b = await resolveOwnerId({ authorization: 'Bearer key-b' });
    const aOtherTenant = await resolveOwnerId({
      authorization: 'Bearer key-a',
      'x-dmr-tenant-key': 'tenant-two',
    });
    expect(a).toBeTruthy();
    expect(b).not.toBe(a);
    expect(aOtherTenant).not.toBe(a);
    // Same principal + same tenant is the same owner across calls.
    expect(await resolveOwnerId({ authorization: 'Bearer key-a', 'x-dmr-tenant-key': 'tenant-one' })).toBe(
      await resolveOwnerId({ authorization: 'Bearer key-a', 'x-dmr-tenant-key': 'tenant-one' }),
    );
    await expect(
      resolveOwnerId({ authorization: 'Bearer key-a', 'x-dmr-tenant-key': ['t1', 't2'] } as never),
    ).resolves.toBeUndefined();
  });

  it('never hands a tool-restricted key an A2A owner', async () => {
    process.env.DMRX_MCP_API_KEYS_CONFIG = JSON.stringify([
      { key: 'scoped-key', allowedTools: ['dmrx_chat'] },
    ]);
    installAuthenticatedOwnerResolver(buildHttpBearerPolicy(null));
    await expect(resolveOwnerId({ authorization: 'Bearer scoped-key' })).resolves.toBeUndefined();
  });

  it('keeps per-bearer isolation when no key source is configured', async () => {
    // Unconfigured deployments must not collapse every caller onto ONE shared
    // owner: two different bearers stay two different owners.
    installAuthenticatedOwnerResolver(buildHttpBearerPolicy(null));
    const one = await resolveOwnerId({ authorization: 'Bearer one' });
    const two = await resolveOwnerId({ authorization: 'Bearer two' });
    expect(one).toBeTruthy();
    expect(two).toBeTruthy();
    expect(one).not.toBe(two);
  });
});

describe('LOGIC-1 a refused inline push webhook leaves no durable task behind', () => {
  const REFUSED = { configuration: { pushNotificationConfig: { url: 'http://127.0.0.1:9/hook' } } };

  it('message/send creates nothing when the inline webhook is refused', async () => {
    const before = getTaskManager().taskCount();
    const res = await rpc('message/send', { ...textMessageParams(), ...REFUSED });
    expect(res.error?.code).toBe(A2A_ERR.WEBHOOK_NOT_ALLOWED);
    expect(
      getTaskManager().taskCount(),
      'a refused push config must not leave an orphan task in the store',
    ).toBe(before);
  });

  it('message/stream creates nothing when the inline webhook is refused', async () => {
    const before = getTaskManager().taskCount();
    const events = await stream('message/stream', { ...textMessageParams(), ...REFUSED });
    expect(events[0].error?.code).toBe(A2A_ERR.WEBHOOK_NOT_ALLOWED);
    expect(getTaskManager().taskCount(), 'streaming path must not leak a task either').toBe(before);
  });

  it('repeated rejections do not grow the store without bound', async () => {
    const before = getTaskManager().taskCount();
    for (let i = 0; i < 5; i++) {
      await rpc('message/send', { ...textMessageParams(), ...REFUSED });
      await stream('message/stream', { ...textMessageParams(), ...REFUSED });
    }
    expect(getTaskManager().taskCount()).toBe(before);
  });

  it('still registers the webhook and dispatches when the URL is allowed', async () => {
    const loopback = `http://127.0.0.1:${(gateway.address() as { port: number }).port}/hook`;
    process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS = '127.0.0.1';
    try {
      const res = await rpc('message/send', {
        ...textMessageParams(),
        configuration: { pushNotificationConfig: { url: loopback, token: 'tok' } },
      });
      expect(res.error).toBeUndefined();
      const id = (res.result as { id: string }).id;
      const stored = await rpc('tasks/pushNotificationConfig/get', { taskId: id });
      expect((stored.result as { pushNotificationConfig: { url: string } }).pushNotificationConfig.url).toBe(loopback);
    } finally {
      delete process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS;
    }
  });
});

describe('LOGIC-2 a cross-owner continuation is TASK_NOT_FOUND, not a terminal-state complaint', () => {
  it('answers TASK_NOT_FOUND for another principal’s taskId', async () => {
    const ownerId = await resolveOwnerId(OWNER as never);
    const created = getTaskManager().createTask(textMessage('user', 'mine'), { ownerId });
    expect(created.task).toBeTruthy();

    const res = await rpc(
      'message/send',
      textMessageParams({ taskId: created.task!.id }),
      STRANGER,
    );
    expect(res.error?.code).toBe(A2A_ERR.TASK_NOT_FOUND);
    expect(res.error?.message).not.toMatch(/terminal/i);
  });

  it('answers a cross-owner continuation exactly like a missing task', async () => {
    const ownerId = await resolveOwnerId(OWNER as never);
    const created = getTaskManager().createTask(textMessage('user', 'mine'), { ownerId });
    // Same probe against the JSON-RPC read path, where a foreign or absent id
    // both answer TASK_NOT_FOUND: the continuation path must not be blunter.
    const missing = await rpc('tasks/get', { id: 'no-such-task-id' }, STRANGER);
    const foreignRead = await rpc('tasks/get', { id: created.task!.id }, STRANGER);
    expect(missing.error?.code).toBe(A2A_ERR.TASK_NOT_FOUND);
    expect(foreignRead.error?.code).toBe(missing.error?.code);

    const crossOwner = await rpc('message/send', textMessageParams({ taskId: created.task!.id }), STRANGER);
    expect(crossOwner.error?.code).toBe(missing.error?.code);
    expect(crossOwner.error?.message).toBe(missing.error?.message);
  });

  it('still lets the owner continue its own non-terminal task', async () => {
    const ownerId = await resolveOwnerId(OWNER as never);
    const created = getTaskManager().createTask(textMessage('user', 'mine'), { ownerId });
    const res = await rpc('message/send', textMessageParams({ taskId: created.task!.id }), OWNER);
    expect(res.error).toBeUndefined();
  });
});

describe('SEC-3 IPv6 egress policy refuses NAT64 and Teredo embeddings', () => {
  it.each([
    ['64:ff9b::7f00:1', 'NAT64 well-known prefix embedding 127.0.0.1'],
    ['64:ff9b::a9fe:a9fe', 'NAT64 embedding the cloud metadata address'],
    ['64:ff9b:1::7f00:1', 'NAT64 local-use prefix'],
    ['2001:0:ce49:7601:e866:efff:62c3:fffe', 'Teredo embedding a client IPv4'],
    ['2001:0000::1', 'Teredo /32 spelled with padded groups'],
  ])('refuses %s (%s)', (ip) => {
    expect(isPublicAddress(ip), `${ip} must not be treated as a public destination`).toBe(false);
  });

  it('still allows ordinary public IPv6 and public IPv4', () => {
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicAddress('93.184.216.34')).toBe(true);
  });

  it('rejects a NAT64 webhook URL at the registration gate', async () => {
    await expect(
      assertWebhookUrlAllowed('http://[64:ff9b::7f00:1]/hook'),
      'NAT64 must be refused by the URL policy',
    ).rejects.toBeInstanceOf(WebhookPolicyError);
  });
});

describe('CONF-3 webhook DNS resolution is bounded', () => {
  it('refuses a stalled resolver instead of hanging the registration path', async () => {
    process.env.DMRX_A2A_DNS_TIMEOUT_MS = '120';
    const started = Date.now();
    await expect(
      assertWebhookUrlAllowed('https://stalled.example.com/hook'),
      'an unanswered DNS lookup must not stall the caller',
    ).rejects.toThrow(/did not resolve|timed out|timeout/i);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('LOGIC-3 one webhook address policy (the egress guard)', () => {
  it.each([
    ['http://224.0.0.1/hook', 'multicast destination the weaker duplicate allowed'],
    ['http://100.64.0.1/hook', 'CGNAT destination'],
    ['http://169.254.169.254/latest/meta-data', 'cloud metadata'],
    ['http://2130706433/hook', 'decimal-encoded loopback'],
    ['not a url', 'unparseable input'],
  ])('validateWebhookUrl refuses %s (%s)', async (url) => {
    const result = await validateWebhookUrl(url);
    expect(result.ok, `${url} must be refused by the shared policy`).toBe(false);
  });
});

describe('CONF-2 one state -> enum map across the whole 1.0 surface', () => {
  it('maps the unknown state to the protobuf enum, not to UNSPECIFIED', () => {
    expect(wireStatus({ state: 'unknown', timestamp: 't' }).state).toBe('TASK_STATE_UNKNOWN');
  });

  it.each([
    ['submitted', 'TASK_STATE_SUBMITTED'],
    ['working', 'TASK_STATE_WORKING'],
    ['input-required', 'TASK_STATE_INPUT_REQUIRED'],
    ['completed', 'TASK_STATE_COMPLETED'],
    ['canceled', 'TASK_STATE_CANCELED'],
    ['failed', 'TASK_STATE_FAILED'],
    ['rejected', 'TASK_STATE_REJECTED'],
    ['auth-required', 'TASK_STATE_AUTH_REQUIRED'],
  ])('maps %s identically on both paths', (state, expected) => {
    expect(wireStatus({ state, timestamp: 't' }).state).toBe(expected);
  });

  it('agrees with the message/send v1.0 result for a completed task', async () => {
    const res = await rpc('message/send', textMessageParams(), OWNER, '1.0');
    expect(res.error).toBeUndefined();
    const result = res.result as { task?: { status?: { state?: string } }; status?: { state?: string } };
    const state = result.task?.status?.state ?? result.status?.state;
    expect(state).toBe(wireStatus({ state: 'completed', timestamp: 't' }).state);
  });
});

describe('CONF-1 one v1.0 result envelope for every method spelling', () => {
  it('wraps message/send like SendMessage under A2A-Version 1.0', async () => {
    const legacySpelling = await rpc('message/send', textMessageParams(), OWNER, '1.0');
    const v1Spelling = await rpc(
      'SendMessage',
      { message: { role: 'ROLE_USER', parts: [{ text: 'hello' }] } },
      OWNER,
      '1.0',
    );
    expect(legacySpelling.error).toBeUndefined();
    expect(v1Spelling.error).toBeUndefined();
    expect(Object.keys(legacySpelling.result as object).sort()).toEqual(
      Object.keys(v1Spelling.result as object).sort(),
    );
    expect(legacySpelling.result).toHaveProperty('task');
  });

  it('leaves the legacy (0.3) result shape untouched', async () => {
    const res = await rpc('message/send', textMessageParams(), OWNER, '0.3');
    expect(res.error).toBeUndefined();
    const result = res.result as { id?: string; task?: unknown; kind?: string };
    expect(result.id).toBeTruthy();
    expect(result).not.toHaveProperty('task');
    expect(result.kind).toBe('task');
  });
});

describe('SEC-2 the push token is encrypted at rest and still round-trips', () => {
  /** Concatenate every sqlite file (main + WAL) so a buffered write is visible. */
  function readDbBytes(): Buffer {
    const parts: Buffer[] = [];
    for (const name of readdirSync(tempDir)) {
      if (name.startsWith('a2a.sqlite')) parts.push(readFileSync(join(tempDir, name)));
    }
    return Buffer.concat(parts);
  }

  it('never writes the token in plaintext and still returns it after a restart', async () => {
    process.env.DMRX_ENCRYPTION_KEY = 'a'.repeat(64);
    closePersistence();
    initPersistence({ dbPath: join(tempDir, 'a2a.sqlite'), pushEnabled: false });
    await waitForPersistenceReady();
    setPushConfig('task-secret', { url: 'https://hooks.example.com/x', token: 'super-secret-token' });
    closePersistence();

    const raw = readDbBytes();
    expect(raw.length).toBeGreaterThan(0);
    expect(
      raw.includes(Buffer.from('super-secret-token', 'utf8')),
      'the webhook token must not be readable in the db file',
    ).toBe(false);

    // Durable round-trip: a restart must still be able to sign the callback.
    initPersistence({ dbPath: join(tempDir, 'a2a.sqlite'), pushEnabled: false });
    await waitForPersistenceReady();
    closePersistence();
    initPersistence({ dbPath: join(tempDir, 'a2a.sqlite'), pushEnabled: false });
    await waitForPersistenceReady();
    expect(getPushConfig('task-secret')?.token).toBe('super-secret-token');
  });

  it('does not drop the callback when no encryption key is configured', async () => {
    delete process.env.DMRX_ENCRYPTION_KEY;
    closePersistence();
    initPersistence({ dbPath: join(tempDir, 'a2a.sqlite'), pushEnabled: false });
    await waitForPersistenceReady();
    setPushConfig('task-plain', { url: 'https://hooks.example.com/y', token: 'plain-token' });
    closePersistence();
    initPersistence({ dbPath: join(tempDir, 'a2a.sqlite'), pushEnabled: false });
    await waitForPersistenceReady();
    expect(
      getPushConfig('task-plain')?.token,
      'no encryption key must degrade storage, never the callback itself',
    ).toBe('plain-token');
  });
});
