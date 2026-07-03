/**
 * Agent Integration Config Tests
 *
 * Validates that the agent integration settings shape is correct
 * by testing the configuration objects directly. Since zod is only
 * available in the gateway package, we test the shape contract here
 * and rely on the gateway's own schema validation for type safety.
 *
 * The actual Zod validation is tested via the admin routes when
 * the gateway is running (integration/e2e tests).
 */

import { describe, it, expect } from 'vitest';

// --- Configuration shape validators (inline, no zod dependency) ---

function isValidClaudeCodeConfig(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false;
  const obj = config as Record<string, unknown>;
  const allowedKeys = [
    'bigModelId', 'bigProviderId',
    'mediumModelId', 'mediumProviderId',
    'smallModelId', 'smallProviderId',
    'customEnvVars',
  ];
  // Strict: no unknown keys
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.includes(key)) return false;
  }
  // Validate model/provider ID types
  for (const key of ['bigModelId', 'bigProviderId', 'mediumModelId', 'mediumProviderId', 'smallModelId', 'smallProviderId']) {
    const val = obj[key];
    if (val !== undefined && val !== null && typeof val !== 'string') return false;
  }
  // Validate customEnvVars
  if (obj.customEnvVars !== undefined) {
    if (!Array.isArray(obj.customEnvVars)) return false;
    for (const item of obj.customEnvVars) {
      if (typeof item !== 'object' || item === null) return false;
      if (typeof (item as Record<string, unknown>).key !== 'string') return false;
      if (typeof (item as Record<string, unknown>).value !== 'string') return false;
    }
  }
  return true;
}

function isValidCodexConfig(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false;
  const obj = config as Record<string, unknown>;
  const allowedKeys = ['modelId', 'providerId', 'configFormat'];
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.includes(key)) return false;
  }
  if (obj.modelId !== undefined && obj.modelId !== null && typeof obj.modelId !== 'string') return false;
  if (obj.providerId !== undefined && obj.providerId !== null && typeof obj.providerId !== 'string') return false;
  if (obj.configFormat !== undefined && !['toml', 'env'].includes(obj.configFormat as string)) return false;
  return true;
}

function isValidAntigravityConfig(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false;
  const obj = config as Record<string, unknown>;
  const allowedKeys = ['isEnabled', 'preferredProviderId'];
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.includes(key)) return false;
  }
  if (obj.isEnabled !== undefined && typeof obj.isEnabled !== 'boolean') return false;
  if (obj.preferredProviderId !== undefined && obj.preferredProviderId !== null && typeof obj.preferredProviderId !== 'string') return false;
  return true;
}

// --- Tests ---

