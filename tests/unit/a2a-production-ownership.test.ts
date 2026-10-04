import { createServer, request as httpRequest, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleA2ARoutes } from '../../services/mcp-server/src/a2a/handler.js';
import { handleRpc } from '../../services/mcp-server/src/a2a/jsonrpc.js';
import {
  closePersistence,
  initPersistence,
} from '../../services/mcp-server/src/a2a/persistence.js';
import { resetTaskManager } from '../../services/mcp-server/src/a2a/task-manager.js';

const ownerA = {
  authorization: 'Bearer production-owner-a',
  'x-dmr-tenant-key': 'fixture-gateway-key-a',
};
const ownerB = {
  authorization: 'Bearer production-owner-b',
  'x-dmr-tenant-key': 'fixture-gateway-key-b',
};
const taskId = 'production-owned-task';
const contextId = 'production-owned-context';
let gateway: Server;
let gatewayBodies: Array<Record<string, unknown>>;
let tempDir: string;
const originalGatewayUrl = process.env.DMRX_GATEWAY_URL;

function rpc(method: string, params: unknown, headers = ownerA) {
  return handleRpc({ jsonrpc: '2.0', id: 1, method, params }, headers);
}

async function startGateway() {
  gatewayBodies = [];
  gateway = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      gatewayBodies.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: 'fixture-result' }));
    });
  });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  process.env.DMRX_GATEWAY_URL = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
}

async function createOwnedTask() {
  const response = await rpc('message/send', {
    message: {
      role: 'user',
      parts: [{ kind: 'text', text: 'owner A secret prompt' }],
      messageId: 'owner-a-message',
      taskId,
      contextId,
    },
  });
  expect(response.error).toBeUndefined();
  return response.result as { id: string; metadata?: Record<string, unknown> };
}

beforeEach(async () => {
  closePersistence();
  resetTaskManager();
  tempDir = mkdtempSync(join(tmpdir(), 'dmrx-a2a-owner-'));
  initPersistence({ dbPath: join(tempDir, 'a2a.sqlite'), pushEnabled: false });
  // initPersistence uses a lazy runtime import. Give the isolated sqlite handle
  // time to open before constructing the task manager under test.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await startGateway();
});

afterEach(async () => {
  process.env.DMRX_GATEWAY_URL = originalGatewayUrl;
  closePersistence();
  resetTaskManager();
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
  gateway.closeAllConnections();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('A2A production principal ownership', () => {
  it('isolates get, list, context continuation, cancel and push config by bearer identity', async () => {
    const task = await createOwnedTask();
    expect(task.metadata).not.toHaveProperty('owner');
    expect(JSON.stringify(task)).not.toContain('production-owner-a');

    const deniedGet = await rpc('tasks/get', { id: taskId }, ownerB);
    expect(deniedGet.error?.code).toBe(-32001);

    const deniedList = await rpc('tasks/list', {}, ownerB);
    expect(deniedList.result).toEqual({ tasks: [] });

    const deniedContext = await rpc('message/send', {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: 'steal context' }],
        messageId: 'owner-b-message',
        contextId,
      },
    }, ownerB);
    expect(deniedContext.error?.code).toBe(-32001);
    expect(gatewayBodies).toHaveLength(1);

    const deniedCancel = await rpc('tasks/cancel', { id: taskId }, ownerB);
    expect(deniedCancel.error?.code).toBe(-32001);

    const deniedPush = await rpc('tasks/pushNotificationConfig/set', {
      taskId,
      pushNotificationConfig: { url: 'https://example.com/hook' },
    }, ownerB);
    expect(deniedPush.error?.code).toBe(-32001);

    const allowedGet = await rpc('tasks/get', { id: taskId }, ownerA);
    expect((allowedGet.result as { id: string }).id).toBe(taskId);
  });

  it('keeps immutable ownership across sqlite reload and treats tenant key only as a binding', async () => {
    const boundA = {
      authorization: 'Bearer production-owner-a',
      'x-dmr-tenant-key': 'binding-a',
    };
    const created = await rpc('message/send', {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: 'bound task' }],
        messageId: 'bound-message',
        taskId: 'bound-task',
      },
    }, boundA);
    expect(created.error).toBeUndefined();

    resetTaskManager();

    expect((await rpc('tasks/get', { id: 'bound-task' }, boundA)).error).toBeUndefined();
    expect((await rpc('tasks/get', { id: 'bound-task' }, {
      authorization: 'Bearer production-owner-a',
      'x-dmr-tenant-key': 'binding-b',
    })).error?.code).toBe(-32001);
    expect((await rpc('tasks/get', { id: 'bound-task' }, {
      authorization: 'Bearer production-owner-b',
      'x-dmr-tenant-key': 'binding-a',
    })).error?.code).toBe(-32001);
  });

  it('applies the same owner checks to legacy REST listing and get', async () => {
    await createOwnedTask();
    const server = createServer((req, res) => {
      void handleA2ARoutes(req, res, { enabled: true }).then((handled) => {
        if (!handled && !res.writableEnded) res.writeHead(404).end();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;

    const fetchJson = (path: string) => new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = httpRequest({ hostname: '127.0.0.1', port, path, headers: ownerB }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          body: JSON.parse(Buffer.concat(chunks).toString()),
        }));
      });
      req.on('error', reject);
      req.end();
    });

    expect(await fetchJson(`/a2a/tasks/${taskId}`)).toMatchObject({ status: 404 });
    expect(await fetchJson('/a2a/tasks')).toMatchObject({
      status: 200,
      body: { tasks: [], total: 0, retained: 0 },
    });

    await new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
  });
});
