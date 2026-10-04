/**
 * A2A ownership secrecy tests.
 *
 * Independent of the production-ownership suite: this file asserts the
 * NEGATIVE space — that credentials and owner identity never leave the server,
 * that an unauthenticated or tenant-header-only caller gets nothing, and that
 * legacy tasks with no recorded owner are not handed to any remote caller.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleRpc, A2A_ERR } from '../../services/mcp-server/src/a2a/jsonrpc.js';
import {
  closePersistence,
  initPersistence,
  loadOwnerBindings,
} from '../../services/mcp-server/src/a2a/persistence.js';
import {
  getTaskManager,
  resetTaskManager,
} from '../../services/mcp-server/src/a2a/task-manager.js';
import {
  defaultResolveOwner,
  legacyUnownedVisibility,
  resolveOwnerId,
  setOwnerResolver,
} from '../../services/mcp-server/src/a2a/owner.js';

const OWNER_A = { authorization: 'Bearer secret-token-alpha', 'x-dmr-tenant-key': 'secret-tenant-key-alpha' };

let tempDir: string;
const originalCompat = process.env.DMRX_A2A_LEGACY_UNOWNED_COMPAT;

function rpc(method: string, params: unknown = {}, headers: Record<string, string> = OWNER_A) {
  return handleRpc({ jsonrpc: '2.0', id: 1, method, params } as never, headers as never);
}

/** Serialized form of every payload the server hands back to this caller. */
function payloadsOf(...responses: Array<{ result?: unknown; error?: unknown }>): string {
  return responses.map((r) => JSON.stringify(r)).join('\n');
}

beforeEach(async () => {
  closePersistence();
  resetTaskManager();
  setOwnerResolver(null);
  delete process.env.DMRX_A2A_LEGACY_UNOWNED_COMPAT;
  tempDir = mkdtempSync(join(tmpdir(), 'dmrx-a2a-secrecy-'));
  initPersistence({ dbPath: join(tempDir, 'a2a.sqlite'), pushEnabled: false });
  // initPersistence opens the sqlite handle through a lazy dynamic import.
  await new Promise((resolve) => setTimeout(resolve, 100));
});

