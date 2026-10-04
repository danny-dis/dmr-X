/**
 * Independent A2A protocol contract tests.
 *
 * These do not depend on the ownership suite: they assert that what the Agent
 * Card ADVERTISES is what the server actually DOES. An agent that claims
 * `pushNotifications: true` but silently drops every webhook, or claims a
 * protocol version whose methods it answers with METHOD_NOT_FOUND, is worse
 * than one that advertises less — clients route work based on this card.
 */

import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildAgentCard } from '../../services/mcp-server/src/a2a/agent-card.js';
import { handleRpc, handleRpcStream, A2A_ERR, type JsonRpcResponse } from '../../services/mcp-server/src/a2a/jsonrpc.js';
import {
  closePersistence,
  initPersistence,
} from '../../services/mcp-server/src/a2a/persistence.js';
import { resetTaskManager } from '../../services/mcp-server/src/a2a/task-manager.js';

const OWNER = { authorization: 'Bearer contract-owner', 'x-dmr-tenant-key': 'contract-key' };

let gateway: Server;
let tempDir: string;
let gatewayBodies: Array<Record<string, unknown>>;
const originalGatewayUrl = process.env.DMRX_GATEWAY_URL;
const originalAllowlist = process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS;

async function startGateway() {
  gatewayBodies = [];
  gateway = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      gatewayBodies.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: 'contract-result' }));
    });
  });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  process.env.DMRX_GATEWAY_URL = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
}

/**
 * Close a fixture without awaiting the drain. Order matters: the aborted
 * dispatch may still hold a keep-alive socket, and awaiting `close()` first
 * would wait on it forever.
 */
const shutdown = async (server: Server) => {
  server.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
};

function rpc(method: string, params: unknown = {}, headers = OWNER) {
  return handleRpc({ jsonrpc: '2.0', id: 1, method, params } as never, headers as never);
}

/** Collect the JSON-RPC envelopes a streaming method emits. */
async function stream(method: string, params: unknown, headers = OWNER): Promise<JsonRpcResponse[]> {
  const events: JsonRpcResponse[] = [];
  await handleRpcStream(
    { jsonrpc: '2.0', id: 7, method, params } as never,
    headers as never,
    {
      send: (event) => events.push(event),
      end: () => {},
    },
  );
  return events;
}

beforeEach(async () => {
  closePersistence();
  resetTaskManager();
  tempDir = mkdtempSync(join(tmpdir(), 'dmrx-a2a-contract-'));
  initPersistence({ dbPath: join(tempDir, 'a2a.sqlite'), pushEnabled: false });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await startGateway();
});

afterEach(async () => {
  process.env.DMRX_GATEWAY_URL = originalGatewayUrl;
  if (originalAllowlist === undefined) delete process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS;
  else process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS = originalAllowlist;
  closePersistence();
  resetTaskManager();
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
  gateway.closeAllConnections();
  rmSync(tempDir, { recursive: true, force: true });
});

const card = () => buildAgentCard({ url: 'https://agent.example' }, [{ name: 'dmrx_chat', description: 'chat' }]);

