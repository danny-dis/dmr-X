import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { RateLimiter } from '../../services/mcp-server/src/rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('check()', () => {
    it('returns null (allowed) for a tool with no limit configured', () => {
      delete process.env.DMRX_MCP_RATE_LIMIT;
      const limiter = new RateLimiter();
      expect(limiter.check('unknown-tool')).toBeNull();
      limiter.dispose();
    });

    it('records a call for a configured tool', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'chat:5/minute';
      const limiter = new RateLimiter();
      expect(limiter.check('chat')).toBeNull();
      // After 1 call, status shows remaining = 4
      const status = limiter.status('chat');
      expect(status.configured).toBe(true);
      expect(status.limit).toBe(5);
      expect(status.remaining).toBe(4);
      limiter.dispose();
    });

    it('returns an error message once the limit is reached', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'chat:3/minute';
      const limiter = new RateLimiter();
      expect(limiter.check('chat')).toBeNull();
      expect(limiter.check('chat')).toBeNull();
      expect(limiter.check('chat')).toBeNull();

      const denied = limiter.check('chat');
      expect(denied).not.toBeNull();
      expect(denied).toContain('Rate limit exceeded');
      expect(denied).toContain('chat');
      expect(denied).toContain('3');
      limiter.dispose();
    });

    it('allows calls again after the window elapses (sliding window)', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'chat:2/minute';
      const limiter = new RateLimiter();
      expect(limiter.check('chat')).toBeNull();
      expect(limiter.check('chat')).toBeNull();
      // limit reached
      expect(limiter.check('chat')).not.toBeNull();

      // Advance past the 1-minute window
      vi.advanceTimersByTime(61_000);
      expect(limiter.check('chat')).toBeNull();
      limiter.dispose();
    });

    it('still rejects when only part of the window has elapsed', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'chat:1/minute';
      const limiter = new RateLimiter();
      expect(limiter.check('chat')).toBeNull();
      // 30s later, still within the 1-minute window
      vi.advanceTimersByTime(30_000);
      const denied = limiter.check('chat');
      expect(denied).not.toBeNull();
      expect(denied).toMatch(/try again in \d+s/);
      limiter.dispose();
    });
  });

  describe('status()', () => {
    it('returns configured: false for unconfigured tools', () => {
      delete process.env.DMRX_MCP_RATE_LIMIT;
      const limiter = new RateLimiter();
      expect(limiter.status('whatever')).toEqual({ configured: false });
      limiter.dispose();
    });

    it('reports remaining = 0 when limit is exhausted', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'chat:2/minute';
      const limiter = new RateLimiter();
      limiter.check('chat');
      limiter.check('chat');
      const status = limiter.status('chat');
      expect(status.remaining).toBe(0);
      limiter.dispose();
    });

    it('reports window name in human-readable form', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'a:1/second,b:1/minute,c:1/hour,d:1/day';
      const limiter = new RateLimiter();
      expect(limiter.status('a').window).toBe('second');
      expect(limiter.status('b').window).toBe('minute');
      expect(limiter.status('c').window).toBe('hour');
      expect(limiter.status('d').window).toBe('day');
      limiter.dispose();
    });
  });

  describe('listConfig()', () => {
    it('returns the parsed configuration as a list', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'chat:100/minute,image:50/hour';
      const limiter = new RateLimiter();
      const list = limiter.listConfig();
      const byTool = Object.fromEntries(list.map((e) => [e.tool, e]));
      expect(byTool.chat).toEqual({ tool: 'chat', maxRequests: 100, window: 'minute' });
      expect(byTool.image).toEqual({ tool: 'image', maxRequests: 50, window: 'hour' });
      limiter.dispose();
    });

    it('drops invalid entries and keeps valid ones in listConfig', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      process.env.DMRX_MCP_RATE_LIMIT = 'broken,chat:10/minute,also:bad';
      const limiter = new RateLimiter();
      const list = limiter.listConfig();
      expect(list).toHaveLength(1);
      expect(list[0].tool).toBe('chat');
      consoleErrorSpy.mockRestore();
      limiter.dispose();
    });
  });

  describe('parseRateLimitConfig (via env var parsing)', () => {
    it('returns empty config when env var is empty', () => {
      process.env.DMRX_MCP_RATE_LIMIT = '';
      const limiter = new RateLimiter();
      expect(limiter.listConfig()).toEqual([]);
      limiter.dispose();
    });

    it('returns empty config when env var is unset', () => {
      delete process.env.DMRX_MCP_RATE_LIMIT;
      const limiter = new RateLimiter();
      expect(limiter.listConfig()).toEqual([]);
      limiter.dispose();
    });

    it('parses "chat:100/minute" to { max: 100, windowMs: 60000 }', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'chat:100/minute';
      const limiter = new RateLimiter();
      const status = limiter.status('chat');
      expect(status.limit).toBe(100);
      expect(status.window).toBe('minute');
      limiter.dispose();
    });

    it('parses multiple rules separated by commas', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'chat:100/minute,image:50/hour';
      const limiter = new RateLimiter();
      expect(limiter.status('chat').limit).toBe(100);
      expect(limiter.status('image').limit).toBe(50);
      expect(limiter.status('image').window).toBe('hour');
      limiter.dispose();
    });

    it('skips malformed entries gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      process.env.DMRX_MCP_RATE_LIMIT = 'no-colon,bad:10/noSuchWindow,good:5/minute';
      const limiter = new RateLimiter();
      const list = limiter.listConfig();
      // Only the well-formed entry survives
      expect(list).toHaveLength(1);
      expect(list[0]).toEqual({ tool: 'good', maxRequests: 5, window: 'minute' });
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
      limiter.dispose();
    });

    it('accepts the full window unit name (minute/hour/day/second)', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'a:1/second,b:1/minute,c:1/hour,d:1/day';
      const limiter = new RateLimiter();
      const list = limiter.listConfig();
      const byName = Object.fromEntries(list.map((e) => [e.tool, e.window]));
      expect(byName.a).toBe('second');
      expect(byName.b).toBe('minute');
      expect(byName.c).toBe('hour');
      expect(byName.d).toBe('day');
      limiter.dispose();
    });

    it('rejects abbreviated window units like "1m" (only full names are valid)', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      process.env.DMRX_MCP_RATE_LIMIT = 'short:1/1m';
      const limiter = new RateLimiter();
      // "1m" is not a recognized window — entry is dropped
      expect(limiter.listConfig()).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
      limiter.dispose();
    });
  });

  describe('dispose()', () => {
    it('clears the sweep interval', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'chat:5/minute';
      const limiter = new RateLimiter();
      const clearSpy = vi.spyOn(global, 'clearInterval');
      limiter.dispose();
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });

    it('is safe to call multiple times', () => {
      delete process.env.DMRX_MCP_RATE_LIMIT;
      const limiter = new RateLimiter();
      expect(() => {
        limiter.dispose();
        limiter.dispose();
      }).not.toThrow();
    });
  });
});
