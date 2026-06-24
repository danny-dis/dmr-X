/**
 * A2A (Agent-to-Agent) Protocol Module
 * 
 * Implements Google's A2A protocol for agent discovery
 * and inter-agent communication.
 * 
 * Features:
 * - Agent Card for capability advertisement
 * - Task management for agent-to-agent tasks
 * - HTTP endpoints for A2A protocol
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
  type TaskState,
  type TaskMessage,
  type TaskPart,
  type Task,
  type TaskStatus,
  type TaskArtifact,
  type TaskCreateRequest,
  type TaskGetRequest,
  type TaskUpdateRequest,
  type TaskCancelRequest,
} from './task-manager.js';

export {
  handleA2ARoutes,
  type A2AHandlerConfig,
} from './handler.js';