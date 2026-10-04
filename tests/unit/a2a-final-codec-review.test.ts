/**
 * Final codec review regressions: exact SDK 1.1.1 JSON-RPC surface.
 *
 * Compared against the installed official SDK
 * (`a2a/client/transports/jsonrpc.py`): the transport sends
 * `CreateTaskPushNotificationConfig`, `GetTaskPushNotificationConfig`,
 * `ListTaskPushNotificationConfigs`, `DeleteTaskPushNotificationConfig`,
 * `ListTasks` and `GetExtendedAgentCard`, but `V1_METHODS` only mapped five
 * methods, so every one of those answered METHOD_NOT_FOUND over the 1.0
 * interface. Legacy lowercase spellings are preserved.
 *
 * Shapes follow protobuf-JSON (`MessageToDict` camelCase):
 * - `TaskPushNotificationConfig` is FLAT ({taskId, id, url, ...}); the legacy
 *   core stores {taskId, pushNotificationConfig: {url}}.
 * - `ListTasks` params use {contextId, pageSize, pageToken, historyLength,
 *   includeArtifacts}; the legacy core uses {contextId, status, pageSize,
 *   pageToken, includeHistory}.
 * - `ListTasks` result must be {tasks: Task[], nextPageToken?} with each task
 *   in the 1.0 wire shape; the generic single-task wrapper mangled it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleRpc, A2A_ERR } from '../../services/mcp-server/src/a2a/jsonrpc.js';
import {
  legacyV1Request,
  V1_METHODS,
  wireV1Response,
} from '../../services/mcp-server/src/a2a/v1-codec.js';
import { resetTaskManager } from '../../services/mcp-server/src/a2a/task-manager.js';
import {
  closePersistence,
  initPersistence,
} from '../../services/mcp-server/src/a2a/persistence.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';

const OWNER = { authorization: 'Bearer codec-owner', 'x-dmr-tenant-key': 'codec-key' };

let tempDir: string;
let gateway: Server;
const originalGatewayUrl = process.env.DMRX_GATEWAY_URL;

function rpc(method: string, params: unknown = {}, headers = OWNER) {
  return handleRpc({ jsonrpc: '2.0', id: 1, method, params } as never, headers as never);
}

beforeEach(async () => {
  closePersistence();
  resetTaskManager();
  tempDir = mkdtempSync(join(tmpdir(), 'dmrx-a2a-final-codec-'));
  initPersistence({ dbPath: join(tempDir, 'a2a.sqlite'), pushEnabled: false });
  await new Promise((r) => setTimeout(r, 50));
  gateway = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: 'codec-reply' }));
    });
  });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  process.env.DMRX_GATEWAY_URL = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
});

afterEach(async () => {
  process.env.DMRX_GATEWAY_URL = originalGatewayUrl;
  closePersistence();
  resetTaskManager();
  gateway.close();
  gateway.closeAllConnections();
  await new Promise<void>((r) => setTimeout(r, 50));
  rmSync(tempDir, { recursive: true, force: true });
});

describe('final codec review: SDK 1.1.1 methods are mapped, legacy preserved', () => {
  it.each([
    'CreateTaskPushNotificationConfig',
    'GetTaskPushNotificationConfig',
    'ListTaskPushNotificationConfigs',
    'DeleteTaskPushNotificationConfig',
    'ListTasks',
    'GetExtendedAgentCard',
  ])('V1_METHODS maps %s', (method) => {
    expect(V1_METHODS[method], `${method} must be mapped`).toBeTruthy();
  });

  it('keeps every legacy mapping', () => {
    expect(V1_METHODS.SendMessage).toBe('message/send');
    expect(V1_METHODS.SendStreamingMessage).toBe('message/stream');
    expect(V1_METHODS.GetTask).toBe('tasks/get');
    expect(V1_METHODS.CancelTask).toBe('tasks/cancel');
    expect(V1_METHODS.SubscribeToTask).toBe('tasks/resubscribe');
  });

  it('Create/Get/Delete push configs round-trip the flat SDK shape', async () => {
    const created = await rpc('message/send', {
      message: { role: 'user', parts: [{ kind: 'text', text: 'push' }], messageId: 'm1', taskId: 'push-1' },
    });
    expect(created.error).toBeUndefined();

    const cfg = { taskId: 'push-1', id: 'cfg-1', url: 'https://example.com/hook' };
    const setRes = await rpc('CreateTaskPushNotificationConfig', cfg);
    expect(setRes.error).toBeUndefined();
    const setResult = setRes.result as Record<string, unknown>;
    expect(setResult.taskId).toBe('push-1');
    expect(setResult.url).toBe('https://example.com/hook');

    const getRes = await rpc('GetTaskPushNotificationConfig', { taskId: 'push-1', id: 'cfg-1' });
    expect(getRes.error).toBeUndefined();
    expect((getRes.result as Record<string, unknown>).url).toBe('https://example.com/hook');

    const listRes = await rpc('ListTaskPushNotificationConfigs', { taskId: 'push-1' });
    expect(listRes.error).toBeUndefined();
    const configs = (listRes.result as { configs: Array<{ url: string }> }).configs;
    expect(Array.isArray(configs)).toBe(true);
    expect(configs.map((c) => c.url)).toContain('https://example.com/hook');

    const delRes = await rpc('DeleteTaskPushNotificationConfig', { taskId: 'push-1', id: 'cfg-1' });
    expect(delRes.error).toBeUndefined();
    const afterList = (await rpc('ListTaskPushNotificationConfigs', { taskId: 'push-1' })).result as {
      configs: unknown[];
    };
    expect(afterList.configs).toHaveLength(0);
  });

  it('ListTasks honors the SDK pagination params and returns wired tasks', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await rpc('message/send', {
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: `t${i}` }],
          messageId: `m-${i}`,
          taskId: `list-task-${i}`,
        },
      });
      expect(res.error).toBeUndefined();
    }
    const res = await rpc('ListTasks', { pageSize: 2 });
    expect(res.error).toBeUndefined();
    const result = res.result as { tasks: Array<{ id: string; status: { state: string } }>; nextPageToken?: string };
    expect(result.tasks).toHaveLength(2);
    // 1.0 wire shape: TASK_STATE_* enum strings, not lowercase legacy states.
    for (const t of result.tasks) {
      expect(t.status.state).toMatch(/^TASK_STATE_/);
    }
  });

  it('legacyV1Request translates ListTasks historyLength without dropping the call', () => {
    const out = legacyV1Request({
      jsonrpc: '2.0',
      id: 1,
      method: 'ListTasks',
      params: { contextId: 'c', pageSize: 10, pageToken: 'tok', historyLength: 2, includeArtifacts: true },
    });
    expect(out.method).toBe('tasks/list');
    expect(out.params.pageSize).toBe(10);
  });

  it('wireV1Response keeps a ListTasks envelope intact (not single-task wrapped)', () => {
    const inner = {
      jsonrpc: '2.0' as const,
      id: 1 as const,
      result: {
        tasks: [
          {
            id: 't',
            contextId: 'c',
            status: { state: 'completed', timestamp: 'x' },
            artifacts: [],
            history: [],
          },
        ],
        nextPageToken: 'nxt',
      },
    };
    const out = wireV1Response(inner, 'ListTasks');
    const result = out.result as { tasks: unknown[]; nextPageToken?: string; task?: unknown };
    expect(result.task).toBeUndefined();
    expect(result.tasks).toHaveLength(1);
    expect(result.nextPageToken).toBe('nxt');
  });

  it('GetExtendedAgentCard answers instead of METHOD_NOT_FOUND', async () => {
    const { setAgentCardProvider } = await import('../../services/mcp-server/src/a2a/jsonrpc.js');
    setAgentCardProvider(() => ({ name: 'fixture-card' }));
    try {
      const res = await rpc('GetExtendedAgentCard', {});
      expect(res.error?.code, 'must not be METHOD_NOT_FOUND').not.toBe(A2A_ERR.METHOD_NOT_FOUND);
      expect(res.error).toBeUndefined();
    } finally {
      setAgentCardProvider(null);
    }
  });
});
