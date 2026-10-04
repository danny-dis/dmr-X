/** A2A 1.0 protobuf-JSON boundary. The owner-aware legacy core stays shared. */
import { createHash } from 'node:crypto';
import type { JsonRpcRequest, JsonRpcResponse } from './jsonrpc.js';

export const V1_METHODS: Record<string, string> = {
  SendMessage: 'message/send',
  SendStreamingMessage: 'message/stream',
  SubscribeToTask: 'tasks/resubscribe',
  GetTask: 'tasks/get',
  // `CancelTask` is the genuine v1 method name (the Agent Card advertises a 1.0
  // interface). The legacy `tasks/cancel` spelling is preserved.
  CancelTask: 'tasks/cancel',
  // SDK 1.1.1 (`a2a/client/transports/jsonrpc.py`) sends these PascalCase
  // names; without a mapping each answered METHOD_NOT_FOUND over the 1.0
  // interface. Every target is a legacy spelling the core already speaks
  // (`tasks/pushNotificationConfig/list|delete` are new thin handlers over the
  // same single-config store — see jsonrpc.ts), so legacy callers are
  // unaffected.
  ListTasks: 'tasks/list',
  CreateTaskPushNotificationConfig: 'tasks/pushNotificationConfig/set',
  GetTaskPushNotificationConfig: 'tasks/pushNotificationConfig/get',
  ListTaskPushNotificationConfigs: 'tasks/pushNotificationConfig/list',
  DeleteTaskPushNotificationConfig: 'tasks/pushNotificationConfig/delete',
  GetExtendedAgentCard: 'agent/getExtendedCard',
};
/**
 * THE canonical internal-state -> A2A-1.0 `TaskState` enum map.
 *
 * Two copies of this table existed (this module and jsonrpc.ts), so the same
 * logical state serialized to a different enum string depending on which method
 * spelling handled the request — `unknown` became `TASK_STATE_UNKNOWN` on the
 * lowercase path and fell through to `TASK_STATE_UNSPECIFIED` here. Every writer
 * now reads this table; a state outside it serializes as `TASK_STATE_UNSPECIFIED`,
 * the protobuf default.
 */
export const V1_TASK_STATES: Record<string, string> = {
  submitted: 'TASK_STATE_SUBMITTED', working: 'TASK_STATE_WORKING', completed: 'TASK_STATE_COMPLETED',
  failed: 'TASK_STATE_FAILED', canceled: 'TASK_STATE_CANCELED', rejected: 'TASK_STATE_REJECTED',
  'input-required': 'TASK_STATE_INPUT_REQUIRED', 'auth-required': 'TASK_STATE_AUTH_REQUIRED',
  unknown: 'TASK_STATE_UNKNOWN',
};

function legacyPart(part: any): any {
  if (!part || typeof part !== 'object') return part;
  const payloads = ['text','raw','url','data'].filter(k=>part[k]!==undefined);
  if (payloads.length!==1) return {}; // the core validator rejects malformed oneofs
  if (part.text!==undefined) return {kind:'text',text:part.text,metadata:part.metadata};
  if (part.data!==undefined) return {kind:'data',data:part.data,metadata:part.metadata};
  return {kind:'file',file:{...(part.raw!==undefined?{bytes:part.raw}:{uri:part.url}),mimeType:part.mediaType,name:part.filename},metadata:part.metadata};
}

