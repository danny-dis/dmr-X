/**
 * Input Validation Guardrails for DMR-X
 *
 * Provides deterministic input validation including:
 * - Prompt injection detection
 * - Input sanitization for tool parameters
 * - Length and pattern validation
 * - BeforeToolCall hook for MCP tools
 */

import { createLogger } from '@dmr-x/utils';
import type { BeforeToolCallContext, BeforeToolCallResult } from '@dmr-x/utils';

const logger = createLogger('mcp-server:input-validator');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InputValidatorConfig {
  /** Enable input validation */
  enabled?: boolean;
  /** Enable prompt injection detection */
  injectionDetection?: boolean;
  /** Maximum prompt length (characters) */
  maxPromptLength?: number;
  /** Maximum command length (characters) */
  maxCommandLength?: number;
  /** Maximum file path length */
  maxPathLength?: number;
  /** Custom injection patterns */
  customInjectionPatterns?: InjectionPattern[];
  /** Action on detection: 'block' | 'log' | 'sanitize' */
  detectionAction?: 'block' | 'log' | 'sanitize';
}

export interface InjectionPattern {
  /** Pattern name for logging */
  name: string;
  /** Regular expression to detect injection */
  regex: RegExp;
  /** Severity level */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Description for audit logs */
  description: string;
}

export interface InjectionDetection {
  /** Pattern that matched */
  patternName: string;
  /** Severity */
  severity: string;
  /** Position in text */
  start: number;
  end: number;
  /** The matched text */
  matched: string;
  /** Description */
  description: string;
}

export interface InputValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Sanitized input (if sanitize action) */
  sanitized?: string;
  /** Detections made */
  detections: InjectionDetection[];
  /** Block reason (if blocked) */
  blockReason?: string;
}

// ---------------------------------------------------------------------------
// Default Injection Patterns
// ---------------------------------------------------------------------------