describe('A2A advertised method set is implemented, not aspirational', () => {
  // Every non-streaming method the server claims to speak. If the card promises
  // streaming, both streaming methods must exist too.
  const BLOCKING_METHODS = [
    'message/send',
    'tasks/get',
    'tasks/cancel',
    'tasks/list',
    'tasks/pushNotificationConfig/set',
    'tasks/pushNotificationConfig/get',
    'agent/getExtendedCard',
    'agent/authenticatedExtendedCard',
  ];

  it('answers every advertised blocking method, never METHOD_NOT_FOUND', async () => {
    for (const method of BLOCKING_METHODS) {
      const res = await rpc(method, { id: 'no-such-task', taskId: 'no-such-task', message: undefined });
      expect(res.error?.code, `${method} must not be METHOD_NOT_FOUND`).not.toBe(A2A_ERR.METHOD_NOT_FOUND);
    }
  });

  it('routes every advertised streaming method onto the SSE surface', async () => {
    expect(card().capabilities.streaming).toBe(true);
    // `isStreamMethod` is the router's own predicate — assert it agrees with the
    // card rather than hard-coding the list twice.
    const { isStreamMethod } = await import('../../services/mcp-server/src/a2a/jsonrpc.js');
    expect(isStreamMethod('message/stream')).toBe(true);
    expect(isStreamMethod('tasks/resubscribe')).toBe(true);
    // A blocking method offered over SSE is answered as a single event.
    const events = await stream('tasks/resubscribe', { id: 'no-such-task' });
    expect(events).toHaveLength(1);
    expect(events[0].error?.code).toBe(A2A_ERR.TASK_NOT_FOUND);
  });

  it('keeps the legacy 0.3.0 card version and does not claim a 1.0-only method', async () => {
    const built = card();
    // Legacy 0.3.0 consumers match on this; v1.0 clients read supportedInterfaces.
    expect(built.protocolVersion).toBe('0.3.0');
    expect(built.supportedInterfaces[0].protocolVersion).toBe('1.0');
    // v1.0 replaced `tasks/pushNotificationConfig/*` with a task-level
    // `pushNotificationConfig`; we keep the 0.3 shape only, so the v1-only
    // method must NOT be silently accepted as if supported.
    const res = await rpc('tasks/sendSubscribe');
    expect(res.error?.code).toBe(A2A_ERR.METHOD_NOT_FOUND);
  });

  it('advertises stateTransitionHistory only because tasks/get honours historyLength', async () => {
    expect(card().capabilities.stateTransitionHistory).toBe(true);
    const created = await rpc('message/send', {
      message: { role: 'user', parts: [{ kind: 'text', text: 'history' }], messageId: 'h1', taskId: 'hist-task' },
    });
    expect(created.error).toBeUndefined();
    const full = await rpc('tasks/get', { id: 'hist-task' });
    const trimmed = await rpc('tasks/get', { id: 'hist-task', historyLength: 1 });
    expect((full.result as { history: unknown[] }).history.length).toBeGreaterThanOrEqual(2);
    expect((trimmed.result as { history: unknown[] }).history).toHaveLength(1);
    // A malformed value is rejected rather than silently clamped.
    expect((await rpc('tasks/get', { id: 'hist-task', historyLength: -1 })).error?.code).toBe(A2A_ERR.INVALID_PARAMS);
  });
});

describe('A2A pushNotifications capability is real end to end', () => {
  it('stores a policy-authorized webhook and actually delivers the terminal task', async () => {
    // Delivery is disabled in the shared fixture config; this is the one test
    // that asserts the capability actually fires, so re-open with push enabled.
    const dbPath = join(tempDir, 'a2a.sqlite');
    closePersistence();
    initPersistence({ dbPath, pushEnabled: true });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The fixture is loopback, which policy forbids by default, so the
    // operator allowlist authorizes THIS address explicitly rather than the test
    // being allowed to reach any network address it likes.
    process.env.DMRX_A2A_WEBHOOK_ALLOWED_IPS = '127.0.0.1';

    let received: Record<string, unknown> | null = null;
    const hook = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received = JSON.parse(Buffer.concat(chunks).toString());
        res.writeHead(200).end();
      });
    });
    hook.listen(0, '127.0.0.1');
    await once(hook, 'listening');
    const hookUrl = `http://127.0.0.1:${(hook.address() as { port: number }).port}/push`;

    try {
      const created = await rpc('message/send', {
        message: { role: 'user', parts: [{ kind: 'text', text: 'push me' }], messageId: 'p1', taskId: 'push-task' },
        configuration: { pushNotificationConfig: { url: hookUrl } },
      });
      expect(created.error).toBeUndefined();

      const stored = await rpc('tasks/pushNotificationConfig/get', { taskId: 'push-task' });
      expect(stored.error).toBeUndefined();
      expect((stored.result as { pushNotificationConfig: { url: string } }).pushNotificationConfig.url).toBe(hookUrl);

      // Delivery is fire-and-forget from finalize(); wait for the fixture.
      const deadline = Date.now() + 5_000;
      while (received === null && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(received, 'push webhook must actually fire').not.toBeNull();
      expect((received as unknown as { id: string }).id).toBe('push-task');
    } finally {
      hook.close();
      hook.closeAllConnections();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  });
});

