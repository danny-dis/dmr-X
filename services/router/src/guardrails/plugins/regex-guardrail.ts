import type { GuardrailPlugin, GuardrailCheckContext, GuardrailCheckResult, GuardrailViolation } from '../guardrail-plugin.interface.js';

export interface RegexGuardrailConfig {
  enablePII: boolean;
  enableInjection: boolean;
  enableContentFiltering: boolean;
  maxContentLength: number;
  /** Custom PII patterns: { pattern, type, severity } */
  customPIIPatterns?: Array<{ pattern: RegExp; type: string; severity: 'low' | 'medium' | 'high' }>;
  /** Custom injection patterns */
  customInjectionPatterns?: Array<{ pattern: RegExp; type: string; severity: 'low' | 'medium' | 'high' }>;
  /** Blocked content patterns (regex) */
  blockedPatterns?: string[];
}

const DEFAULT_CONFIG: RegexGuardrailConfig = {
  enablePII: false,
  enableInjection: false,
  enableContentFiltering: false,
  maxContentLength: 100000,
};

const BUILT_IN_PII_PATTERNS: Array<{ pattern: RegExp; type: string; severity: 'low' | 'medium' | 'high' }> = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/, type: 'SSN', severity: 'high' },
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, type: 'Credit Card', severity: 'high' },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, type: 'Email', severity: 'medium' },
  { pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/, type: 'Phone', severity: 'medium' },
  { pattern: /\b\d{1,5}\s\w+\s(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd)\b/i, type: 'Address', severity: 'medium' },
];

const BUILT_IN_INJECTION_PATTERNS: Array<{ pattern: RegExp; type: string; severity: 'low' | 'medium' | 'high' }> = [
  { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, type: 'Instruction Override', severity: 'high' },
  { pattern: /you\s+are\s+now\s+(?:a|an)\s+/i, type: 'Role Hijack', severity: 'high' },
  { pattern: /system\s*:\s*/i, type: 'System Prompt Injection', severity: 'high' },
  { pattern: /\b(?:DAN|Do Anything Now)\b/i, type: 'DAN Jailbreak', severity: 'high' },
  { pattern: /(?:pretend|act\s+as\s+if|roleplay)\s+(?:you\s+are|as)\s+/i, type: 'Role Manipulation', severity: 'medium' },
  { pattern: /(?:jailbreak|bypass|override)\s+(?:safety|filter|restriction)/i, type: 'Safety Bypass', severity: 'high' },
  { pattern: /\b(?:sudo|admin|root)\s+(?:mode|access)/i, type: 'Privilege Escalation', severity: 'high' },
];

const OUTPUT_PATTERNS: Array<{ pattern: RegExp; type: string; severity: 'low' | 'medium' | 'high' }> = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/, type: 'PII in Output', severity: 'high' },
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, type: 'PII in Output', severity: 'high' },
  { pattern: /(?:system\s*prompt|internal\s*instructions|you\s+are\s+a)\s*[:=]/i, type: 'System Prompt Leakage', severity: 'medium' },
];

/**
 * Regex-based guardrail plugin — port of the original monolithic engine.
 * Checks for PII, injection patterns, content filtering, and length limits.
 */
export class RegexGuardrailPlugin implements GuardrailPlugin {
  readonly name = 'regex';
  readonly priority = 10;

  private config: RegexGuardrailConfig;
  private piiPatterns: Array<{ pattern: RegExp; type: string; severity: 'low' | 'medium' | 'high' }>;
  private injectionPatterns: Array<{ pattern: RegExp; type: string; severity: 'low' | 'medium' | 'high' }>;
  private blockedPatternRegexes: RegExp[];

  constructor(config: Partial<RegexGuardrailConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.piiPatterns = [...BUILT_IN_PII_PATTERNS, ...(this.config.customPIIPatterns || [])];
    this.injectionPatterns = [...BUILT_IN_INJECTION_PATTERNS, ...(this.config.customInjectionPatterns || [])];
    this.blockedPatternRegexes = (this.config.blockedPatterns || []).map(p => new RegExp(p, 'i'));
  }

  async check(content: string, context: GuardrailCheckContext): Promise<GuardrailCheckResult> {
    const violations: GuardrailViolation[] = [];

    // Length check
    if (content.length > this.config.maxContentLength) {
      violations.push({
        type: 'length',
        severity: 'medium',
        description: `Content exceeds max length (${content.length} > ${this.config.maxContentLength})`,
        plugin: this.name,
      });
    }

    // PII detection (input and output)
    if (this.config.enablePII) {
      for (const { pattern, type, severity } of this.piiPatterns) {
        const match = content.match(pattern);
        if (match) {
          violations.push({
            type: 'pii',
            severity,
            description: `Detected ${type}`,
            matchedPattern: match[0],
            plugin: this.name,
          });
        }
      }
    }

    // Injection detection (input only)
    if (context.direction === 'input' && this.config.enableInjection) {
      for (const { pattern, type, severity } of this.injectionPatterns) {
        if (pattern.test(content)) {
          violations.push({
            type: 'injection',
            severity,
            description: `Detected ${type}`,
            plugin: this.name,
          });
        }
      }
    }

    // Output-specific patterns
    if (context.direction === 'output') {
      for (const { pattern, type, severity } of OUTPUT_PATTERNS) {
        if (pattern.test(content)) {
          violations.push({
            type: 'output_violation',
            severity,
            description: `Detected ${type}`,
            plugin: this.name,
          });
        }
      }
    }

    // Content filtering
    if (this.config.enableContentFiltering && this.blockedPatternRegexes.length > 0) {
      for (const regex of this.blockedPatternRegexes) {
        if (regex.test(content)) {
          violations.push({
            type: 'content',
            severity: 'high',
            description: `Content matches blocked pattern: ${regex.source}`,
            plugin: this.name,
          });
        }
      }
    }

    return {
      allowed: violations.every(v => v.severity !== 'high'),
      violations,
    };
  }

  async checkMessages(messages: Array<{ role: string; content: string }>, context: GuardrailCheckContext): Promise<GuardrailCheckResult> {
    const allViolations: GuardrailViolation[] = [];

    for (const msg of messages) {
      const targetRoles = context.direction === 'input' ? ['user'] : ['assistant'];
      if (targetRoles.includes(msg.role)) {
        const result = await this.check(msg.content, context);
        allViolations.push(...result.violations);
      }
    }

    return {
      allowed: allViolations.every(v => v.severity !== 'high'),
      violations: allViolations,
    };
  }

  updateConfig(config: Partial<RegexGuardrailConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.customPIIPatterns) {
      this.piiPatterns = [...BUILT_IN_PII_PATTERNS, ...config.customPIIPatterns];
    }
    if (config.customInjectionPatterns) {
      this.injectionPatterns = [...BUILT_IN_INJECTION_PATTERNS, ...config.customInjectionPatterns];
    }
    if (config.blockedPatterns) {
      this.blockedPatternRegexes = config.blockedPatterns.map(p => new RegExp(p, 'i'));
    }
  }
}
