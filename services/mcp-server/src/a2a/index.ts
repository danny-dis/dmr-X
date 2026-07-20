/**
 * A2A (Agent-to-Agent) Protocol Module
 *
 * Implements Google's A2A protocol (current spec) for agent discovery and
 * inter-agent communication over JSON-RPC 2.0.
 *
 * Features:
 * - Agent Card for capability advertisement (/.well-known/agent-card.json)
 * - JSON-RPC 2.0 methods: message/send, message/stream, tasks/get,
 *   tasks/cancel, tasks/resubscribe, tasks/pushNotificationConfig/{set,get}
 * - SSE streaming transport
 * - In-memory task store
 */

export {
  buildAgentCard,
  validateAgentCard,
  serializeAgentCard,
  deserializeAgentCard,
  type AgentCardConfig,
  type AgentCapabilities,
  type AgentAuthentication,
  type AgentSkill,
  type AgentCard,
} from './agent-card.js';

export {
  A2ATaskManager,
  getTaskManager,
  resetTaskManager,
  isTerminal,
  textMessage,
  messageText,
  newMessageId,
  type TaskState,
  type TaskMessage,
  type TaskPart,
  type Task,
  type TaskStatus,
  type TaskArtifact,
  type PushNotificationConfig,
} from './task-manager.js';

export {
  handleRpc,
  handleRpcStream,
  isStreamMethod,
  rpcResult,
  rpcError,
  A2A_ERR,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type StreamSink,
} from './jsonrpc.js';

export { dispatchTask } from './dispatch.js';

export {
  initPersistence,
  closePersistence,
} from './persistence.js';

export {
  handleA2ARoutes,
  type A2AHandlerConfig,
} from './handler.js';