describe('A2A cancellation aborts the downstream request and keeps the terminal status', () => {
  it('closes the upstream socket on cancel instead of letting the dispatch finish', async () => {
    // A gateway that accepts the dispatch and never answers: without an abort
    // on cancel this request stays open (and paid for) long after the client
    // was told the task was canceled.
    // Accepts the dispatch and never answers. The cancel normally lands while
    // the connection is still being established, so this fixture exists to prove
    // the dispatch cannot sit waiting on a response that will never come.
    const stalled = createServer((req, res) => {
      req.resume();
      void res;
    });
    stalled.listen(0, '127.0.0.1');
    await once(stalled, 'listening');

    // Tear the fixture down by destroying live sockets as the close is
    // initiated (see `shutdown` above).
    // Observe the abort signal handed to the transport. Asserting that the TCP
    // socket is torn down would test undici's connection pool (which keeps
    // sockets for reuse by design), not the behaviour under test: that a cancel
    // ABORTS the in-flight request instead of letting it run on.
    const realFetch = globalThis.fetch;
    let dispatchSignal: AbortSignal | null = null;
    let sawAbortedSignal = false;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      if (signal && typeof signal === 'object' && 'aborted' in signal) {
        dispatchSignal = signal as AbortSignal;
        if (dispatchSignal.aborted) sawAbortedSignal = true;
        else dispatchSignal.addEventListener('abort', () => { sawAbortedSignal = true; }, { once: true });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    try {
      const { getTaskManager } = await import('../../services/mcp-server/src/a2a/task-manager.js');
      const { dispatchTask } = await import('../../services/mcp-server/src/a2a/dispatch.js');
      const { resolveOwnerId } = await import('../../services/mcp-server/src/a2a/owner.js');

      // Create the task WITHOUT dispatching it, so it is still `submitted` and
      // therefore cancelable. A dispatched task would already be terminal, and
      // cancel correctly refuses a terminal task.
      const ownerId = await resolveOwnerId(OWNER as never);
      expect(ownerId).toBeTruthy();
      const seeded = getTaskManager().createTask(
        {
          role: 'user',
          parts: [{ kind: 'text', text: 'seed' }],
          messageId: 's1',
          kind: 'message',
        },
        { ownerId },
      );
      expect(seeded.error).toBeUndefined();
      const taskId = seeded.task!.id;
      expect(seeded.task!.status.state).toBe('submitted');

      // Now dispatch against a gateway that accepts and never answers: without
      // an abort on cancel this request stays open (and paid for) long after the
      // client was told the task was canceled.
      process.env.DMRX_GATEWAY_URL = `http://127.0.0.1:${(stalled.address() as { port: number }).port}`;

      const inflight = dispatchTask(taskId, OWNER as never);
      // Let the request actually reach the stalled gateway before canceling.
      const start = Date.now();
      while (!getTaskManager().isDispatchInflight(taskId) && Date.now() - start < 2_000) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(getTaskManager().isDispatchInflight(taskId)).toBe(true);

      const canceled = await rpc('tasks/cancel', { id: taskId });
      expect(canceled.error).toBeUndefined();
      expect((canceled.result as { status: { state: string } }).status.state).toBe('canceled');

      // The dispatch must settle promptly rather than waiting out its 60s timeout.
      const settled = await Promise.race([
        inflight.then(() => 'settled'),
        new Promise((r) => setTimeout(() => r('hung'), 5_000)),
      ]);
      expect(settled, 'a canceled dispatch must not keep running to its timeout').toBe('settled');

      // Terminal status is preserved — not resurrected as completed/failed.
      const after = await rpc('tasks/get', { id: taskId });
      expect((after.result as { status: { state: string } }).status.state).toBe('canceled');

      expect(dispatchSignal, 'dispatch must pass an abort signal to the transport').not.toBeNull();
      expect(sawAbortedSignal, 'the in-flight dispatch signal must be aborted by the cancel').toBe(true);
    } finally {
      globalThis.fetch = realFetch;
      await shutdown(stalled);
    }
  });

  it('refuses to cancel an already-terminal task', async () => {
    const created = await rpc('message/send', {
      message: { role: 'user', parts: [{ kind: 'text', text: 'done' }], messageId: 'd1', taskId: 'done-task' },
    });
    expect((created.result as { status: { state: string } }).status.state).toBe('completed');
    const res = await rpc('tasks/cancel', { id: 'done-task' });
    expect(res.error?.code).toBe(A2A_ERR.TASK_NOT_CANCELABLE);
  });

  it('keeps a canceled task canceled when a late upstream response arrives', async () => {
    // A dispatch aborted mid-flight can still have a response in hand. When it
    // lands it must not resurrect the terminal status the client already saw.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const realFetch = globalThis.fetch;
    const stalled = createServer(async (req, res) => {
      await gate;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: 'late-result' }));
    });
    stalled.listen(0, '127.0.0.1');
    await once(stalled, 'listening');
    process.env.DMRX_GATEWAY_URL = `http://127.0.0.1:${(stalled.address() as { port: number }).port}`;

    try {
      // `message/send` does not resolve until the dispatch settles, so it must
      // NOT be awaited: the whole point is to cancel while it is still in
      // flight. The client-chosen `taskId` is what makes this addressable.
      const inflight = rpc('message/send', {
        message: { role: 'user', parts: [{ kind: 'text', text: 'late' }], messageId: 'd1', taskId: 'late-task' },
      });
      let settled = false;
      void inflight.then(() => { settled = true; }, () => { settled = true; });

      // Wait for the task to be registered, then cancel it mid-dispatch.
      let taskId = 'late-task';
      for (let i = 0; i < 40 && !(await rpc('tasks/get', { id: taskId })).result; i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      const exists = await rpc('tasks/get', { id: taskId });
      expect(exists.error, 'the task must exist before it can be canceled').toBeUndefined();

      const canceled = await rpc('tasks/cancel', { id: taskId });
      expect(canceled.error, 'an in-flight task must be cancelable').toBeUndefined();
      expect((canceled.result as { status: { state: string } }).status.state).toBe('canceled');

      // Let the aborted dispatch's response land now.
      release();
      await new Promise((resolve) => setTimeout(resolve, 300));

      const after = await rpc('tasks/get', { id: taskId });
      const state = (after.result as { status: { state: string } }).status.state;
      expect(state, 'a late response must not resurrect a canceled task').toBe('canceled');

      // Permanence: a second cancel still reports the terminal task, and no
      // artifact from the late completion may be attached.
      const again = await rpc('tasks/cancel', { id: taskId });
      expect(again.error?.code).toBe(A2A_ERR.TASK_NOT_CANCELABLE);
      const final = await rpc('tasks/get', { id: taskId });
      expect((final.result as { artifacts?: unknown[] }).artifacts ?? []).toHaveLength(0);
    } finally {
      globalThis.fetch = realFetch;
      await shutdown(stalled);
    }
  });
});

