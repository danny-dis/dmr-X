/**
 * Audit Trail module for MCP Server
 * 
 * Provides tamper-evident logging for compliance (SOC 2, GDPR)
 * and debugging purposes.
 */

export {
  AuditTrailEngine,
  getAuditTrail,
  resetAuditTrail,
  type AuditConfig,
  type AuditEvent,
  type AuditEventType,
  type AuditSeverity,
} from './audit-logger.js';
