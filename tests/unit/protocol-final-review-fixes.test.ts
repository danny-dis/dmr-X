/**
 * Protocol final-review fixes.
 *
 * Dedicated regression file for the findings in
 * `review-protocol-final.json` (independent read-only protocol review of the
 * A2A/MCP auth + egress surface). Written RED first: every assertion below
 * describes the REQUIRED behaviour and fails on the reviewed build.
 *
 * Findings covered:
 *   SEC-HIGH  IPv4-compatible `::/96` literals (compressed, hex and fully
 *             expanded spellings) must not be accepted as public webhook
 *             destinations
 *   SEC-LOW   the compressed Teredo spelling `2001::` must be refused like the
 *             padded `2001:0000::` spelling
 *   LOGIC-MED the A2A boundary and the installed owner resolver must derive the
 *             principal from ONE credential set, and an A2A-only credential
 *             must never become an MCP credential
 *   LOGIC-LOW `tasks/get { historyLength: 0 }` must return an empty history
 *   LOGIC-LOW every `tasks/resubscribe` follow-up event must carry the
 *             negotiated 1.0 version, not just the initial replay
 *   SUGGEST   the genuine v1 `CancelTask` method name must resolve (legacy
 *             `tasks/cancel` kept)
 *
 * No persistence is initialised: the task manager then runs purely in memory,
 * so these tests can never open (or write to) a real on-disk A2A database.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JsonRpcResponse } from '../../services/mcp-server/src/a2a/jsonrpc.js';

const { handleRpc, handleRpcStream, A2A_ERR } = await import(
  '../../services/mcp-server/src/a2a/jsonrpc.js'
);
const { getTaskManager, resetTaskManager, textMessage } = await import(
  '../../services/mcp-server/src/a2a/task-manager.js'
);
const { resolveOwnerId, setOwnerResolver, installAuthenticatedOwnerResolver } = await import(
  '../../services/mcp-server/src/a2a/owner.js'
);
const { isPublicAddress, assertWebhookUrlAllowed, WebhookPolicyError } = await import(
  '../../services/mcp-server/src/a2a/egress.js'
);
const { authenticateA2A, authenticateA2ARequest, setA2ABearerPolicy } = await import(
  '../../services/mcp-server/src/a2a/security.js'
);
const { closePersistence } = await import('../../services/mcp-server/src/a2a/persistence.js');
const { buildHttpBearerPolicy } = await import(
  '../../services/mcp-server/src/http-auth-session.js'
);
const { authenticateBearer } = await import('../../services/mcp-server/src/auth-runtime.js');

/**
 * `buildA2ABearerPolicy` is the fix's new single source of truth. Imported
 * dynamically so the RED run can still collect (and report) the other
 * assertions instead of dying at module load.
 */
const securityModule = await import('../../services/mcp-server/src/a2a/security.js');
const buildA2ABearerPolicy = (securityModule as { buildA2ABearerPolicy?: (f: null) => unknown })
  .buildA2ABearerPolicy;

const OWNER = { authorization: 'Bearer review-owner', 'x-dmr-tenant-key': 'review-key' };

const ENV_KEYS = [
  'DMRX_A2A_API_KEY',
  'DMRX_MCP_API_KEY',
  'DMRX_MCP_API_KEYS_CONFIG',
  'DMRX_A2A_REQUIRE_AUTH',
  'NODE_ENV',
] as const;
const savedEnv: Record<string, string | undefined> = {};

function rpc(
  method: string,
  params: unknown = {},
  headers: Record<string, string> = OWNER,
  version?: string,
): Promise<JsonRpcResponse> {
  return handleRpc({ jsonrpc: '2.0', id: 1, method, params } as never, headers as never, {
    version,
  });
}

/** Seed a task owned by the OWNER principal, without dispatching it. */
async function seedOwnedTask(text = 'seed'): Promise<string> {
  const ownerId = await resolveOwnerId(OWNER as never);
  expect(ownerId).toBeTruthy();
  const created = getTaskManager().createTask(textMessage('user', text), { ownerId });
  expect(created.error).toBeUndefined();
  return created.task!.id;
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  closePersistence();
  resetTaskManager();
  setOwnerResolver(null);
  setA2ABearerPolicy(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  closePersistence();
  resetTaskManager();
  setOwnerResolver(null);
  setA2ABearerPolicy(null);
});