describe('A2A tasks/list paginates with an opaque cursor', () => {
  const IDS = Array.from({ length: 7 }, (_, i) => `cursor-task-${i}`);

  beforeEach(async () => {
    for (const [i, taskId] of IDS.entries()) {
      const res = await rpc('message/send', {
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: `task ${i}` }],
          messageId: `cursor-msg-${i}`,
          taskId,
        },
      });
      expect(res.error, `seed ${taskId} must be created`).toBeUndefined();
    }
  });

  it('walks every owned task exactly once across pages, then reports the end', async () => {
    const seen: string[] = [];
    let token: string | undefined;
    let pages = 0;

    do {
      const res: any = await rpc('tasks/list', token ? { pageSize: 3, pageToken: token } : { pageSize: 3 });
      expect(res.error).toBeUndefined();
      const result = res.result as { tasks: Array<{ id: string }>; nextPageToken?: string; totalSize?: number };
      seen.push(...result.tasks.map((t) => t.id));
      token = result.nextPageToken;
      pages += 1;
      expect(pages, 'pagination must terminate').toBeLessThan(10);
    } while (token);

    expect(new Set(seen).size, 'a task must never appear on two pages').toBe(seen.length);
    for (const id of IDS) expect(seen, `${id} must be reachable through the cursor`).toContain(id);
    expect(seen, 'pagination must cover every task it owns').toHaveLength(IDS.length);
  });

  it('omits nextPageToken on the final page rather than returning an empty one', async () => {
    const res: any = await rpc('tasks/list', { pageSize: 100 });
    const result = res.result as { tasks: unknown[]; nextPageToken?: string };
    expect(result.tasks.length).toBeGreaterThanOrEqual(IDS.length);
    // No further pages: the token must be absent or empty, never a cursor that
    // a client would have to special-case.
    expect(result.nextPageToken ?? '').toBe('');
  });

  it('rejects a malformed cursor instead of silently restarting the listing', async () => {
    const res = await rpc('tasks/list', { pageSize: 3, pageToken: 'not-a-real-cursor' });
    // Spec-legal choices are an error or an empty terminal page. What is NOT
    // legal is handing back page 1 again — that loops a client forever.
    if (res.error) {
      expect(res.error.code).toBe(A2A_ERR.INVALID_PARAMS);
    } else {
      expect((res.result as { tasks: unknown[] }).tasks).toHaveLength(0);
    }
  });

  it('never leaks another principal\'s tasks through the cursor', async () => {
    const OTHER = { authorization: 'Bearer other-cursor-owner', 'x-dmr-tenant-key': 'other-key' };
    await rpc('message/send', {
      message: { role: 'user', parts: [{ kind: 'text', text: 'secret' }], messageId: 'x1', taskId: 'other-cursor-task' },
    }, OTHER);

    const res: any = await rpc('tasks/list', { pageSize: 100 });
    const ids = (res.result as { tasks: Array<{ id: string }> }).tasks.map((t) => t.id);
    expect(ids).not.toContain('other-cursor-task');
    for (const id of IDS) expect(ids).toContain(id);
  });
});