export function legacyV1Request(req: JsonRpcRequest): JsonRpcRequest {
  const p={...req.params};
  if(p.message){p.message={...p.message,role:p.message.role==='ROLE_USER'?'user':p.message.role==='ROLE_AGENT'?'agent':p.message.role,parts:Array.isArray(p.message.parts)?p.message.parts.map(legacyPart):p.message.parts};}
  if(p.configuration){p.configuration={...p.configuration,blocking:p.configuration.returnImmediately!==true,pushNotificationConfig:p.configuration.taskPushNotificationConfig};}
  const canonical = V1_METHODS[req.method!] || req.method;
  if (req.method === 'ListTasks') {
    // SDK protobuf-JSON: {tenant, contextId, status (TASK_STATE_*), pageSize,
    // pageToken, historyLength, statusTimestampAfter, includeArtifacts}.
    // Legacy core: {contextId, status (lowercase), pageSize, pageToken,
    // includeHistory (bool)}. historyLength>0 implies history; the timestamp
    // cursor has no legacy equivalent and is ignored (documented, not failed).
    const { tenant: _tenant, statusTimestampAfter: _cursor, historyLength, status, ...rest } = p;
    const legacy: Record<string, unknown> = { ...rest };
    if (status !== undefined) legacy.status = v1StatusToLegacy(status);
    if (historyLength !== undefined) legacy.includeHistory = Number(historyLength) > 0;
    return { ...req, method: canonical, params: legacy };
  }
  if (req.method === 'CreateTaskPushNotificationConfig') {
    // SDK flat: {tenant, taskId, id, url, token, authentication}.
    // Legacy core: {taskId, id, pushNotificationConfig: {url, token,
    // authentication}}. The id rides alongside so the V1 response can echo it.
    const { tenant: _tenant, taskId, id, url, token, authentication, pushNotificationConfig } = p;
    if (pushNotificationConfig !== undefined) {
      return { ...req, method: canonical, params: { taskId, id, pushNotificationConfig } };
    }
    return {
      ...req,
      method: canonical,
      params: {
        taskId,
        ...(id !== undefined ? { id } : {}),
        pushNotificationConfig: {
          url,
          ...(token !== undefined ? { token } : {}),
          ...(authentication !== undefined ? { authentication } : {}),
        },
      },
    };
  }
  if (
    req.method === 'GetTaskPushNotificationConfig' ||
    req.method === 'ListTaskPushNotificationConfigs' ||
    req.method === 'DeleteTaskPushNotificationConfig'
  ) {
    // Flat SDK ids pass through; the core keys everything off taskId.
    const { tenant: _tenant, ...rest } = p;
    return { ...req, method: canonical, params: rest };
  }
  if (req.method === 'GetExtendedAgentCard') {
    const { tenant: _tenant, ...rest } = p;
    return { ...req, method: canonical, params: rest };
  }
  if (req.method === 'GetTask' || req.method === 'CancelTask' || req.method === 'SubscribeToTask') {
    const { tenant: _tenant, ...rest } = p;
    return { ...req, method: canonical, params: rest };
  }
  return {...req,method:V1_METHODS[req.method!]||req.method,params:p};
}

/** Reverse of V1_TASK_STATES for the ListTasks status filter. Unknown values pass through. */
function v1StatusToLegacy(status: unknown): unknown {
  if (typeof status !== 'string') return status;
  for (const [legacy, v1] of Object.entries(V1_TASK_STATES)) {
    if (v1 === status) return legacy;
  }
  return status;
}

