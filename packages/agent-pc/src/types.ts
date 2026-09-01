import { z } from 'zod';

/**
 * AgentPC configuration — what a single agent's "personal computer" looks like.
 */
export const AgentPCConfigSchema = z.object({
  /** Unique agent identifier */
  agentId: z.string().min(1),
  /** Human-readable name */
  name: z.string().default(''),
  /** Absolute path to the workspace root directory */
  workspaceRoot: z.string().min(1),
  /** Absolute path to the browser profile directory */
  browserProfileDir: z.string().min(1),
  /** Agent process entry point (script to run) */
  entryPoint: z.string().min(1),
  /** Environment variables for the agent process */
  env: z.record(z.string()).optional(),
  /** Resource limits */
  limits: z.object({
    maxMemoryMb: z.number().positive().optional(),
    maxCpuPercent: z.number().positive().optional(),
  }).optional(),
  /** Whether to auto-clean workspace on stop */
  autoClean: z.boolean().default(false),
});

export type AgentPCConfig = z.infer<typeof AgentPCConfigSchema>;

/**
 * AgentPC state — runtime status of an agent's personal computer.
 */
export type AgentPCState = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

/**
 * AgentPC info — serializable snapshot for listing/monitoring.
 */
export interface AgentPCInfo {
  agentId: string;
  name: string;
  state: AgentPCState;
  workspaceRoot: string;
  browserProfileDir: string;
  pid: number | null;
  startedAt: Date | null;
  uptimeMs: number | null;
  error?: string;
}

/**
 * Options for creating an AgentPC.
 */
export interface CreateAgentPCOptions {
  agentId: string;
  name?: string;
  /** Base directory for all agent workspaces (one subdir per agent) */
  baseWorkspaceDir: string;
  /** Base directory for all browser profiles (one subdir per agent) */
  baseBrowserProfileDir: string;
  /** Agent process entry point */
  entryPoint: string;
  env?: Record<string, string>;
  limits?: {
    maxMemoryMb?: number;
    maxCpuPercent?: number;
  };
  autoClean?: boolean;
}

/**
 * Browser instance handle — wraps Playwright persistentContext.
 */
export interface BrowserHandle {
  /** Close the browser and release resources */
  close(): Promise<void>;
  /** Get the CDP endpoint for connecting other tools */
  getCdpEndpoint(): string | null;
}
