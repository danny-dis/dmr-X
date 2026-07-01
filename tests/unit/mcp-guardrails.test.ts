import { describe, it, expect, beforeEach } from 'vitest';

import { GuardrailsEngine } from '../../services/mcp-server/src/guardrails/filter-engine.js';

describe('GuardrailsEngine', () => {
  let engine: GuardrailsEngine;

  beforeEach(() => {
    engine = new GuardrailsEngine({
      enabled: true,
      piiRedaction: true,
      contentFiltering: true,
      logDetections: false,
    });
  });

  describe('PII Detection', () => {
    it('detects SSN patterns', () => {
      const result = engine.processResponse('My SSN is 123-45-6789');
      expect(result.hasPII).toBe(true);
      expect(result.detections.some(d => d.type === 'ssn')).toBe(true);
      expect(result.sanitized).not.toContain('123-45-6789');
    });

    it('detects email addresses', () => {
      const result = engine.processResponse('Contact me at user@example.com');
      expect(result.hasPII).toBe(true);
      expect(result.detections.some(d => d.type === 'email')).toBe(true);
      expect(result.sanitized).not.toContain('user@example.com');
    });

    it('detects phone numbers', () => {
      const result = engine.processResponse('Call me at (555) 123-4567');
      expect(result.hasPII).toBe(true);
      expect(result.detections.some(d => d.type === 'phone')).toBe(true);
      expect(result.sanitized).not.toContain('(555) 123-4567');
    });

    it('detects credit card numbers', () => {
      const result = engine.processResponse('My card is 4111-1111-1111-1111');
      expect(result.hasPII).toBe(true);
      expect(result.detections.some(d => d.type === 'credit-card')).toBe(true);
      expect(result.sanitized).not.toContain('4111-1111-1111-1111');
    });

    it('detects IP addresses', () => {
      const result = engine.processResponse('Server at 192.168.1.100');
      expect(result.hasPII).toBe(true);
      expect(result.detections.some(d => d.type === 'ip-address')).toBe(true);
      expect(result.sanitized).not.toContain('192.168.1.100');
    });

    it('detects multiple PII types', () => {
      const result = engine.processResponse(
        'Name: John, Email: john@example.com, SSN: 123-45-6789, Phone: 555-123-4567'
      );
      expect(result.hasPII).toBe(true);
      expect(result.detections.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Content Filtering', () => {
    it('filters blocked keywords', () => {
      const filterEngine = new GuardrailsEngine({
        enabled: true,
        piiRedaction: false,
        contentFiltering: true,
        blockedKeywords: ['forbidden', 'banned', 'restricted'],
        logDetections: false,
      });

      const result = filterEngine.processResponse('This contains forbidden content');
      expect(result.wasFiltered).toBe(true);
      expect(result.sanitized).not.toContain('forbidden');
    });

    it('does not filter when no keywords match', () => {
      const filterEngine = new GuardrailsEngine({
        enabled: true,
        piiRedaction: false,
        contentFiltering: true,
        blockedKeywords: ['forbidden', 'banned'],
        logDetections: false,
      });

      const result = filterEngine.processResponse('This is normal content');
      expect(result.wasFiltered).toBe(false);
      expect(result.sanitized).toBe('This is normal content');
    });
  });

  describe('Custom Patterns', () => {
    it('supports custom redaction patterns', () => {
      const customEngine = new GuardrailsEngine({
        enabled: true,
        piiRedaction: true,
        contentFiltering: false,
        customPatterns: [
          {
            name: 'api-key',
            regex: /api[_-]?key[:\s]*[A-Za-z0-9]{20,}/gi,
            replacement: '[REDACTED_API_KEY]',
            severity: 'high',
          },
        ],
        logDetections: false,
      });

      const result = customEngine.processResponse('api_key: abcdefghijklmnopqrstuvwxyz');
      expect(result.hasPII).toBe(true);
      expect(result.detections.some(d => d.type === 'api-key')).toBe(true);
      expect(result.sanitized).toContain('[REDACTED_API_KEY]');
    });
  });

  describe('Redaction Replacement', () => {
    it('uses custom redaction replacement text', () => {
      const customEngine = new GuardrailsEngine({
        enabled: true,
        piiRedaction: true,
        contentFiltering: false,
        redactionReplacement: '<REDACTED>',
        logDetections: false,
      });

      const result = customEngine.processResponse('Email: test@example.com');
      expect(result.sanitized).toContain('<REDACTED>');
    });

    it('uses default replacement when not specified', () => {
      const result = engine.processResponse('Email: test@example.com');
      expect(result.sanitized).toContain('[REDACTED]');
    });
  });

  describe('Disabled mode', () => {
    it('returns original text when disabled', () => {
      const disabledEngine = new GuardrailsEngine({
        enabled: false,
      });

      const text = 'SSN: 123-45-6789, Email: test@example.com';
      const result = disabledEngine.processResponse(text);
      expect(result.original).toBe(text);
      expect(result.sanitized).toBe(text);
      expect(result.hasPII).toBe(false);
      expect(result.wasFiltered).toBe(false);
    });
  });

  describe('getStats()', () => {
    it('returns pattern counts and config', () => {
      const stats = engine.getStats();
      expect(stats.piiPatternCount).toBeGreaterThan(0);
      expect(stats.config.enabled).toBe(true);
      expect(stats.config.piiRedaction).toBe(true);
    });
  });
});
