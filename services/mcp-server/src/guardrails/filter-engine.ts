/**
 * Guardrails for MCP Tool Responses
 * 
 * Provides PII detection and redaction, content filtering,
 * and response sanitization for compliance and security.
 * 
 * Features:
 * - Regex-based PII detection (SSN, email, phone, etc.)
 * - Custom content filters
 * - Response sanitization
 * - Configurable redaction patterns
 */

import { createLogger } from '@dmr-x/utils';

const logger = createLogger('mcp-server:guardrails');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuardrailsConfig {
  /** Enable guardrails */
  enabled?: boolean;
  /** Enable PII detection and redaction */
  piiRedaction?: boolean;
  /** Enable content filtering */
  contentFiltering?: boolean;
  /** Custom redaction patterns */
  customPatterns?: RedactionPattern[];
  /** Content filter keywords */
  blockedKeywords?: string[];
  /** Redaction replacement text */
  redactionReplacement?: string;
  /** Log detected PII (for audit) */
  logDetections?: boolean;
}

export interface RedactionPattern {
  /** Pattern name */
  name: string;
  /** Regular expression */
  regex: RegExp;
  /** Replacement text */
  replacement?: string;
  /** Severity level */
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface PIIDetection {
  /** Type of PII detected */
  type: string;
  /** Severity level */
  severity: string;
  /** Position in text */
  start: number;
  end: number;
  /** Redacted value */
  redacted: string;
}

export interface GuardrailsResult {
  /** Original text */
  original: string;
  /** Sanitized text */
  sanitized: string;
  /** Detections made */
  detections: PIIDetection[];
  /** Whether any PII was found */
  hasPII: boolean;
  /** Whether content was filtered */
  wasFiltered: boolean;
}

// ---------------------------------------------------------------------------
// Default PII Patterns
// ---------------------------------------------------------------------------

const DEFAULT_PII_PATTERNS: RedactionPattern[] = [
  {
    name: 'ssn',
    regex: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g,
    severity: 'critical',
  },
  {
    name: 'credit-card',
    regex: /\b(?:4[0-9]{3}|5[1-5][0-9]{2}|3[47][0-9]{2}|3(?:0[0-5]|[68][0-9])|6(?:011|5[0-9]{2}))[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{1,4}\b/g,
    severity: 'critical',
  },
  {
    name: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    severity: 'high',
  },
  {
    name: 'phone',
    regex: /\b(?:\+?1[-.]?)?\(?\d{3}\)?[-.]?\s*\d{3}[-.]?\s*\d{4}\b/g,
    severity: 'medium',
  },
  {
    name: 'ip-address',
    regex: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
    severity: 'medium',
  },
  {
    name: 'AWS Access Key',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    severity: 'critical',
  },
  {
    name: 'AWS Secret Key',
    regex: /\b[0-9a-zA-Z/+=]{40}\b/g,
    severity: 'critical',
  },
  {
    name: 'GitHub Token',
    regex: /\bghp_[0-9a-zA-Z]{36}\b/g,
    severity: 'critical',
  },
  {
    name: 'GitHub OAuth',
    regex: /\bgho_[0-9a-zA-Z]{36}\b/g,
    severity: 'critical',
  },
  {
    name: 'Slack Token',
    regex: /\bxox[baprs]-[0-9a-zA-Z-]+/g,
    severity: 'critical',
  },
  {
    name: 'Private Key',
    regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
    severity: 'critical',
  },
];

// ---------------------------------------------------------------------------
// Guardrails Engine
// ---------------------------------------------------------------------------

/**
 * Guardrails engine for MCP tool responses
 */
export class GuardrailsEngine {
  private config: Required<GuardrailsConfig>;
  private patterns: RedactionPattern[];

  constructor(config?: GuardrailsConfig) {
    this.config = {
      enabled: true,
      piiRedaction: true,
      contentFiltering: true,
      customPatterns: [],
      blockedKeywords: [],
      redactionReplacement: '[REDACTED]',
      logDetections: true,
      ...config,
    };

    // Combine default and custom patterns
    this.patterns = [...DEFAULT_PII_PATTERNS, ...this.config.customPatterns];
  }

  /**
   * Process text through guardrails
   */
  process(text: string): GuardrailsResult {
    if (!this.config.enabled) {
      return {
        original: text,
        sanitized: text,
        detections: [],
        hasPII: false,
        wasFiltered: false,
      };
    }

    let sanitized = text;
    const detections: PIIDetection[] = [];

    // PII Detection and Redaction
    if (this.config.piiRedaction) {
      const piiResult = this.detectAndRedactPII(sanitized);
      sanitized = piiResult.sanitized;
      detections.push(...piiResult.detections);
    }

    // Content Filtering
    let wasFiltered = false;
    if (this.config.contentFiltering) {
      const filterResult = this.filterContent(sanitized);
      sanitized = filterResult.sanitized;
      wasFiltered = filterResult.wasFiltered;
    }

    // Log detections for audit
    if (this.config.logDetections && detections.length > 0) {
      logger.warn({ detections: detections.map((d) => d.type) }, 'PII detected and redacted');
    }

    return {
      original: text,
      sanitized,
      detections,
      hasPII: detections.length > 0,
      wasFiltered,
    };
  }

  /**
   * Process an object recursively
   */
  processObject(obj: unknown): unknown {
    if (typeof obj === 'string') {
      return this.process(obj).sanitized;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.processObject(item));
    }

    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.processObject(value);
      }
      return result;
    }

