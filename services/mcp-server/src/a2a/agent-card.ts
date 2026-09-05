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
  /** Extra interfaces to advertise beyond the derived primary one (spec v1.0). */
  additionalInterfaces?: AgentInterface[];
  /** Protocol binding for the primary interface. Default `JSONRPC`. */
  protocolBinding?: string;
  /** Tenant routing id for the primary interface (spec v1.0). */
  tenant?: string;
  /** URL to an icon for this agent (spec v1.0 `icon_url`). */
  iconUrl?: string;
}

export interface AgentProvider {
  organization: string;
  url: string;
}

/**
 * One addressable endpoint for this agent (A2A spec v1.0 `AgentInterface`).
 *
 * v1.0 replaces the 0.3.0 flat `url` + `preferredTransport` pair with an
 * ordered list of these; the first entry is the preferred one. Note that
 * `protocolVersion` here is MAJOR.MINOR ("1.0", "0.3") per the spec's own
 * examples — NOT the full patch version "1.0.1".
 */
export interface AgentInterface {
  /** Absolute URL for this interface. HTTPS required in production. */
  url: string;
  /** Protocol binding: `JSONRPC` | `GRPC` | `HTTP+JSON` (open-form string). */
  protocolBinding: string;
  /** Opaque tenant routing id. Clients MUST echo it when set. */
  tenant?: string;
  /** A2A version this interface speaks, major.minor (e.g. "1.0"). */
  protocolVersion: string;
}

/** JWS signature over the Agent Card (spec v1.0 `AgentCardSignature`). */
export interface AgentCardSignature {
  /** base64url-encoded protected JWS header. */
  protected: string;
  /** base64url-encoded signature. */
  signature: string;
  /** Unprotected JWS header values. */
  header?: Record<string, unknown>;
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
  /**
   * Ordered interfaces, preferred first (spec v1.0, REQUIRED there).
   * Emitted ALONGSIDE the legacy flat `url`/`preferredTransport` so 0.3.0
   * consumers keep working.
   */
  supportedInterfaces: AgentInterface[];
  /** Optional icon (spec v1.0). */
  iconUrl?: string;
  /** JWS signatures over this card (spec v1.0). */
  signatures?: AgentCardSignature[];
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

/**
 * A2A version advertised per-interface. MAJOR.MINOR only — the spec's own
 * examples are "0.3" and "1.0", so the patch component of the v1.0.1 release
 * tag must NOT appear here.
 */
const A2A_INTERFACE_VERSION = '1.0';

/**
 * Legacy top-level `protocolVersion`. Retained at 0.3.0 so existing 0.3.0
 * consumers still match; v1.0 clients read `supportedInterfaces` instead.
 */
const A2A_LEGACY_CARD_VERSION = '0.3.0';

/** Accepts exactly MAJOR.MINOR, e.g. "1.0" / "0.3". Rejects "1.0.1". */
const MAJOR_MINOR = /^\d+\.\d+$/;

/**
 * Path where the A2A JSON-RPC handler is mounted (see a2a/handler.ts).
 * The Agent Card must advertise THIS, not the server root — clients POST
 * directly at `supportedInterfaces[].url`.
 */
const A2A_RPC_PATH = '/a2a';

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

  const resolvedUrl = config.url || 'http://localhost:47114';
  const protocolBinding = config.protocolBinding || 'JSONRPC';

  // The interface url MUST be the JSON-RPC ENDPOINT, not the server root.
  // Spec: AgentInterface.url is "the URL where this interface is available" —
  // an A2A client POSTs its JSON-RPC envelope straight at it. DMR-X mounts the
  // RPC handler at `/a2a`, so advertising the bare origin made every compliant
  // client (verified against Hermes' own a2a plugin, which reads
  // supportedInterfaces[].url) POST to `/` and get a 404.
  // Appended only when the configured url has no path, so an operator who sets
  // DMRX_A2A_AGENT_URL=https://host/custom/a2a keeps full control.
  const rpcUrl = /^https?:\/\/[^/]+\/?$/.test(resolvedUrl)
    ? resolvedUrl.replace(/\/$/, '') + A2A_RPC_PATH
    : resolvedUrl;
  const primaryInterface: AgentInterface = {
    url: rpcUrl,
    protocolBinding,
    protocolVersion: A2A_INTERFACE_VERSION,
  };
  // Only emit `tenant` when set — an explicit `undefined` key would force
  // every consumer to special-case it.
  if (config.tenant) primaryInterface.tenant = config.tenant;

  const card: AgentCard = {
    protocolVersion: A2A_LEGACY_CARD_VERSION,
    name: config.name || 'DMR-X Agent',
    description: config.description || 'DMR-X MCP Server with intelligent routing',
    version: config.version || '0.5.0',
    // The legacy 0.3.0 flat `url` stays as the bare origin — legacy consumers
    // treat it as the base, while only the v1.0 interface carries the RPC path.
    url: resolvedUrl,
    preferredTransport: protocolBinding,
    capabilities: config.capabilities || {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    supportsAuthenticatedExtendedCard: false,
    defaultInputModes: config.defaultInputModes || union((s) => s.inputModes, [TEXT]),
    defaultOutputModes: config.defaultOutputModes || union((s) => s.outputModes, [TEXT]),
    skills,
    supportedInterfaces: [primaryInterface, ...(config.additionalInterfaces ?? [])],
  };

  // Optional fields are omitted rather than emitted as `undefined`, so the
  // serialized card never carries keys a consumer must special-case.
  if (config.authentication) card.authentication = config.authentication;
  if (config.provider) card.provider = config.provider;
  if (config.documentationUrl) card.documentationUrl = config.documentationUrl;
  if (config.securitySchemes) card.securitySchemes = config.securitySchemes;
  if (config.security) card.security = config.security;
  if (config.iconUrl) card.iconUrl = config.iconUrl;

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
  if (!Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length === 0) {
    errors.push('supportedInterfaces must be a non-empty array (A2A v1.0)');
  } else {
    card.supportedInterfaces.forEach((iface, i) => {
      if (!iface?.url) errors.push(`supportedInterfaces[${i}] is missing url`);
      if (!iface?.protocolBinding) {
        errors.push(`supportedInterfaces[${i}] is missing protocolBinding`);
      }
      if (!iface?.protocolVersion) {
        errors.push(`supportedInterfaces[${i}] is missing protocolVersion`);
      } else if (!MAJOR_MINOR.test(iface.protocolVersion)) {
        errors.push(
          `supportedInterfaces[${i}].protocolVersion must be major.minor (e.g. "1.0"), got "${iface.protocolVersion}"`,
        );
      }
    });
  }
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