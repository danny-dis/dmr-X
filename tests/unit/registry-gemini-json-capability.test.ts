import { describe, expect, it } from 'vitest';
import { RegistryService } from '../../services/registry/src/registry.service.js';

const registry = new RegistryService();
const capabilities = (providerName: string, modelId: string, supports_json_mode = 0) =>
  (registry as any).extractCapabilities({
    providerName, modelId, supports_json_mode, supports_streaming: 0,
    supports_vision: 0, supports_tool_use: 0, supports_function_call: 0,
    supports_reasoning: 0,
  }) as string[];

describe('native Gemini JSON routing metadata', () => {
  it('advertises JSON mode for the native Gemini adapter despite a missing DB flag', () => {
    expect(capabilities('google_native', 'gemini-3-flash-preview')).toContain('json_mode');
    expect(capabilities('google_native', 'gemini-3.5-flash')).toContain('json_mode');
  });

  it('does not assume JSON support for unrelated providers or native models', () => {
    expect(capabilities('google_native', 'imagen-3')).not.toContain('json_mode');
    expect(capabilities('unverified-provider', 'gemini-3-flash-preview')).not.toContain('json_mode');
    expect(capabilities('mistral', 'ministral-3b-2512')).not.toContain('json_mode');
  });

  it('keeps explicit DB capability flags intact', () => {
    expect(capabilities('mistral', 'codestral-latest', 1)).toContain('json_mode');
  });
});