describe('SEC-HIGH IPv4-compatible ::/96 literals are refused (every spelling)', () => {
  it.each([
    ['::127.0.0.1', 'IPv4-compatible loopback, dotted (URL normalises to ::7f00:1)'],
    ['::7f00:1', 'IPv4-compatible loopback, compressed hex (the normalised form)'],
    ['0:0:0:0:0:0:7f00:1', 'IPv4-compatible loopback, fully expanded'],
    ['::169.254.169.254', 'IPv4-compatible cloud metadata, dotted'],
    ['::a9fe:a9fe', 'IPv4-compatible cloud metadata, hex'],
    ['0:0:0:0:0:0:a9fe:a9fe', 'IPv4-compatible cloud metadata, fully expanded'],
    ['::10.0.0.5', 'IPv4-compatible RFC1918'],
    ['::c0a8:101', 'IPv4-compatible RFC1918, hex'],
  ])('refuses %s (%s)', (ip) => {
    expect(isPublicAddress(ip), `${ip} must not be treated as a public destination`).toBe(false);
  });

  it.each([
    ['http://[::127.0.0.1]/hook', 'compressed compatible loopback'],
    ['http://[::7f00:1]/hook', 'compressed compatible loopback (hex)'],
    ['http://[0:0:0:0:0:0:7f00:1]/hook', 'fully expanded compatible loopback'],
    ['http://[::169.254.169.254]/hook', 'compatible cloud metadata'],
  ])('refuses the webhook URL %s (%s)', async (url) => {
    await expect(assertWebhookUrlAllowed(url)).rejects.toBeInstanceOf(WebhookPolicyError);
  });

  it('still allows ordinary public IPv6 and IPv4', () => {
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicAddress('2001:4860:4860::8888')).toBe(true);
    expect(isPublicAddress('93.184.216.34')).toBe(true);
  });
});

describe('SEC-LOW the compressed Teredo prefix is refused like the padded spelling', () => {
  it.each([
    ['2001::', 'compressed Teredo prefix, all-zero remainder'],
    ['2001::1', 'compressed Teredo prefix'],
    ['2001::ce49:7601', 'compressed Teredo with a client field'],
    ['2001:0000::1', 'padded Teredo (already refused)'],
    ['2001:0:ce49:7601:e866:efff:62c3:fffe', 'full Teredo address'],
  ])('refuses %s (%s)', (ip) => {
    expect(isPublicAddress(ip), `${ip} must not be treated as a public destination`).toBe(false);
  });

  it('refuses a compressed Teredo webhook URL at the registration gate', async () => {
    await expect(assertWebhookUrlAllowed('http://[2001::1]/hook')).rejects.toBeInstanceOf(
      WebhookPolicyError,
    );
  });
});

describe('LOGIC-MED the A2A boundary and owner resolver share one credential set', () => {
  it('exposes a single A2A bearer policy builder', () => {
    expect(typeof buildA2ABearerPolicy).toBe('function');
  });

  it('derives A2A ownership from the validated A2A key when only that key is configured', async () => {
    process.env.DMRX_A2A_API_KEY = 'a2a-only-key';
    const policy = buildA2ABearerPolicy!(null);
    setA2ABearerPolicy(policy as never);
    installAuthenticatedOwnerResolver(policy as never);

    // The A2A HTTP boundary validates the A2A key...
    expect(authenticateA2A({ authorization: 'Bearer a2a-only-key' })).toMatchObject({ ok: true });
    // ...and ownership is derived from that VALIDATED principal, never from the
    // raw caller-supplied bearer string (the reviewed build hashed any string).
    const owner = await resolveOwnerId({ authorization: 'Bearer a2a-only-key' });
    expect(owner).toMatch(/^[0-9a-f]{64}$/);
    expect(owner).not.toContain('a2a-only-key');
    await expect(resolveOwnerId({ authorization: 'Bearer attacker-chosen' })).resolves.toBeUndefined();
    await expect(resolveOwnerId({})).resolves.toBeUndefined();
  });

  it('accepts MCP keys at the A2A boundary (same policy object for auth and ownership)', async () => {
    process.env.DMRX_MCP_API_KEY = 'mcp-key';
    const policy = buildA2ABearerPolicy!(null);
    setA2ABearerPolicy(policy as never);
    installAuthenticatedOwnerResolver(policy as never);

    expect(authenticateA2A({ authorization: 'Bearer mcp-key' })).toMatchObject({ ok: true });
    expect(await resolveOwnerId({ authorization: 'Bearer mcp-key' })).toMatch(/^[0-9a-f]{64}$/);
    expect(authenticateA2A({ authorization: 'Bearer nope' })).toMatchObject({ ok: false });
  });

  it('never lets an A2A-only credential act as an MCP credential', () => {
    process.env.DMRX_A2A_API_KEY = 'a2a-only-key';
    process.env.DMRX_MCP_API_KEY = 'mcp-key';
    // The MCP policy must not have absorbed the A2A key.
    const mcpPolicy = buildHttpBearerPolicy(null);
    expect(mcpPolicy.keys.map((k) => k.key)).not.toContain('a2a-only-key');
    expect(
      authenticateBearer({ headers: { authorization: 'Bearer a2a-only-key' } }, mcpPolicy).authorized,
    ).toBe(false);
    expect(
      authenticateBearer({ headers: { authorization: 'Bearer mcp-key' } }, mcpPolicy).authorized,
    ).toBe(true);
  });

  it('keeps MCP tool restrictions at the A2A boundary and for ownership', async () => {
    process.env.DMRX_MCP_API_KEYS_CONFIG = JSON.stringify([
      { key: 'scoped-key', allowedTools: ['dmrx_chat'] },
    ]);
    const policy = buildA2ABearerPolicy!(null);
    setA2ABearerPolicy(policy as never);
    installAuthenticatedOwnerResolver(policy as never);

    expect(authenticateA2A({ authorization: 'Bearer scoped-key' })).toMatchObject({ ok: false });
    await expect(resolveOwnerId({ authorization: 'Bearer scoped-key' })).resolves.toBeUndefined();
  });
});

