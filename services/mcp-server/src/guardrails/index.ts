/**
 * Guardrails module for MCP Server
 * 
 * Provides PII detection and redaction, content filtering,
 * and response sanitization for compliance and security.
 */

export {
  GuardrailsEngine,
  getGuardrailsEngine,
  resetGuardrailsEngine,
  type GuardrailsConfig,
  type RedactionPattern,
  type PIIDetection,
  type GuardrailsResult,
} from './filter-engine.js';
