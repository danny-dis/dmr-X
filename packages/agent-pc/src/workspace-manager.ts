import { mkdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Workspace Manager — per-agent isolated filesystem.
 *
 * One directory per agent. No git worktree overhead — just a plain folder
 * the agent can write to.
 */
export class WorkspaceManager {
  constructor(private baseDir: string) {}

  /**
   * Create workspace directory for an agent.
   */
  async createWorkspace(agentId: string): Promise<string> {
    const workspacePath = resolve(this.baseDir, `agent-${agentId}`);
    await mkdir(workspacePath, { recursive: true });
    return workspacePath;
  }

  /**
   * Check if a workspace exists.
   */
  async workspaceExists(agentId: string): Promise<boolean> {
    const workspacePath = resolve(this.baseDir, `agent-${agentId}`);
    try {
      await access(workspacePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get workspace path for an agent (without creating it).
   */
  getWorkspacePath(agentId: string): string {
    return resolve(this.baseDir, `agent-${agentId}`);
  }

  /**
   * Get the base workspace directory.
   */
  getBaseDir(): string {
    return this.baseDir;
  }
}
