/**
 * Guardrail plugin interface — all guardrail checks implement this.
 */

export interface GuardrailCheckContext {
  /** Request ID for tracing */
  requestId?: string;
  /** Tenant ID for per-tenant config */
  tenantId?: string;
  /** Direction: input (user→LLM) or output (LLM→user) */
  direction: 'input' | 'output';
  /** Original messages (for input checks) */
  messages?: Array<{ role: string; content: string }>;
  /** Provider/model selected (for output checks) */
  providerId?: string;
  modelId?: string;
}

export interface GuardrailViolation {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  matchedPattern?: string;
  plugin: string;
}

export interface GuardrailCheckResult {
  allowed: boolean;
  violations: GuardrailViolation[];
  /** Optional masked/redacted content */
  maskedContent?: string;
}

export interface GuardrailPlugin {
  /** Unique name for this plugin */
  readonly name: string;

  /** Priority — lower numbers run first (default: 100) */
  readonly priority: number;

  /** Check content for violations */
  check(content: string, context: GuardrailCheckContext): Promise<GuardrailCheckResult>;

  /** Optional: check multiple messages at once (batch optimization) */
  checkMessages?(messages: Array<{ role: string; content: string }>, context: GuardrailCheckContext): Promise<GuardrailCheckResult>;

  /** Optional: cleanup resources */
  dispose?(): Promise<void>;
}
