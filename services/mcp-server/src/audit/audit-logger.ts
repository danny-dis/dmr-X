/**
 * Audit Trail for MCP Tool Operations
 * 
 * Provides tamper-evident logging for compliance (SOC 2, GDPR)
 * and debugging purposes.
 * 
 * Features:
 * - Structured audit events
 * - Event chaining for tamper evidence
 * - Configurable retention
 * - Export for compliance reporting
 */

import crypto from 'node:crypto';

import { createLogger } from '@dmr-x/utils';

const logger = createLogger('mcp-server:audit');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditConfig {
  /** Enable audit logging */
  enabled?: boolean;
  /** Audit log retention in days */
  retentionDays?: number;
  /** Maximum audit log size */
  maxLogSize?: number;
  /** Include request/response bodies */
  includeBodies?: boolean;
  /** Hash algorithm for tamper evidence */
  hashAlgorithm?: 'sha256' | 'sha512';
}

export type AuditEventType =
  | 'tool.invocation'
  | 'tool.result'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.token.exchange'
  | 'auth.token.refresh'
  | 'policy.allow'
  | 'policy.deny'
  | 'config.change'
  | 'error';

export type AuditSeverity = 'info' | 'warn' | 'error' | 'critical';

export interface AuditEvent {
  /** Unique event ID */
  id: string;
  /** Event timestamp */
  timestamp: Date;
  /** Event type */
  type: AuditEventType;
  /** Severity level */
  severity: AuditSeverity;
  /** Event description */
  message: string;
  /** Actor (user, service, etc.) */
  actor: {
    type: 'user' | 'service' | 'system';
    id: string;
    ip?: string;
  };
  /** Target resource */
  target?: {
    type: 'tool' | 'server' | 'token' | 'policy';
    id: string;
  };
  /** Event metadata */
  metadata?: Record<string, unknown>;
  /** Request/response bodies (if enabled) */
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
  /** Previous event hash (for tamper evidence) */
  previousHash?: string;
  /** Event hash */
  hash: string;
}

// ---------------------------------------------------------------------------
// Audit Trail Engine
// ---------------------------------------------------------------------------

/**
 * Audit trail engine for MCP operations
 */
export class AuditTrailEngine {
  private events: AuditEvent[] = [];
  private lastHash = '';
  private config: Required<AuditConfig>;

  constructor(config?: AuditConfig) {
    this.config = {
      enabled: true,
      retentionDays: 90,
      maxLogSize: 100000,
      includeBodies: false,
      hashAlgorithm: 'sha256',
      ...config,
    };
  }

  /**
   * Log an audit event
   */
  log(params: {
    type: AuditEventType;
    severity?: AuditSeverity;
    message: string;
    actor: AuditEvent['actor'];
    target?: AuditEvent['target'];
    metadata?: Record<string, unknown>;
    request?: Record<string, unknown>;
    response?: Record<string, unknown>;
  }): AuditEvent {
    if (!this.config.enabled) {
      return {} as AuditEvent;
    }

    const event: AuditEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: params.type,
      severity: params.severity || 'info',
      message: params.message,
      actor: params.actor,
      target: params.target,
      metadata: params.metadata,
      request: this.config.includeBodies ? params.request : undefined,
      response: this.config.includeBodies ? params.response : undefined,
      previousHash: this.lastHash,
      hash: '',
    };

    // Calculate hash
    event.hash = this.calculateHash(event);
    this.lastHash = event.hash;

    // Store event
    this.events.push(event);

    // Trim old events
    this.trimEvents();

    // Log to console
    logger.info({
      eventType: event.type,
      actor: event.actor.id,
      target: event.target?.id,
      hash: event.hash,
    }, event.message);

