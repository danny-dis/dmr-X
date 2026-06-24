import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

import {
  loadConfigFile,
  resolveConfig,
  resolveConfigInt,
  resolveConfigBool,
  type McpConfigFile,
} from '../../services/mcp-server/src/config.js';

describe('mcp config', () => {
  let tempDir: string;
  let originalCwd: string;
  let originalConfigEnv: string | undefined;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dmrx-mcp-config-'));
    originalCwd = process.cwd();
    // Switch CWD to the temp dir so the default `dmrx-mcp.config.json` lookup
    // is contained inside the temp directory.
    process.chdir(tempDir);
    originalConfigEnv = process.env.DMRX_MCP_CONFIG;
  });

  afterAll(() => {
    process.chdir(originalCwd);
    if (originalConfigEnv === undefined) {
      delete process.env.DMRX_MCP_CONFIG;
    } else {
      process.env.DMRX_MCP_CONFIG = originalConfigEnv;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Always start each test with no explicit config path
    delete process.env.DMRX_MCP_CONFIG;
  });

  describe('loadConfigFile()', () => {
    it('returns null when no config file is present and no env var is set', () => {
      // tempDir has no dmrx-mcp.config.json, and DMRX_MCP_CONFIG is unset
      expect(loadConfigFile()).toBeNull();
    });

    it('loads a config file from DMRX_MCP_CONFIG env var', () => {
      const path = join(tempDir, 'custom.json');
      writeFileSync(path, JSON.stringify({ transport: 'sse', port: 4000 }));
      process.env.DMRX_MCP_CONFIG = path;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cfg = loadConfigFile();
      expect(cfg).toEqual({ transport: 'sse', port: 4000 });
      consoleErrorSpy.mockRestore();
    });

    it('loads a config file from the current working directory by default', () => {
      const path = join(tempDir, 'dmrx-mcp.config.json');
      writeFileSync(path, JSON.stringify({ transport: 'http', host: '0.0.0.0' }));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cfg = loadConfigFile();
      expect(cfg).toEqual({ transport: 'http', host: '0.0.0.0' });
      consoleErrorSpy.mockRestore();
    });

    it('returns null for malformed JSON', () => {
      const path = join(tempDir, 'broken.json');
      writeFileSync(path, '{ this is : not, valid json');
      process.env.DMRX_MCP_CONFIG = path;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cfg = loadConfigFile();
      expect(cfg).toBeNull();
      consoleErrorSpy.mockRestore();
    });

    it('rejects a JSON root that is null', () => {
      const path = join(tempDir, 'null.json');
      writeFileSync(path, 'null');
      process.env.DMRX_MCP_CONFIG = path;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cfg = loadConfigFile();
      expect(cfg).toBeNull();
      consoleErrorSpy.mockRestore();
    });

    it('returns an array root as-is (the type guard only rejects null/non-objects)', () => {
      // Implementation note: `typeof [] === 'object'`, so a JSON array passes the
      // object/typeof check. The function returns it cast as McpConfigFile. Callers
      // should treat the result defensively.
      const path = join(tempDir, 'array.json');
      writeFileSync(path, '[1, 2, 3]');
      process.env.DMRX_MCP_CONFIG = path;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cfg = loadConfigFile();
      expect(cfg).toEqual([1, 2, 3]);
      consoleErrorSpy.mockRestore();
    });

    it('returns null when the file does not exist', () => {
      process.env.DMRX_MCP_CONFIG = join(tempDir, 'does-not-exist.json');
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cfg = loadConfigFile();
      expect(cfg).toBeNull();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('resolveConfig()', () => {
    it('returns env value when env var is set', () => {
      process.env.DMRX_TEST_VAR = 'from-env';
      const result = resolveConfig<string>(null, 'port', 'DMRX_TEST_VAR', '3000');
      expect(result).toBe('from-env');
      delete process.env.DMRX_TEST_VAR;
    });

    it('returns env value even when the file config has the same key', () => {
      process.env.DMRX_TEST_VAR = 'env-wins';
      const file: McpConfigFile = { port: 9999 };
      const result = resolveConfig<number>(file, 'port', 'DMRX_TEST_VAR', 3000);
      expect(result).toBe('env-wins'); // env precedence
      delete process.env.DMRX_TEST_VAR;
    });

    it('returns file config value when env is unset', () => {
      delete process.env.DMRX_TEST_VAR;
      const file: McpConfigFile = { port: 4242 };
      const result = resolveConfig<number>(file, 'port', 'DMRX_TEST_VAR', 3000);
      expect(result).toBe(4242);
    });

    it('returns default when neither env nor file has the value', () => {
      delete process.env.DMRX_TEST_VAR;
      const result = resolveConfig<number>(null, 'port', 'DMRX_TEST_VAR', 3000);
      expect(result).toBe(3000);
    });

    it('treats an empty env var as not set (falls through to file or default)', () => {
      process.env.DMRX_TEST_VAR = '';
      const file: McpConfigFile = { port: 5555 };
      const result = resolveConfig<number>(file, 'port', 'DMRX_TEST_VAR', 3000);
      expect(result).toBe(5555);
      delete process.env.DMRX_TEST_VAR;
    });

    it('supports nested keys via dot notation', () => {
      delete process.env.DMRX_TEST_VAR;
      const file: McpConfigFile = { router: { epsilon: 0.1, defaultQualityTarget: 'quality' } };
      const eps = resolveConfig<number>(file, 'router.epsilon', 'DMRX_TEST_VAR', 0.05);
      const q = resolveConfig<string>(file, 'router.defaultQualityTarget', 'DMRX_TEST_VAR', 'balanced');
      expect(eps).toBe(0.1);
      expect(q).toBe('quality');
    });
  });

  describe('resolveConfigInt()', () => {
    it('parses an integer from an env string', () => {
      process.env.DMRX_TEST_INT = '4040';
      expect(resolveConfigInt(null, 'port', 'DMRX_TEST_INT', 3000)).toBe(4040);
      delete process.env.DMRX_TEST_INT;
    });

    it('parses a numeric value from the file config', () => {
      delete process.env.DMRX_TEST_INT;
      const file: McpConfigFile = { port: 5050 };
      expect(resolveConfigInt(file, 'port', 'DMRX_TEST_INT', 3000)).toBe(5050);
    });

    it('returns the default for a non-numeric env string', () => {
      process.env.DMRX_TEST_INT = 'not-a-number';
      expect(resolveConfigInt(null, 'port', 'DMRX_TEST_INT', 3000)).toBe(3000);
      delete process.env.DMRX_TEST_INT;
    });

    it('handles negative numbers', () => {
      process.env.DMRX_TEST_INT = '-5';
      expect(resolveConfigInt(null, 'offset', 'DMRX_TEST_INT', 0)).toBe(-5);
      delete process.env.DMRX_TEST_INT;
    });

    it('handles zero', () => {
      process.env.DMRX_TEST_INT = '0';
      expect(resolveConfigInt(null, 'port', 'DMRX_TEST_INT', 3000)).toBe(0);
      delete process.env.DMRX_TEST_INT;
    });

    it('handles large numbers', () => {
      process.env.DMRX_TEST_INT = '9999999999';
      expect(resolveConfigInt(null, 'port', 'DMRX_TEST_INT', 3000)).toBe(9999999999);
      delete process.env.DMRX_TEST_INT;
    });

    it('returns the file value when env is empty', () => {
      process.env.DMRX_TEST_INT = '';
      const file: McpConfigFile = { port: 7777 };
      expect(resolveConfigInt(file, 'port', 'DMRX_TEST_INT', 3000)).toBe(7777);
      delete process.env.DMRX_TEST_INT;
    });
  });

  describe('resolveConfigBool()', () => {
    it.each(['true', 'TRUE', 'True', '1'])(
      'treats %p as true',
      (val) => {
        process.env.DMRX_TEST_BOOL = val;
        expect(resolveConfigBool(null, 'flag', 'DMRX_TEST_BOOL', false)).toBe(true);
        delete process.env.DMRX_TEST_BOOL;
      }
    );

    it.each(['false', 'FALSE', '0', 'no', 'NO', 'yes', 'YES'])(
      'treats %p as false (only "true" and "1" are truthy)',
      (val) => {
        process.env.DMRX_TEST_BOOL = val;
        // Note: the current implementation only treats 'true' (any case) and '1' as truthy.
        // 'yes' and 'no' are NOT recognized — they fall through to the false branch.
        expect(resolveConfigBool(null, 'flag', 'DMRX_TEST_BOOL', true)).toBe(false);
        delete process.env.DMRX_TEST_BOOL;
      }
    );

    it('returns the file boolean when env is unset', () => {
      delete process.env.DMRX_TEST_BOOL;
      const file: McpConfigFile = { telemetry: { enabled: true } };
      expect(resolveConfigBool(file, 'telemetry.enabled', 'DMRX_TEST_BOOL', false)).toBe(true);
    });

    it('returns the default for unknown strings', () => {
      process.env.DMRX_TEST_BOOL = 'maybe';
      // 'maybe' is not 'true'/'1', so the function returns false (the false branch
      // of the conditional in resolveConfigBool) — it does NOT fall back to the
      // default value once a non-empty string is in play.
      expect(resolveConfigBool(null, 'flag', 'DMRX_TEST_BOOL', false)).toBe(false);
      delete process.env.DMRX_TEST_BOOL;
    });

    it('is case-insensitive for true values', () => {
      process.env.DMRX_TEST_BOOL = 'TrUe';
      expect(resolveConfigBool(null, 'flag', 'DMRX_TEST_BOOL', false)).toBe(true);
      delete process.env.DMRX_TEST_BOOL;
    });
  });
});