describe('LOGIC-LOW historyLength: 0 returns an empty history', () => {
  it('answers tasks/get { historyLength: 0 } with no history entries', async () => {
    const taskId = await seedOwnedTask('history zero');
    getTaskManager().setStatus(taskId, 'working', textMessage('agent', 'second turn'));

    const full = await rpc('tasks/get', { id: taskId });
    expect((full.result as { history: unknown[] }).history.length).toBeGreaterThanOrEqual(2);

    const none = await rpc('tasks/get', { id: taskId, historyLength: 0 });
    expect(none.error).toBeUndefined();
    expect((none.result as { history: unknown[] }).history).toEqual([]);

    const one = await rpc('tasks/get', { id: taskId, historyLength: 1 });
    expect((one.result as { history: unknown[] }).history).toHaveLength(1);
  });

  it('applies the same rule through the owner-scoped store API', async () => {
    const ownerId = await resolveOwnerId(OWNER as never);
    const taskId = await seedOwnedTask('store zero');
    expect(getTaskManager().getOwnedTask(ownerId, taskId, 0)?.history).toEqual([]);
    expect(getTaskManager().getOwnedTask(ownerId, taskId)?.history.length).toBeGreaterThan(0);
  });
});

describe('LOGIC-LOW resubscribe follow-ups carry the negotiated 1.0 version', () => {
  it('emits every follow-up status update in v1 form, matching the initial replay', async () => {
    const taskId = await seedOwnedTask('follow me');

    const events: JsonRpcResponse[] = [];
    const done = handleRpcStream(
      { jsonrpc: '2.0', id: 7, method: 'tasks/resubscribe', params: { id: taskId } } as never,
      OWNER as never,
      { send: (event) => events.push(event), end: () => {} },
      { version: '1.0' },
    );

    // Let the initial replay land and the follow-up subscription attach.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const tm = getTaskManager();
    tm.setStatus(taskId, 'working');
    tm.setStatus(taskId, 'completed');
    await done;

    const ok = events.filter((event) => !event.error);
    expect(ok.length, 'replay + at least one follow-up').toBeGreaterThanOrEqual(2);
    const states = ok.map((event) => String((event.result as { status?: { state?: string } }).status?.state));
    for (const state of states) {
      expect(state, `every event on a 1.0 stream must use the v1 enum, got ${state}`).toMatch(
        /^TASK_STATE_/,
      );
    }
    expect(states).toContain('TASK_STATE_COMPLETED');
  });
});

describe('SUGGEST the genuine v1 CancelTask method resolves, legacy kept', () => {
  it('cancels through CancelTask with a v1 task result', async () => {
    const taskId = await seedOwnedTask('cancel via v1');

    const v1 = await rpc('CancelTask', { id: taskId }, OWNER, '1.0');
    expect(v1.error, 'CancelTask must not be METHOD_NOT_FOUND').toBeUndefined();
    expect((v1.result as { status: { state: string } }).status.state).toBe('TASK_STATE_CANCELED');
  });

  it('keeps the legacy tasks/cancel spelling and the legacy result shape', async () => {
    const taskId = await seedOwnedTask('cancel via legacy');

    const legacy = await rpc('tasks/cancel', { id: taskId });
    expect(legacy.error).toBeUndefined();
    const result = legacy.result as { status: { state: string }; task?: unknown };
    expect(result.status.state).toBe('canceled');
    expect(result).not.toHaveProperty('task');
  });

  it('maps CancelTask onto an owner-scoped cancel (a stranger still gets TASK_NOT_FOUND)', async () => {
    const taskId = await seedOwnedTask('cancel owner scoped');
    const stranger = { authorization: 'Bearer review-stranger', 'x-dmr-tenant-key': 'review-key' };
    const res = await rpc('CancelTask', { id: taskId }, stranger, '1.0');
    expect(res.error?.code).toBe(A2A_ERR.TASK_NOT_FOUND);
  });
});