const DEFAULT_INJECTION_PATTERNS: InjectionPattern[] = [
  // Prompt override attempts
  {
    name: 'system-prompt-override',
    regex: /(?:ignore|disregard|forget|override)\s+(?:all\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|prompts?|rules?|guidelines?|constraints?|directives?)/gi,
    severity: 'high',
    description: 'Attempt to override system instructions',
  },
  {
    name: 'role-confusion',
    regex: /(?:you\s+are\s+now|act\s+as|pretend\s+to\s+be|roleplay\s+as|simulate\s+being)\s+(?:a\s+)?(?:different|new|another|admin|root|system|developer|operator)/gi,
    severity: 'high',
    description: 'Attempt to change agent role or identity',
  },
  {
    name: 'prompt-leak',
    regex: /(?:show|reveal|print|display|output|echo|repeat)\s+(?:me\s+)?(?:your\s+)?(?:system\s+)?(?:prompt|instructions?|rules?|guidelines?|initial\s+message)/gi,
    severity: 'high',
    description: 'Attempt to extract system prompt',
  },
  // Injection via special tokens/formatting
  {
    name: 'xml-injection',
    regex: /<\s*(?:system|assistant|user|human|ai)\s*>/gi,
    severity: 'medium',
    description: 'XML tag injection attempting role switching',
  },
  {
    name: 'markdown-injection',
    regex: /(?:^#{1,6}\s+(?:system|assistant|human)\s*$|^```(?:system|assistant|human)\s)/gmi,
    severity: 'medium',
    description: 'Markdown header or code block injection for role switching',
  },
  // Code execution attempts
  {
    name: 'eval-execution',
    regex: /(?:eval|exec|system|passthru|shell_exec|popen|proc_open|pcntl_exec)\s*\(/gi,
    severity: 'critical',
    description: 'Code execution function call attempt',
  },
  {
    name: 'code-execution',
    regex: /(?:rm\s+-rf|mkfs|dd\s+if=|chmod\s+777|curl\s+.*\|\s*sh|wget\s+.*\|\s*sh|exec\s+\/bin\/|eval\s+\$\(|python\s+-c|node\s+-e)\b/gi,
    severity: 'critical',
    description: 'Dangerous shell command execution attempt',
  },
  // Data exfiltration patterns
  {
    name: 'exfiltration-url',
    regex: /(?:curl|wget|fetch|axios|http\.get|https\.get|XMLHttpRequest)\s*\(\s*['"`]https?:\/\//gi,
    severity: 'critical',
    description: 'Potential data exfiltration via HTTP request',
  },
  {
    name: 'data-exfiltration',
    regex: /(?:send|transmit|upload|exfiltrate|post|transfer)\s+(?:all\s+)?(?:data|info|information|content|files?|secrets?|keys?|credentials?|tokens?)\s+(?:to|at|into)\s+\S+/gi,
    severity: 'high',
    description: 'Potential data exfiltration via natural language instruction',
  },
  // Path traversal
  {
    name: 'path-traversal',
    regex: /\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|\.%2e\/|%2e\./gi,
    severity: 'high',
    description: 'Path traversal attempt',
  },
  // Null byte injection
  {
    name: 'null-byte',
    regex: /\x00|%00/g,
    severity: 'critical',
    description: 'Null byte injection attempt',
  },
  // Encoded payloads
  {
    name: 'base64-payload',
    regex: /(?:base64|atob|btoa|Buffer\.from)\s*\(\s*['"`][A-Za-z0-9+/=]{20,}|(?:^|\s)[A-Za-z0-9+/]{40,}={0,2}(?:\s|$)/g,
    severity: 'high',
    description: 'Base64 encoded payload detected',
  },
  // SQL injection patterns
  {
    name: 'sql-injection',
    regex: /(?:';\s*(?:DROP|DELETE|INSERT|UPDATE|ALTER|CREATE)\s|'\s+OR\s+'?\d?'?\s*=\s*'?|UNION\s+(?:ALL\s+)?SELECT|--\s*$|\/\*.*\*\/)/gi,
    severity: 'critical',
    description: 'SQL injection attempt',
  },
  // Command injection
  {
    name: 'shell-substitution',
    regex: /\$\(|`[^`]+`|\$\{[^}]+\}/g,
    severity: 'high',
    description: 'Shell command substitution attempt',
  },
];

// ---------------------------------------------------------------------------
// Input Validator
// ---------------------------------------------------------------------------

export class InputValidator {
  private config: Required<InputValidatorConfig>;
  private patterns: InjectionPattern[];

  constructor(config?: InputValidatorConfig) {
    this.config = {
      enabled: true,
      injectionDetection: true,
      maxPromptLength: 100_000,
      maxCommandLength: 10_000,
      maxPathLength: 1_000,
      customInjectionPatterns: [],
      detectionAction: 'log',
      ...config,
    };

    this.patterns = [...DEFAULT_INJECTION_PATTERNS, ...this.config.customInjectionPatterns];
  }

  /**
   * Validate text input for injection attempts
   */
  validateInput(text: string): InputValidationResult {
    if (!this.config.enabled || !this.config.injectionDetection) {
      return { valid: true, detections: [] };
    }

    const detections = this.detectInjections(text);
    const sanitized = this.config.detectionAction === 'sanitize'
      ? this.sanitizeInput(text, detections)
      : undefined;

    const hasHighSeverity = detections.some(d =>
      d.severity === 'critical' || d.severity === 'high'
    );

    const valid = this.config.detectionAction !== 'block' || !hasHighSeverity;

    if (detections.length > 0) {
      logger.warn({
        detections: detections.map(d => d.patternName),
        severity: detections.map(d => d.severity),
        action: this.config.detectionAction,
      }, 'Input injection detected');
    }

    return {
      valid,
      sanitized,
      detections,
      blockReason: !valid ? `Blocked: ${detections[0]?.description}` : undefined,
    };
  }

  /**
   * Validate tool call arguments before execution
   * Returns a BeforeToolCallResult compatible with the tool executor hooks
   */
  validateToolCall(context: BeforeToolCallContext): BeforeToolCallResult | undefined {
    if (!this.config.enabled) return undefined;

    const { tool, args } = context;
    const toolName = tool.function.name;

    // Extract text fields to validate
    const textFields = this.extractTextFields(args);

    for (const { field, value } of textFields) {
      // Check length limits
      const maxLength = this.getMaxLengthForField(toolName, field);
      if (value.length > maxLength) {
        logger.warn({
          tool: toolName,
          field,
          length: value.length,
          maxLength,
        }, 'Input exceeds length limit');

        if (this.config.detectionAction === 'block') {
          return {
            block: true,
            reason: `Field "${field}" exceeds maximum length of ${maxLength} characters`,
          };
        }
      }

      // Check for injection patterns
      const result = this.validateInput(value);
      if (!result.valid) {
        return {
          block: true,
          reason: result.blockReason,
        };
      }
    }

    return undefined;
  }

  /**
   * Detect injection patterns in text
   */
  private detectInjections(text: string): InjectionDetection[] {
    const detections: InjectionDetection[] = [];

    for (const pattern of this.patterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        detections.push({
          patternName: pattern.name,
          severity: pattern.severity,
          start: match.index,
          end: match.index + match[0].length,
          matched: match[0],
          description: pattern.description,
        });
      }
    }

    return detections;
  }

  /**
   * Sanitize input by removing detected injection patterns
   */
  private sanitizeInput(text: string, detections: InjectionDetection[]): string {
    let sanitized = text;

    // Sort by position descending to avoid offset issues
    const sorted = [...detections].sort((a, b) => b.start - a.start);

    for (const detection of sorted) {
      const before = sanitized.slice(0, detection.start);
      const after = sanitized.slice(detection.end);
      sanitized = `${before}[SANITIZED]${after}`;
    }

    return sanitized;
  }

  /**
   * Extract text fields from tool call arguments for validation
   */
  private extractTextFields(args: unknown): Array<{ field: string; value: string }> {
    const fields: Array<{ field: string; value: string }> = [];

    if (!args || typeof args !== 'object') return fields;

    const obj = args as Record<string, unknown>;

    // Common text fields to validate
    const textFieldNames = [
      'prompt', 'negative_prompt', 'command', 'content', 'text',
      'input', 'query', 'message', 'instruction', 'condition',
    ];

    for (const fieldName of textFieldNames) {
      const value = obj[fieldName];
      if (typeof value === 'string') {
        fields.push({ field: fieldName, value });
      }
    }

    // Check nested message content
    if (Array.isArray(obj.messages)) {
      for (let i = 0; i < obj.messages.length; i++) {
        const msg = obj.messages[i];
        if (msg && typeof msg === 'object') {
          const msgObj = msg as Record<string, unknown>;
          if (typeof msgObj.content === 'string') {
            fields.push({ field: `messages[${i}].content`, value: msgObj.content });
          }
        }
      }
    }

    return fields;
  }

  /**
   * Get maximum length for a field based on tool and field name
   */
  private getMaxLengthForField(toolName: string, field: string): number {
    // Command fields
    if (field === 'command') return this.config.maxCommandLength;

    // Path fields
    if (field === 'path' || field.endsWith('_path') || field.endsWith('Path')) {
      return this.config.maxPathLength;
    }

    // Tool-specific limits
    if (toolName === 'dmrx_bash') return this.config.maxCommandLength;
    if (toolName === 'dmrx_read_file' || toolName === 'dmrx_write_file') {
      return field === 'content' ? 1_000_000 : this.config.maxPathLength;
    }

    // Default prompt/content limit
    return this.config.maxPromptLength;
  }

  /**
   * Add a custom injection pattern
   */
  addPattern(pattern: InjectionPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * Remove a pattern by name
   */
  removePattern(name: string): boolean {
    const index = this.patterns.findIndex(p => p.name === name);
    if (index >= 0) {
      this.patterns.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all patterns
   */
  getPatterns(): InjectionPattern[] {
    return [...this.patterns];
  }

  /**
   * Get statistics
   */
  getStats(): { patternCount: number; config: InputValidatorConfig } {
    return {
      patternCount: this.patterns.length,
      config: { ...this.config },
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: InputValidator | null = null;

export function getInputValidator(config?: InputValidatorConfig): InputValidator {
  if (!instance) {
    instance = new InputValidator(config);
  }
  return instance;
}

export function resetInputValidator(): void {
  instance = null;
}

/**
 * Create a beforeToolCall hook that uses the InputValidator
 */
export function createInputValidationHook(config?: InputValidatorConfig) {
  const validator = getInputValidator(config);

  return async (context: BeforeToolCallContext) => {
    return validator.validateToolCall(context);
  };
}
