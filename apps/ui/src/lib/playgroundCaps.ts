import {
  MessageSquare,
  Image as ImageIcon,
  ListOrdered,
  AudioLines,
  ArrowLeftRight,
  ShieldCheck,
  Bot,
  Sparkles,
  Workflow,
  Network,
  FolderClock,
  Wrench,
  Activity,
  type LucideIcon,
} from 'lucide-react';

import type { PlaygroundMode } from '@/store/usePlaygroundStore';
import { CHAT_FAMILY_MODES } from '@/store/usePlaygroundStore';

/**
 * Platform panels are addressed by the same `mode` field as chat tabs but are
 * not completion modes — they drive admin/agent surfaces, not the router. They
 * therefore live outside PlaygroundMode rather than polluting it.
 */
export type PlatformPanel =
  | 'agents'
  | 'skills'
  | 'workflows'
  | 'routing'
  | 'context'
  | 'mcp'
  | 'observability';

export type CapabilityMode = PlaygroundMode | PlatformPanel;

export interface CapabilityTab {
  /** A PlaygroundMode for chat tabs, or a PlatformPanel for platform tabs. */
  mode: CapabilityMode;
  label: string;
  icon: LucideIcon;
  group: 'chat' | 'platform';
  /** One-line description shown as a tooltip / empty-state hint. */
  hint: string;
  /** Short list of the REST endpoints this tab exercises. */
  endpoints: string[];
}

const CHAT_TABS: CapabilityTab[] = [
  { mode: 'chat', label: 'Chat', icon: MessageSquare, group: 'chat', hint: 'Chat completions, images, TTS, embeddings, rerank, moderation.', endpoints: ['POST /v1/chat/completions'] },
  { mode: 'image', label: 'Image', icon: ImageIcon, group: 'chat', hint: 'Generate images via POST /v1/images/generations.', endpoints: ['POST /v1/images/generations'] },
  { mode: 'embed', label: 'Embed', icon: ListOrdered, group: 'chat', hint: 'Embeddings via POST /v1/embeddings.', endpoints: ['POST /v1/embeddings'] },
  { mode: 'tts', label: 'TTS', icon: AudioLines, group: 'chat', hint: 'Speech synthesis via POST /v1/audio/speech.', endpoints: ['POST /v1/audio/speech'] },
  { mode: 'rerank', label: 'Rerank', icon: ArrowLeftRight, group: 'chat', hint: 'Rerank documents via POST /v1/rerank.', endpoints: ['POST /v1/rerank'] },
  { mode: 'moderate', label: 'Moderate', icon: ShieldCheck, group: 'chat', hint: 'Moderation via POST /v1/moderations.', endpoints: ['POST /v1/moderations'] },
  { mode: 'agentic', label: 'Agentic', icon: Bot, group: 'chat', hint: 'Single-agentic run with tool use.', endpoints: ['POST /v1/chat/completions'] },
  { mode: 'tool-loop', label: 'Tool Loop', icon: Wrench, group: 'chat', hint: 'Multi-turn tool-loop execution.', endpoints: ['POST /v1/chat/completions'] },
  { mode: 'godmode', label: 'Godmode', icon: Sparkles, group: 'chat', hint: 'Godmode chat + server lifecycle modes.', endpoints: ['POST /v1/godmode/*'] },
];

const PLATFORM_TABS: CapabilityTab[] = [
  { mode: 'agents', label: 'Agents', icon: Bot, group: 'platform', hint: 'List, run, resume, schedule, create agents and browse the marketplace.', endpoints: ['GET /v1/agents', 'POST /v1/agents/:instanceId/chat'] },
  { mode: 'skills', label: 'Skills', icon: Sparkles, group: 'platform', hint: 'Search and inspect platform skills.', endpoints: ['GET /v1/skills'] },
  { mode: 'workflows', label: 'Workflows', icon: Workflow, group: 'platform', hint: 'Compose multi-step workflow definitions and execute them.', endpoints: ['POST /v1/workflows'] },
  { mode: 'routing', label: 'Routing', icon: Network, group: 'platform', hint: 'Pick a model and inspect the real routing decision + log.', endpoints: ['GET /v1/models', 'GET /v1/admin/routing/decisions'] },
  { mode: 'context', label: 'Context', icon: FolderClock, group: 'platform', hint: 'Save / load / search conversation handoff via DMR-X memory.', endpoints: ['POST /v1/admin/memory', 'POST /v1/admin/memory/search'] },
  { mode: 'mcp', label: 'MCP Tools', icon: Wrench, group: 'platform', hint: 'Read-only browser of MCP tools and direct execution.', endpoints: ['GET /v1/admin/mcp/tools', 'POST /v1/admin/mcp/tools/execute'] },
  { mode: 'observability', label: 'Observability', icon: Activity, group: 'platform', hint: 'Live cost ticker, routing log, and request stream.', endpoints: ['GET /v1/admin/routing/decisions'] },
];

export const CAPABILITY_TABS: CapabilityTab[] = [...CHAT_TABS, ...PLATFORM_TABS];

export const CAPABILITY_BY_MODE: Record<string, CapabilityTab> = Object.fromEntries(
  CAPABILITY_TABS.map((t) => [t.mode, t]),
);

export const CHAT_CAPABILITY_TABS = CHAT_TABS;
export const PLATFORM_CAPABILITY_TABS = PLATFORM_TABS;

export function isCapabilityChatMode(mode: PlaygroundMode): boolean {
  return CHAT_FAMILY_MODES.has(mode);
}