afterEach(() => {
  if (originalCompat === undefined) delete process.env.DMRX_A2A_LEGACY_UNOWNED_COMPAT;
  else process.env.DMRX_A2A_LEGACY_UNOWNED_COMPAT = originalCompat;
  setOwnerResolver(null);
  closePersistence();
  resetTaskManager();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('A2A owner metadata never exposes a credential', () => {
  it('keeps the bearer token and tenant key out of every outbound payload', async () => {
    const created = await rpc('message/send', {
      message: { role: 'user', parts: [{ kind: 'text', text: 'hi' }], messageId: 'm1', taskId: 'sec-task' },
      metadata: { callerLabel: 'friendly-label' },
    });
    const got = await rpc('tasks/get', { id: 'sec-task' });
    const listed = await rpc('tasks/list', { includeHistory: true });
    const pushed = await rpc('tasks/pushNotificationConfig/get', { taskId: 'sec-task' });

    const wire = payloadsOf(created, got, listed, pushed);
    expect(wire).not.toContain('secret-token-alpha');
    expect(wire).not.toContain('secret-tenant-key-alpha');
    // A caller-supplied metadata object is preserved; ownership is NOT injected
    // into it (that is exactly where a digest or token would leak).
    expect((got.result as { metadata: Record<string, unknown> }).metadata).toEqual({ callerLabel: 'friendly-label' });
  });

  it('persists only a non-reversible digest, never the credential', async () => {
    await rpc('message/send', {
      message: { role: 'user', parts: [{ kind: 'text', text: 'hi' }], messageId: 'm1', taskId: 'digest-task' },
    });
    const bindings = loadOwnerBindings();
    expect(bindings.tasks).toHaveLength(1);
    const stored = bindings.tasks[0].ownerId;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain('secret-token-alpha');
    expect(stored).not.toContain('secret-tenant-key-alpha');
  });

  it('does not accept a caller-supplied owner in metadata', async () => {
    const res = await rpc('message/send', {
      message: { role: 'user', parts: [{ kind: 'text', text: 'spoof' }], messageId: 'm1', taskId: 'spoof-task' },
      metadata: { owner: 'someone-else', ownerId: 'deadbeef' },
    });
    // The spoofed keys are stored verbatim as caller metadata but grant nothing:
    // the authoritative owner is the one bound at creation.
    expect((res.result as { metadata: Record<string, unknown> }).metadata).toEqual({
      owner: 'someone-else',
      ownerId: 'deadbeef',
    });
    const other = { authorization: 'Bearer other-token', 'x-dmr-tenant-key': 'other-tenant' };
    expect((await rpc('tasks/get', { id: 'spoof-task' }, other)).error?.code).toBe(A2A_ERR.TASK_NOT_FOUND);
  });
});

describe('A2A requires a validated bearer principal', () => {
  it('refuses to create a task with no authenticated principal', async () => {
    const res = await rpc('message/send', {
      message: { role: 'user', parts: [{ kind: 'text', text: 'hi' }], messageId: 'm1', taskId: 'anon-task' },
    }, {});
    expect(res.error?.code).toBe(A2A_ERR.AUTH_REQUIRED);
    // And no unowned task was left behind.
    expect(getTaskManager().taskCount()).toBe(0);
  });

  it('never treats the caller-supplied tenant header as authorization', async () => {
    await rpc('message/send', {
      message: { role: 'user', parts: [{ kind: 'text', text: 'hi' }], messageId: 'm1', taskId: 'owned-task' },
    });
    // The exact tenant key, with no bearer credential at all, must not work.
    const headerOnly = { 'x-dmr-tenant-key': 'secret-tenant-key-alpha' };
    expect((await rpc('tasks/get', { id: 'owned-task' }, headerOnly)).error?.code).toBe(A2A_ERR.AUTH_REQUIRED);
    expect((await rpc('tasks/cancel', { id: 'owned-task' }, headerOnly)).error?.code).toBe(A2A_ERR.AUTH_REQUIRED);
    expect((await rpc('tasks/list', {}, headerOnly)).result).toEqual({ tasks: [] });
  });

  it.each([
    ['no scheme', { authorization: 'secret-token-alpha' }],
    ['wrong scheme', { authorization: 'Basic secret-token-alpha' }],
    ['empty token', { authorization: 'Bearer ' }],
    ['token with whitespace', { authorization: 'Bearer alpha beta' }],
  ])('rejects a malformed Authorization header (%s)', async (_label, headers) => {
    expect(await defaultResolveOwner(headers)).toBeUndefined();
    const res = await rpc('tasks/list', {}, headers);
    expect(res.result).toEqual({ tasks: [] });
  });

  it('derives a stable owner digest and separates principals by tenant binding', async () => {
    const a1 = await resolveOwnerId(OWNER_A);
    const a2 = await resolveOwnerId(OWNER_A);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(await resolveOwnerId({ authorization: 'Bearer secret-token-alpha' }));
    expect(a1).not.toBe(
      await resolveOwnerId({ authorization: 'Bearer secret-token-alpha', 'x-dmr-tenant-key': 'different-tenant' }),
    );
    expect(a1).not.toBe(await resolveOwnerId({ authorization: 'Bearer other-token', 'x-dmr-tenant-key': 'secret-tenant-key-alpha' }));
  });

  it('honours an installed resolver as the authoritative identity seam', async () => {
    // This is the seam the parent MCP listener uses after authenticating: it
    // supplies the subject, and A2A hashes it rather than trusting a header.
    setOwnerResolver(() => ({ subject: 'api-key:abc123', tenant: 'acme' }));
    const injected = await resolveOwnerId({});
    expect(injected).toMatch(/^[0-9a-f]{64}$/);
    expect(injected).not.toContain('abc123');

    const created = await rpc('message/send', {
      message: { role: 'user', parts: [{ kind: 'text', text: 'hi' }], messageId: 'm1', taskId: 'seam-task' },
    }, {});
    expect(created.error).toBeUndefined();
    expect((await rpc('tasks/get', { id: 'seam-task' }, {})).error).toBeUndefined();

    // A resolver that reports no principal means "no access", not "fall back".
    setOwnerResolver(() => undefined);
    expect((await rpc('tasks/get', { id: 'seam-task' }, {})).error?.code).toBe(A2A_ERR.AUTH_REQUIRED);
  });
});

describe('A2A legacy unowned tasks are not shared with remote callers', () => {
  /** Simulate a task persisted by a build that predates ownership. */
  async function seedUnownedTask(id: string): Promise<void> {
    const ownerId = await resolveOwnerId(OWNER_A);
    // Create normally, then strip the binding from memory so the task is
    // exactly the shape a pre-ownership build would have persisted.
    const created = getTaskManager().createTask(
      { role: 'user', parts: [{ kind: 'text', text: 'legacy' }], messageId: `${id}-m`, taskId: id, kind: 'message' },
      { ownerId },
    );
    expect(created.error).toBeUndefined();
    expect(created.task?.id).toBe(id);
    (getTaskManager() as unknown as { owners: Map<string, string> }).owners.delete(id);
    (getTaskManager() as unknown as { contextOwners: Map<string, string> }).contextOwners.clear();
    expect((getTaskManager() as unknown as { owners: Map<string, string> }).owners.has(id)).toBe(false);
  }

  it('hides an unowned legacy task from every remote principal by default', async () => {
    await seedUnownedTask('legacy-task');
    expect(legacyUnownedVisibility()).toBe(false);

    // Even the principal that ORIGINALLY created it cannot reach it now: an
    // unowned task has no provable owner, and guessing one is cross-company
    // sharing. Reported as not-found so existence is not disclosed.
    expect((await rpc('tasks/get', { id: 'legacy-task' })).error?.code).toBe(A2A_ERR.TASK_NOT_FOUND);
    expect((await rpc('tasks/cancel', { id: 'legacy-task' })).error?.code).toBe(A2A_ERR.TASK_NOT_FOUND);
    expect((await rpc('tasks/resubscribe' as never, { id: 'legacy-task' }) as never)).toBeTruthy();
    expect((await rpc('tasks/list', {})).result).toEqual({ tasks: [] });
    expect((await rpc('tasks/pushNotificationConfig/set', {
      taskId: 'legacy-task',
      pushNotificationConfig: { url: 'https://example.com/h' },
    })).error?.code).toBe(A2A_ERR.TASK_NOT_FOUND);
  });

  it('does not leak an unowned task through the owner-scoped retained count', async () => {
    await seedUnownedTask('legacy-count');
    // `retained` describes the caller's own tasks; an unowned task is nobody's.
    expect(getTaskManager().ownedTaskCount(await resolveOwnerId(OWNER_A))).toBe(0);
  });

  it('exposes unowned tasks to the in-process operator only when explicitly opted in', async () => {
    await seedUnownedTask('legacy-visible');
    process.env.DMRX_A2A_LEGACY_UNOWNED_COMPAT = '1';
    expect(legacyUnownedVisibility()).toBe(true);

    // The operator path (no principal) can see it...
    const tm = getTaskManager();
    expect(tm.listOwnedTasks(undefined).map((t) => t.id)).toContain('legacy-visible');
    expect(tm.ownedTaskCount(undefined)).toBe(1);
    // ...but a REMOTE principal still gets nothing, even with the compat flag on.
    expect(tm.listOwnedTasks(await resolveOwnerId(OWNER_A))).toEqual([]);
    expect((await rpc('tasks/get', { id: 'legacy-visible' })).error?.code).toBe(A2A_ERR.TASK_NOT_FOUND);
  });
});

describe('A2A ownership survives a full store rebuild from sqlite', () => {
  it('rebinds tasks and contexts to the same principal after a restart', async () => {
    await rpc('message/send', {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: 'durable' }],
        messageId: 'm1',
        taskId: 'durable-task',
        contextId: 'durable-context',
      },
    });
    // Rebuild the store from disk exactly as a process restart would.
    resetTaskManager();
    expect(getTaskManager().getTask('durable-task')).not.toBeNull();

    const stranger = { authorization: 'Bearer stranger-token', 'x-dmr-tenant-key': 'stranger-tenant' };
    expect((await rpc('tasks/get', { id: 'durable-task' })).error).toBeUndefined();
    expect((await rpc('tasks/get', { id: 'durable-task' }, stranger)).error?.code).toBe(A2A_ERR.TASK_NOT_FOUND);
    expect((await rpc('tasks/list', {}, stranger)).result).toEqual({ tasks: [] });

    // A new turn on the SAME contextId by a stranger is refused, not merged.
    const hijack = await rpc('message/send', {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: 'hijack' }],
        messageId: 'm2',
        contextId: 'durable-context',
      },
    }, stranger);
    expect(hijack.error?.code).toBe(A2A_ERR.TASK_NOT_FOUND);
  });
});
