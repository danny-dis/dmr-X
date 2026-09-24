/**
 * Agent Lifecycle Manager — Issue #15 P1 Agent Runtime.
 *
 * Formal state machine for agent sessions: spawned → active → idle →
 * terminated. Supports ephemeral agents with TTL/budget guards, checkpoint/
 * resume, and portable state.
 */

export type AgentLifecycleState =
  | 'spawned'
  | 'active'
  | 'idle'
  | 'suspended'
  | 'terminating'
  | 'terminated'
  | 'failed';

export interface AgentLifecycleConfig {
  maxTtlMs: number;
  idleTimeoutMs: number;
  maxBudgetCents: number;
  checkpointOnIdle: boolean;
  resumeOnReactivate: boolean;
}

export const DEFAULT_LIFECYCLE_CONFIG: AgentLifecycleConfig = {
  maxTtlMs: 30 * 60 * 1000,      // 30 min
  idleTimeoutMs: 5 * 60 * 1000,   // 5 min
  maxBudgetCents: 100,             // $1 default
  checkpointOnIdle: true,
  resumeOnReactivate: true,
};

export interface AgentLifecycle {
  sessionId: string;
  state: AgentLifecycleState;
  createdAt: number;
  lastActivityAt: number;
  budgetConsumedCents: number;
  config: AgentLifecycleConfig;
  checkpoint?: {
    takenAt: number;
    stateSnapshot: unknown;
  };
}

export type LifecycleTransition = {
  [S in AgentLifecycleState]?: AgentLifecycleState[];
};

export const ALLOWED_TRANSITIONS: LifecycleTransition = {
  spawned: ['active', 'failed'],
  active: ['idle', 'suspended', 'terminating', 'failed'],
  idle: ['active', 'suspended', 'terminating'],
  suspended: ['active', 'terminating'],
  terminating: ['terminated'],
};

export function canTransition(from: AgentLifecycleState, to: AgentLifecycleState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export class AgentLifecycleManager {
  private agents = new Map<string, AgentLifecycle>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  spawn(sessionId: string, config: Partial<AgentLifecycleConfig> = {}): AgentLifecycle {
    const lifecycle: AgentLifecycle = {
      sessionId,
      state: 'spawned',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      budgetConsumedCents: 0,
      config: { ...DEFAULT_LIFECYCLE_CONFIG, ...config },
    };
    this.agents.set(sessionId, lifecycle);
    this.scheduleExpiry(sessionId);
    return lifecycle;
  }

  transition(sessionId: string, to: AgentLifecycleState): boolean {
    const agent = this.agents.get(sessionId);
    if (!agent) return false;
    if (!canTransition(agent.state, to)) return false;

    agent.state = to;
    agent.lastActivityAt = Date.now();

    if (to === 'idle' && agent.config.checkpointOnIdle) {
      this.checkpointInternal(agent);
    }
    if (to === 'active' && agent.config.resumeOnReactivate && agent.checkpoint) {
      // resume path — state restored by caller
    }
    if (to === 'terminated' || to === 'failed') {
      this.clearTimer(sessionId);
    }
    return true;
  }

  recordActivity(sessionId: string, costCents = 0): void {
    const agent = this.agents.get(sessionId);
    if (!agent) return;
    agent.lastActivityAt = Date.now();
    agent.budgetConsumedCents += costCents;

    if (agent.budgetConsumedCents >= agent.config.maxBudgetCents) {
      this.transition(sessionId, 'terminating');
      return;
    }
    this.scheduleExpiry(sessionId);
  }

  get(sessionId: string): AgentLifecycle | undefined {
    return this.agents.get(sessionId);
  }

  isExpired(sessionId: string): boolean {
    const agent = this.agents.get(sessionId);
    if (!agent) return true;
    const now = Date.now();
    if (now - agent.createdAt > agent.config.maxTtlMs) return true;
    if (agent.state === 'idle' && now - agent.lastActivityAt > agent.config.idleTimeoutMs) return true;
    return false;
  }

  checkpoint(sessionId: string, stateSnapshot: unknown): boolean {
    const agent = this.agents.get(sessionId);
    if (!agent) return false;
    this.checkpointInternal(agent, stateSnapshot);
    return true;
  }

  private checkpointInternal(agent: AgentLifecycle, snapshot?: unknown): void {
    agent.checkpoint = {
      takenAt: Date.now(),
      stateSnapshot: snapshot ?? { at: 'auto-checkpoint' },
    };
  }

  getActiveCount(): number {
    let count = 0;
    for (const agent of this.agents.values()) {
      if (agent.state === 'active' || agent.state === 'idle' || agent.state === 'spawned') {
        count++;
      }
    }
    return count;
  }

  getAgents(): AgentLifecycle[] {
    return [...this.agents.values()];
  }

  private scheduleExpiry(sessionId: string): void {
    this.clearTimer(sessionId);
    const timer = setTimeout(() => {
      const agent = this.agents.get(sessionId);
      if (!agent) return;
      if (this.isExpired(sessionId)) {
        this.transition(sessionId, 'terminating');
      }
    }, this.agents.get(sessionId)?.config.maxTtlMs ?? DEFAULT_LIFECYCLE_CONFIG.maxTtlMs);
    this.timers.set(sessionId, timer);
  }

  private clearTimer(sessionId: string): void {
    const existing = this.timers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(sessionId);
    }
  }

  terminate(sessionId: string): boolean {
    const ok = this.transition(sessionId, 'terminating');
    if (!ok) return false;
    this.transition(sessionId, 'terminated');
    this.clearTimer(sessionId);
    return true;
  }
}

export const lifecycleManager = new AgentLifecycleManager();