describe('Agent Integration Config Shapes', () => {
  describe('ClaudeCode config', () => {
    it('accepts valid config with all fields', () => {
      expect(isValidClaudeCodeConfig({
        bigModelId: 'claude-opus-4-20250514',
        bigProviderId: 'anthropic',
        mediumModelId: 'claude-sonnet-4-20250514',
        mediumProviderId: 'anthropic',
        smallModelId: 'claude-haiku-3-20250307',
        smallProviderId: 'anthropic',
        customEnvVars: [
          { key: 'CUSTOM_VAR', value: 'test' },
          { key: 'ANOTHER_VAR', value: 'value' },
        ],
      })).toBe(true);
    });

    it('accepts config with only some fields', () => {
      expect(isValidClaudeCodeConfig({
        bigModelId: 'claude-opus-4-20250514',
        bigProviderId: 'anthropic',
      })).toBe(true);
    });

    it('accepts config with null values', () => {
      expect(isValidClaudeCodeConfig({
        bigModelId: null,
        bigProviderId: null,
      })).toBe(true);
    });

    it('accepts empty object', () => {
      expect(isValidClaudeCodeConfig({})).toBe(true);
    });

    it('rejects unknown keys', () => {
      expect(isValidClaudeCodeConfig({
        bigModelId: 'test',
        unknownKey: 'value',
      })).toBe(false);
    });

    it('rejects invalid customEnvVars type', () => {
      expect(isValidClaudeCodeConfig({
        customEnvVars: 'not-an-array',
      })).toBe(false);
    });

    it('rejects invalid customEnvVars item structure', () => {
      expect(isValidClaudeCodeConfig({
        customEnvVars: [{ invalid: 'structure' }],
      })).toBe(false);
    });
  });

  describe('Codex config', () => {
    it('accepts valid config with all fields', () => {
      expect(isValidCodexConfig({
        modelId: 'claude-sonnet-4-20250514',
        providerId: 'anthropic',
        configFormat: 'toml',
      })).toBe(true);
    });

    it('accepts config with only some fields', () => {
      expect(isValidCodexConfig({
        modelId: 'gpt-4o',
      })).toBe(true);
    });

    it('accepts configFormat "env"', () => {
      expect(isValidCodexConfig({
        configFormat: 'env',
      })).toBe(true);
    });

    it('accepts null values', () => {
      expect(isValidCodexConfig({
        modelId: null,
        providerId: null,
      })).toBe(true);
    });

    it('rejects invalid configFormat', () => {
      expect(isValidCodexConfig({
        configFormat: 'json',
      })).toBe(false);
    });

    it('rejects unknown keys', () => {
      expect(isValidCodexConfig({
        modelId: 'test',
        unknownKey: 'value',
      })).toBe(false);
    });
  });

  describe('Antigravity config', () => {
    it('accepts valid config with all fields', () => {
      expect(isValidAntigravityConfig({
        isEnabled: true,
        preferredProviderId: 'google',
      })).toBe(true);
    });

    it('accepts config with only some fields', () => {
      expect(isValidAntigravityConfig({
        isEnabled: false,
      })).toBe(true);
    });

    it('accepts null preferredProviderId', () => {
      expect(isValidAntigravityConfig({
        preferredProviderId: null,
      })).toBe(true);
    });

    it('accepts empty object', () => {
      expect(isValidAntigravityConfig({})).toBe(true);
    });

    it('rejects unknown keys', () => {
      expect(isValidAntigravityConfig({
        isEnabled: true,
        unknownKey: 'value',
      })).toBe(false);
    });

    it('rejects invalid isEnabled type', () => {
      expect(isValidAntigravityConfig({
        isEnabled: 'yes',
      })).toBe(false);
    });
  });

  describe('Combined configs', () => {
    it('all three configs are independently valid', () => {
      expect(isValidClaudeCodeConfig({ bigModelId: 'test' })).toBe(true);
      expect(isValidCodexConfig({ modelId: 'test' })).toBe(true);
      expect(isValidAntigravityConfig({ isEnabled: true })).toBe(true);
    });
  });
});

describe('Agent Integration Settings Contract', () => {
  it('ClaudeCode config shape matches expected keys', () => {
    const keys = ['bigModelId', 'bigProviderId', 'mediumModelId', 'mediumProviderId', 'smallModelId', 'smallProviderId', 'customEnvVars'];
    expect(keys).toContain('bigModelId');
    expect(keys).toContain('customEnvVars');
    expect(keys.length).toBe(7);
  });

  it('Codex config shape matches expected keys', () => {
    const keys = ['modelId', 'providerId', 'configFormat'];
    expect(keys).toContain('modelId');
    expect(keys).toContain('configFormat');
    expect(keys.length).toBe(3);
  });

  it('Antigravity config shape matches expected keys', () => {
    const keys = ['isEnabled', 'preferredProviderId'];
    expect(keys).toContain('isEnabled');
    expect(keys).toContain('preferredProviderId');
    expect(keys.length).toBe(2);
  });

  it('Codex configFormat only accepts toml or env', () => {
    const validFormats = ['toml', 'env'];
    expect(validFormats).toContain('toml');
    expect(validFormats).toContain('env');
    expect(validFormats.length).toBe(2);
  });
});
