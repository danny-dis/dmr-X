/**
 * Agent Card for A2A Protocol
 * 
 * Implements the Agent Card specification for agent discovery
 * and capability advertisement in multi-agent systems.
 * 
 * Based on Google's A2A protocol specification.
 */

import { createLogger } from '@dmr-x/utils';

const logger = createLogger('mcp-server:a2a:agent-card');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentCardConfig {
  /** Enable A2A protocol */
  enabled?: boolean;
  /** Agent name */
  name?: string;
  /** Agent description */
  description?: string;
  /** Agent version */
  version?: string;
  /** Agent URL for A2A communication */
  url?: string;
  /** Supported capabilities */
  capabilities?: AgentCapabilities;
  /** Authentication configuration */
  authentication?: AgentAuthentication;
  /** Default input modes */
  defaultInputModes?: string[];
  /** Default output modes */
  defaultOutputModes?: string[];
}

export interface AgentCapabilities {
  /** Supports streaming */
  streaming?: boolean;
  /** Supports push notifications */
  pushNotifications?: boolean;
  /** Supports state transition history */
  stateTransitionHistory?: boolean;
}

export interface AgentAuthentication {
  /** Authentication schemes supported */
  schemes?: string[];
  /** OAuth configuration */
  oauth?: {
    issuer: string;
    authorizationUrl: string;
    tokenUrl: string;
    scopes?: string[];
  };
}

export interface AgentSkill {
  /** Skill ID */
  id: string;
  /** Skill name */
  name: string;
  /** Skill description */
  description: string;
  /** Input modes supported */
  inputModes?: string[];
  /** Output modes supported */
  outputModes?: string[];
  /** Skill tags for discovery */
  tags?: string[];
}

export interface AgentCard {
  /** A2A protocol version this agent speaks (spec current: 0.3.0). */
  protocolVersion: string;
  /** Agent name */
  name: string;
  /** Agent description */
  description: string;
  /** Agent version */
  version: string;
  /** Agent URL */
  url: string;
  /** Preferred transport for the primary url (spec: JSONRPC | GRPC | HTTP+JSON). */
  preferredTransport: string;
  /** Supported capabilities */
  capabilities: AgentCapabilities;
  /** Authentication configuration */
  authentication?: AgentAuthentication;
  /** Default input modes */
  defaultInputModes: string[];
  /** Default output modes */
  defaultOutputModes: string[];
  /** Agent skills */
  skills: AgentSkill[];
}

// ---------------------------------------------------------------------------
// Agent Card Builder
// ---------------------------------------------------------------------------

/**
 * Build an Agent Card from configuration and available tools
 */
export function buildAgentCard(
  config: AgentCardConfig,
  tools: Array<{ name: string; description: string; modality?: string }>
): AgentCard {
  const skills: AgentSkill[] = tools.map((tool) => ({
    id: tool.name,
    name: tool.name,
    description: tool.description,
    inputModes: ['text'],
    outputModes: ['text'],
    tags: [tool.modality || 'general'],
  }));

  return {
    protocolVersion: '0.3.0',
    name: config.name || 'DMR-X Agent',
    description: config.description || 'DMR-X MCP Server with intelligent routing',
    version: config.version || '0.5.0',
    url: config.url || 'http://localhost:3100',
    preferredTransport: 'JSONRPC',
    capabilities: config.capabilities || {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    authentication: config.authentication,
    defaultInputModes: config.defaultInputModes || ['text'],
    defaultOutputModes: config.defaultOutputModes || ['text'],
    skills,
  };
}

/**
 * Validate an Agent Card
 */
export function validateAgentCard(card: AgentCard): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!card.name) errors.push('Agent name is required');
  if (!card.version) errors.push('Agent version is required');
  if (!card.url) errors.push('Agent URL is required');
  if (!card.protocolVersion) errors.push('protocolVersion is required');
  if (!card.skills || card.skills.length === 0) {
    errors.push('At least one skill is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Serialize Agent Card to JSON
 */
export function serializeAgentCard(card: AgentCard): string {
  return JSON.stringify(card, null, 2);
}

/**
 * Deserialize Agent Card from JSON
 */
export function deserializeAgentCard(json: string): AgentCard | null {
  try {
    const card = JSON.parse(json) as AgentCard;
    const validation = validateAgentCard(card);
    if (!validation.valid) {
      logger.error({ errors: validation.errors }, 'Invalid Agent Card');
      return null;
    }
    return card;
  } catch (error) {
    logger.error({ error }, 'Failed to deserialize Agent Card');
    return null;
  }
}