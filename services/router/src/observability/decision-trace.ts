/**
 * Routing Decision Trace — Issue #15 P0 Routing.
 *
 * Every routing decision produces a traceable record: which candidates were
 * considered, why they were selected or rejected, and what objective
 * function was used. Auditable, inspectable, no silent failures.
 */

export interface DecisionTraceEntry {
  timestamp: number;
  requestId: string;
  tenantId: string;
  requirementSummary: string;
  candidatesConsidered: string[];
  selectedCandidate?: string;
  rejections: Array<{ candidate: string; reason: string }>;
  objective: string;
  routingDecisionReason: string;
  executionTimeMs: number;
}

export interface DecisionTraceFilter {
  requestId?: string;
  tenantId?: string;
  since?: number;
  limit?: number;
}

export class DecisionTrace {
  private traces: DecisionTraceEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  record(entry: DecisionTraceEntry): void {
    this.traces.push(entry);
    if (this.traces.length > this.maxEntries) {
      this.traces = this.traces.slice(-this.maxEntries);
    }
  }

  getTraces(filter?: DecisionTraceFilter): DecisionTraceEntry[] {
    let results = this.traces;
    if (filter?.requestId) {
      results = results.filter((t) => t.requestId === filter.requestId);
    }
    if (filter?.tenantId) {
      results = results.filter((t) => t.tenantId === filter.tenantId);
    }
    if (filter?.since) {
      results = results.filter((t) => t.timestamp >= filter.since!);
    }
    if (filter?.limit) {
      results = results.slice(-filter.limit);
    }
    return results;
  }

  getDecisionReason(requestId: string): string | undefined {
    const trace = this.traces.find((t) => t.requestId === requestId);
    return trace?.routingDecisionReason;
  }

  getRequestDecisions(requestId: string): DecisionTraceEntry | undefined {
    return this.traces.find((t) => t.requestId === requestId);
  }

  clear(): void {
    this.traces = [];
  }

  count(): number {
    return this.traces.length;
  }
}

export const decisionTrace = new DecisionTrace();