    return obj;
  }

  /**
   * Detect and redact PII in text
   */
  private detectAndRedactPII(text: string): {
    sanitized: string;
    detections: PIIDetection[];
  } {
    const detections: PIIDetection[] = [];
    let sanitized = text;

    for (const pattern of this.patterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;

      while ((match = regex.exec(text)) !== null) {
        const detection: PIIDetection = {
          type: pattern.name,
          severity: pattern.severity,
          start: match.index,
          end: match.index + match[0].length,
          redacted: pattern.replacement ?? this.config.redactionReplacement,
        };

        detections.push(detection);

        // Replace in sanitized text
        sanitized = sanitized.replace(match[0], detection.redacted);
      }
    }

    return { sanitized, detections };
  }

  /**
   * Filter content based on blocked keywords
   */
  private filterContent(text: string): {
    sanitized: string;
    wasFiltered: boolean;
  } {
    if (this.config.blockedKeywords.length === 0) {
      return { sanitized: text, wasFiltered: false };
    }

    let sanitized = text;
    let wasFiltered = false;

    for (const keyword of this.config.blockedKeywords) {
      if (sanitized.toLowerCase().includes(keyword.toLowerCase())) {
        sanitized = sanitized.replace(new RegExp(keyword, 'gi'), '[FILTERED]');
        wasFiltered = true;
      }
    }

    return { sanitized, wasFiltered };
  }

  /**
   * Add a custom redaction pattern
   */
  addPattern(pattern: RedactionPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * Remove a pattern by name
   */
  removePattern(name: string): boolean {
    const index = this.patterns.findIndex((p) => p.name === name);
    if (index >= 0) {
      this.patterns.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all patterns
   */
  getPatterns(): RedactionPattern[] {
    return [...this.patterns];
  }

  /**
   * Get statistics
   */
  getStats(): {
    piiPatternCount: number;
    patternCount: number;
    blockedKeywordCount: number;
    config: { enabled: boolean; piiRedaction: boolean };
  } {
    return {
      piiPatternCount: this.patterns.length,
      patternCount: this.patterns.length,
      blockedKeywordCount: this.config.blockedKeywords.length,
      config: {
        enabled: this.config.enabled,
        piiRedaction: this.config.piiRedaction,
      },
    };
  }

  /**
   * Alias for process() — matches the test contract.
   */
  processResponse(text: string): GuardrailsResult {
    return this.process(text);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: GuardrailsEngine | null = null;

export function getGuardrailsEngine(config?: GuardrailsConfig): GuardrailsEngine {
  if (!instance) {
    instance = new GuardrailsEngine(config);
  }
  return instance;
}

export function resetGuardrailsEngine(): void {
  instance = null;
}
