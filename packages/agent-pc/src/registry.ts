import { AgentPC } from './agent-pc.js';
import type { CreateAgentPCOptions, AgentPCInfo } from './types.js';

/**
 * AgentPC Registry — manages multiple agent personal computers.
 *
 * This is the "operating system" for your agent fleet. Spawn agents,
 * monitor them, shut them down. All state is in-memory — if you need
 * persistence, serialize the info objects.
 */
export class AgentPCRegistry {
  private agents = new Map<string, AgentPC>();

  /**
   * Create and start a new agent PC.
   */
  async spawn(options: CreateAgentPCOptions): Promise<AgentPC> {
    if (this.agents.has(options.agentId)) {
      throw new Error(`Agent '${options.agentId}' already exists. Stop it first.`);
    }

    const pc = new AgentPC(options);
    await pc.init();
    await pc.start();

    this.agents.set(options.agentId, pc);
    return pc;
  }

  /**
   * Stop and remove an agent PC.
   */
  async stop(agentId: string): Promise<void> {
    const pc = this.agents.get(agentId);
    if (!pc) {
      throw new Error(`Agent '${agentId}' not found`);
    }

    await pc.stop();
    this.agents.delete(agentId);
  }

  /**
   * Get an agent PC by ID.
   */
  get(agentId: string): AgentPC | undefined {
    return this.agents.get(agentId);
  }

  /**
   * List all agent PCs.
   */
  list(): AgentPCInfo[] {
    return Array.from(this.agents.values()).map(pc => pc.getInfo());
  }

  /**
   * Stop all agents.
   */
  async stopAll(): Promise<void> {
    const stops = Array.from(this.agents.entries()).map(async ([id, pc]) => {
      await pc.stop();
      this.agents.delete(id);
    });
    await Promise.all(stops);
  }

  /**
   * Get count of running agents.
   */
  get runningCount(): number {
    return Array.from(this.agents.values()).filter(pc => pc.state === 'running').length;
  }
}