    return event;
  }

  /**
   * Log a tool invocation
   */
  logToolInvocation(params: {
    toolName: string;
    serverId: string;
    userId?: string;
    parameters?: Record<string, unknown>;
    ip?: string;
  }): AuditEvent {
    return this.log({
      type: 'tool.invocation',
      severity: 'info',
      message: `Tool invoked: ${params.toolName}`,
      actor: {
        type: params.userId ? 'user' : 'service',
        id: params.userId || 'anonymous',
        ip: params.ip,
      },
      target: {
        type: 'tool',
        id: params.toolName,
      },
      metadata: {
        serverId: params.serverId,
      },
      request: params.parameters,
    });
  }

  /**
   * Log a tool result
   */
  logToolResult(params: {
    toolName: string;
    serverId: string;
    userId?: string;
    success: boolean;
    latencyMs?: number;
    error?: string;
  }): AuditEvent {
    return this.log({
      type: 'tool.result',
      severity: params.success ? 'info' : 'error',
      message: params.success
        ? `Tool completed: ${params.toolName}`
        : `Tool failed: ${params.toolName} - ${params.error}`,
      actor: {
        type: params.userId ? 'user' : 'service',
        id: params.userId || 'anonymous',
      },
      target: {
        type: 'tool',
        id: params.toolName,
      },
      metadata: {
        serverId: params.serverId,
        success: params.success,
        latencyMs: params.latencyMs,
        error: params.error,
      },
    });
  }

  /**
   * Log an authentication event
   */
  logAuthEvent(params: {
    type: 'login' | 'logout' | 'token.exchange' | 'token.refresh';
    userId: string;
    provider?: string;
    success: boolean;
    ip?: string;
  }): AuditEvent {
    return this.log({
      type: `auth.${params.type}`,
      severity: params.success ? 'info' : 'warn',
      message: `Auth ${params.type}: ${params.userId}`,
      actor: {
        type: 'user',
        id: params.userId,
        ip: params.ip,
      },
      metadata: {
        provider: params.provider,
        success: params.success,
      },
    });
  }

  /**
   * Log a policy decision
   */
  logPolicyDecision(params: {
    allowed: boolean;
    policyId?: string;
    userId: string;
    toolName: string;
    reason?: string;
  }): AuditEvent {
    return this.log({
      type: params.allowed ? 'policy.allow' : 'policy.deny',
      severity: params.allowed ? 'info' : 'warn',
      message: params.allowed
        ? `Policy allowed: ${params.toolName}`
        : `Policy denied: ${params.toolName} - ${params.reason}`,
      actor: {
        type: 'user',
        id: params.userId,
      },
      target: {
        type: 'tool',
        id: params.toolName,
      },
      metadata: {
        policyId: params.policyId,
        allowed: params.allowed,
        reason: params.reason,
      },
    });
  }

  /**
   * Get audit events
   */
  getEvents(params?: {
    type?: AuditEventType;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): AuditEvent[] {
    let filtered = [...this.events];

    if (params?.type) {
      filtered = filtered.filter((e) => e.type === params.type);
    }

    if (params?.userId) {
      filtered = filtered.filter((e) => e.actor.id === params.userId);
    }

    if (params?.startDate) {
      filtered = filtered.filter((e) => e.timestamp >= params.startDate!);
    }

    if (params?.endDate) {
      filtered = filtered.filter((e) => e.timestamp <= params.endDate!);
    }

    // Sort by timestamp descending
    filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    const offset = params?.offset || 0;
    const limit = params?.limit || 100;
    return filtered.slice(offset, offset + limit);
  }

  /**
   * Verify audit trail integrity
   */
  verifyIntegrity(): {
    valid: boolean;
    brokenAt?: number;
    totalEvents: number;
  } {
    let previousHash = '';

    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];

      // Verify chain
      if (event.previousHash !== previousHash) {
        return {
          valid: false,
          brokenAt: i,
          totalEvents: this.events.length,
        };
      }

      // Verify hash
      const expectedHash = this.calculateHash(event);
      if (event.hash !== expectedHash) {
        return {
          valid: false,
          brokenAt: i,
          totalEvents: this.events.length,
        };
      }

      previousHash = event.hash;
    }

    return {
      valid: true,
      totalEvents: this.events.length,
    };
  }

  /**
   * Export audit events for compliance
   */
  exportEvents(format: 'json' | 'csv' = 'json'): string {
    if (format === 'csv') {
      return this.exportAsCSV();
    }
    return JSON.stringify(this.events, null, 2);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalEvents: number;
    eventsByType: Record<AuditEventType, number>;
    eventsBySeverity: Record<AuditSeverity, number>;
    oldestEvent?: Date;
    newestEvent?: Date;
  } {
    const eventsByType: Record<string, number> = {};
    const eventsBySeverity: Record<string, number> = {};

    for (const event of this.events) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
      eventsBySeverity[event.severity] = (eventsBySeverity[event.severity] || 0) + 1;
    }

    return {
      totalEvents: this.events.length,
      eventsByType: eventsByType as Record<AuditEventType, number>,
      eventsBySeverity: eventsBySeverity as Record<AuditSeverity, number>,
      oldestEvent: this.events[0]?.timestamp,
      newestEvent: this.events[this.events.length - 1]?.timestamp,
    };
  }

  /**
   * Clear audit events
   */
  clear(): void {
    this.events = [];
    this.lastHash = '';
  }

  private calculateHash(event: Omit<AuditEvent, 'hash'>): string {
    const data = JSON.stringify({
      id: event.id,
      timestamp: event.timestamp,
      type: event.type,
      message: event.message,
      actor: event.actor,
      target: event.target,
      previousHash: event.previousHash,
    });

    return crypto.createHash(this.config.hashAlgorithm).update(data).digest('hex');
  }

  private trimEvents(): void {
    // Trim by count
    if (this.events.length > this.config.maxLogSize) {
      this.events = this.events.slice(-this.config.maxLogSize);
    }

    // Trim by retention period
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);
    this.events = this.events.filter((e) => e.timestamp >= cutoffDate);
  }

  private exportAsCSV(): string {
    const headers = ['id', 'timestamp', 'type', 'severity', 'message', 'actorId', 'actorType', 'targetId', 'targetType', 'hash'];
    const rows = this.events.map((e) => [
      e.id,
      e.timestamp.toISOString(),
      e.type,
      e.severity,
      `"${e.message.replace(/"/g, '""')}"`,
      e.actor.id,
      e.actor.type,
      e.target?.id || '',
      e.target?.type || '',
      e.hash,
    ].join(','));

    return [headers.join(','), ...rows].join('\n');
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: AuditTrailEngine | null = null;

export function getAuditTrail(config?: AuditConfig): AuditTrailEngine {
  if (!instance) {
    instance = new AuditTrailEngine(config);
  }
  return instance;
}

export function resetAuditTrail(): void {
  instance = null;
}
