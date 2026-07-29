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
  /** Authentication configuration (legacy 0.1.x field, kept for back-compat) */
  authentication?: AgentAuthentication;
  /** Default input modes (spec: media types, e.g. `text/plain`) */
  defaultInputModes?: string[];
  /** Default output modes (spec: media types, e.g. `text/plain`) */
  defaultOutputModes?: string[];
  /** Organization publishing this agent (spec 0.3.0 `provider`) */
  provider?: AgentProvider;
  /** Human-readable docs for this agent */
  documentationUrl?: string;
  /** Named security schemes, OpenAPI 3 style (spec 0.3.0) */
  securitySchemes?: Record<string, unknown>;
  /** Security requirements referencing `securitySchemes` (spec 0.3.0) */
  security?: Array<Record<string, string[]>>;
}

export interface AgentProvider {
  organization: string;
  url: string;
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
  /** Authentication configuration (legacy 0.1.x field; emitted only if configured) */
  authentication?: AgentAuthentication;
  /** Organization publishing this agent */
  provider?: AgentProvider;
  /** Human-readable docs for this agent */
  documentationUrl?: string;
  /** Named security schemes, OpenAPI 3 style (spec 0.3.0) */
  securitySchemes?: Record<string, unknown>;
  /** Security requirements referencing `securitySchemes` (spec 0.3.0) */
  security?: Array<Record<string, string[]>>;
  /** Whether an authenticated extended card is available (spec 0.3.0) */
  supportsAuthenticatedExtendedCard: boolean;
  /** Default input media types */
  defaultInputModes: string[];
  /** Default output media types */
  defaultOutputModes: string[];
  /** Agent skills */
  skills: AgentSkill[];
}

// ---------------------------------------------------------------------------
// Modality → media types
// ---------------------------------------------------------------------------

/**
 * `defaultInputModes` / `defaultOutputModes` / skill modes are MEDIA TYPES in
 * the spec. The card previously advertised the bare token `text`, which is not
 * a media type and which a conforming A2A client cannot match against any
 * content it holds.
 */
const TEXT = 'text/plain';

const MODALITY_OUTPUT_TYPES: Record<string, string[]> = {
  image: ['image/png'],
  video: ['video/mp4'],
  audio: ['audio/mpeg'],
  audio_tts: ['audio/mpeg'],
  music: ['audio/mpeg'],
  embedding: ['application/json'],
};

const MODALITY_INPUT_TYPES: Record<string, string[]> = {
  audio_stt: ['audio/mpeg', 'audio/wav'],
  transcribe: ['audio/mpeg', 'audio/wav'],
};

/** Best-effort modality from a DMR-X tool name (`dmrx_generate_image` → image). */
function inferModality(toolName: string): string {
  const n = toolName.toLowerCase();
  if (n.includes('image')) return 'image';
  if (n.includes('video')) return 'video';
  if (n.includes('music')) return 'music';
  if (n.includes('transcribe')) return 'audio_stt';
  if (n.includes('speak') || n.includes('tts')) return 'audio_tts';
  if (n.includes('embed')) return 'embedding';
  return 'general';
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
  const skills: AgentSkill[] = tools.map((tool) => {
    const modality = tool.modality || inferModality(tool.name);
    return {
      id: tool.name,
      name: tool.name,
      description: tool.description,
      inputModes: [TEXT, ...(MODALITY_INPUT_TYPES[modality] ?? [])],
      outputModes: MODALITY_OUTPUT_TYPES[modality] ?? [TEXT],
      // `tags` is required per spec; keep the modality and always include a
      // stable discovery tag so tag-filtering clients can find every skill.
      tags: modality === 'general' ? ['general', 'dmrx'] : [modality, 'dmrx'],
    };
  });

  // Union of every media type any skill accepts/produces — the defaults must be
  // a superset, otherwise a client that honours only the defaults would never
  // send audio to the transcription skill.
  const union = (pick: (s: AgentSkill) => string[] | undefined, fallback: string[]): string[] => {
    const set = new Set<string>(fallback);
    for (const s of skills) for (const m of pick(s) ?? []) set.add(m);
    return [...set];
  };

  const card: AgentCard = {
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
    supportsAuthenticatedExtendedCard: false,
    defaultInputModes: config.defaultInputModes || union((s) => s.inputModes, [TEXT]),
    defaultOutputModes: config.defaultOutputModes || union((s) => s.outputModes, [TEXT]),
    skills,
  };

  // Optional fields are omitted rather than emitted as `undefined`, so the
  // serialized card never carries keys a consumer must special-case.
  if (config.authentication) card.authentication = config.authentication;
  if (config.provider) card.provider = config.provider;
  if (config.documentationUrl) card.documentationUrl = config.documentationUrl;
  if (config.securitySchemes) card.securitySchemes = config.securitySchemes;
  if (config.security) card.security = config.security;

  return card;
}

/**
 * Validate an Agent Card against the required shape of the A2A spec.
 */
export function validateAgentCard(card: AgentCard): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!card.name) errors.push('Agent name is required');
  if (!card.description) errors.push('Agent description is required');
  if (!card.version) errors.push('Agent version is required');
  if (!card.url) errors.push('Agent URL is required');
  if (!card.protocolVersion) errors.push('protocolVersion is required');
  if (!card.preferredTransport) errors.push('preferredTransport is required');
  if (!card.capabilities || typeof card.capabilities !== 'object') {
    errors.push('capabilities is required');
  }
  if (!Array.isArray(card.defaultInputModes) || card.defaultInputModes.length === 0) {
    errors.push('defaultInputModes must be a non-empty array of media types');
  }
  if (!Array.isArray(card.defaultOutputModes) || card.defaultOutputModes.length === 0) {
    errors.push('defaultOutputModes must be a non-empty array of media types');
  }
  if (!card.skills || card.skills.length === 0) {
    errors.push('At least one skill is required');
  } else {
    const seen = new Set<string>();
    for (const skill of card.skills) {
      if (!skill.id) errors.push('Skill is missing an id');
      else if (seen.has(skill.id)) errors.push(`Duplicate skill id: ${skill.id}`);
      else seen.add(skill.id);
      if (!skill.name) errors.push(`Skill ${skill.id} is missing a name`);
      if (!skill.description) errors.push(`Skill ${skill.id} is missing a description`);
      if (!skill.tags || skill.tags.length === 0) {
        errors.push(`Skill ${skill.id} must declare at least one tag`);
      }
    }
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