function wirePart(part:any):any {
  if(part.kind==='text')return {text:part.text,...(part.metadata?{metadata:part.metadata}:{})};
  if(part.kind==='data')return {data:part.data,...(part.metadata?{metadata:part.metadata}:{})};
  const f=part.file||{};
  return {...(f.bytes!==undefined?{raw:f.bytes}:{url:f.uri}),...(f.mimeType?{mediaType:f.mimeType}:{}),...(f.name?{filename:f.name}:{}),...(part.metadata?{metadata:part.metadata}:{})};
}
function wireMessage(m:any):any {
  return {messageId:m.messageId,contextId:m.contextId,taskId:m.taskId,role:m.role==='user'?'ROLE_USER':'ROLE_AGENT',parts:m.parts.map(wirePart),...(m.metadata?{metadata:m.metadata}:{}),...(m.extensions?{extensions:m.extensions}:{}),...(m.referenceTaskIds?{referenceTaskIds:m.referenceTaskIds}:{})};
}
export function wireStatus(s:any):any {
  return {state:V1_TASK_STATES[s.state]||'TASK_STATE_UNSPECIFIED',timestamp:s.timestamp,...(s.message?{message:wireMessage(s.message)}:{})};
}
export function wireArtifact(a:any):any {
  return {artifactId:a.artifactId,name:a.name,description:a.description,parts:a.parts.map(wirePart),...(a.metadata?{metadata:a.metadata}:{}),...(a.extensions?{extensions:a.extensions}:{})};
}
export function wireTask(t:any):any {
  return {id:t.id,contextId:t.contextId,status:wireStatus(t.status),artifacts:(t.artifacts||[]).map(wireArtifact),history:(t.history||[]).map(wireMessage),...(t.metadata?{metadata:t.metadata}:{})};
}
export function wireV1Response(response:JsonRpcResponse,method:string):JsonRpcResponse {
  if (response.error)return response;
  // ListTasks returns a COLLECTION envelope, not a single task: the old code
  // ran it through `wireTask` (which reads .id/.status off the envelope) and
  // handed the SDK an unparseable object. Each task is wired individually and
  // the pagination envelope is preserved with the SDK's pageSize/totalSize.
  if (method === 'ListTasks') {
    const result = response.result as { tasks?: unknown[]; nextPageToken?: string };
    const tasks = Array.isArray(result?.tasks) ? result.tasks.map((t) => wireTask(t)) : [];
    return {
      ...response,
      result: {
        tasks,
        ...(result?.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
        pageSize: tasks.length,
        totalSize: tasks.length,
      },
    };
  }
  // The SDK's TaskPushNotificationConfig is FLAT ({taskId, id, url, ...});
  // the core answers {taskId, pushNotificationConfig: {url, ...}}. Without
  // flattening, `ParseDict(result, TaskPushNotificationConfig())` produced a
  // config with an empty url. Only actually observed shapes are mapped.
  if (method === 'CreateTaskPushNotificationConfig' || method === 'GetTaskPushNotificationConfig') {
    return { ...response, result: wirePushConfig(response.result) };
  }
  if (method === 'ListTaskPushNotificationConfigs') {
    const result = response.result as { configs?: unknown[]; nextPageToken?: string; taskId?: string };
    const configs = Array.isArray(result?.configs) ? result.configs.map((c) => wirePushConfig(c)) : [];
    return {
      ...response,
      result: {
        configs,
        ...(result?.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
      },
    };
  }
  if (method === 'DeleteTaskPushNotificationConfig') {
    // The SDK ignores the delete result (checks the error only); answer empty.
    return { ...response, result: {} };
  }
  if (method === 'GetExtendedAgentCard') return response;
  const task=wireTask(response.result);
  // SendMessage returns the task/message oneof. GetTask and CancelTask
  // return a bare Task, as consumed by the official A2A 1.0 SDK.
  return {...response,result:method==='SendMessage'?{task}:task};
}

/** Flatten a core {taskId, id?, pushNotificationConfig: {url,...}} into SDK shape. */
function wirePushConfig(result: unknown): unknown {
  const raw = result as {
    taskId?: string;
    id?: string;
    url?: string;
    token?: string;
    authentication?: unknown;
    pushNotificationConfig?: { url?: string; token?: string; authentication?: unknown };
  };
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.pushNotificationConfig !== undefined) {
    const nested = raw.pushNotificationConfig ?? {};
    return {
      ...(raw.taskId !== undefined ? { taskId: raw.taskId } : {}),
      ...(raw.id !== undefined ? { id: raw.id } : {}),
      ...(nested.url !== undefined ? { url: nested.url } : {}),
      ...(nested.token !== undefined ? { token: nested.token } : {}),
      ...(nested.authentication !== undefined ? { authentication: nested.authentication } : {}),
    };
  }
  return raw;
}

export function wireV1StreamResponses(response: JsonRpcResponse, seenArtifacts: Map<string, string>): JsonRpcResponse[] {
  if (response.error) return [response];
  const payload = response.result as any;
  if (payload?.kind === 'task') {
    const task = wireTask(payload);
    for (const artifact of task.artifacts) seenArtifacts.set(artifact.artifactId, createHash('sha256').update(JSON.stringify(artifact)).digest('hex'));
    return [{ ...response, result: { task } }];
  }
  if (payload?.kind === 'status-update') {
    const result: JsonRpcResponse[] = [];
    for (const legacy of payload.artifacts ?? []) {
      const artifact = wireArtifact(legacy);
      const hash = createHash('sha256').update(JSON.stringify(artifact)).digest('hex');
      if (seenArtifacts.get(artifact.artifactId) === hash) continue;
      seenArtifacts.set(artifact.artifactId, hash);
      result.push({ ...response, result: { artifactUpdate: { taskId: payload.taskId, contextId: payload.contextId, artifact } } });
    }
    result.push({ ...response, result: { statusUpdate: { taskId: payload.taskId, contextId: payload.contextId, status: wireStatus(payload.status), ...(payload.metadata ? { metadata: payload.metadata } : {}) } } });
    return result;
  }
  return [response];
}
