import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { RateLimiter } from '../../services/mcp-server/src/rate-limiter.js';

describe('RateLimiter', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.DMRX_MCP_RATE_LIMIT;
    // Clear the env var before each test
    delete process.env.DMRX_MCP_RATE_LIMIT;
  });

  afterEach(() => {
    // Restore original env var
    if (originalEnv === undefined) {
      delete process.env.DMRX_MCP_RATE_LIMIT;
    } else {
      process.env.DMRX_MCP_RATE_LIMIT = originalEnv;
    }
  });

  describe('configuration parsing', () => {
    it('parses rate limit config from env var', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'dmrx_chat:100/hour,dmrx_batch:10/minute';
      const limiter = new RateLimiter();

      const chatStatus = limiter.getStatus('dmrx_chat');
      expect(chatStatus.limit).toBe(100);
      expect(chatStatus.windowMs).toBe(3600000); // 1 hour

      const batchStatus = limiter.getStatus('dmrx_batch');
      expect(batchStatus.limit).toBe(10);
      expect(batchStatus.windowMs).toBe(60000); // 1 minute

      limiter.dispose();
    });

    it('handles invalid rate limit entries gracefully', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'invalid-entry,dmrx_chat:100/hour';
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const limiter = new RateLimiter();
      const status = limiter.getStatus('dmrx_chat');
      expect(status.limit).toBe(100);

      consoleErrorSpy.mockRestore();
      limiter.dispose();
    });

    it('handles empty env var', () => {
      process.env.DMRX_MCP_RATE_LIMIT = '';
      const limiter = new RateLimiter();

      const status = limiter.getStatus('dmrx_chat');
      expect(status.limit).toBe(Infinity);

      limiter.dispose();
    });

    it('handles missing env var', () => {
      delete process.env.DMRX_MCP_RATE_LIMIT;
      const limiter = new RateLimiter();

      const status = limiter.getStatus('dmrx_chat');
      expect(status.limit).toBe(Infinity);

      limiter.dispose();
    });
  });

  describe('rate limiting', () => {
    it('allows requests within limit', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'dmrx_chat:5/minute';
      const limiter = new RateLimiter();

      for (let i = 0; i < 5; i++) {
        expect(limiter.check('dmrx_chat')).toBeNull();
      }

      limiter.dispose();
    });

    it('blocks requests exceeding limit', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'dmrx_chat:3/minute';
      const limiter = new RateLimiter();

      // First 3 should pass
      expect(limiter.check('dmrx_chat')).toBeNull();
      expect(limiter.check('dmrx_chat')).toBeNull();
      expect(limiter.check('dmrx_chat')).toBeNull();

      // Fourth should be blocked
      const result = limiter.check('dmrx_chat');
      expect(result).not.toBeNull();
      expect(result!.retryAfter).toBeGreaterThan(0);

      limiter.dispose();
    });

    it('allows requests for unconfigured tools', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'dmrx_chat:1/minute';
      const limiter = new RateLimiter();

      // Unconfigured tool should always pass
      expect(limiter.check('unconfigured_tool')).toBeNull();
      expect(limiter.check('unconfigured_tool')).toBeNull();

      limiter.dispose();
    });

    it('tracks per-tool windows independently', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'dmrx_chat:2/minute,dmrx_batch:1/minute';
      const limiter = new RateLimiter();

      // Use up dmrx_chat limit
      expect(limiter.check('dmrx_chat')).toBeNull();
      expect(limiter.check('dmrx_chat')).toBeNull();
      expect(limiter.check('dmrx_chat')).not.toBeNull();

      // dmrx_batch should still work
      expect(limiter.check('dmrx_batch')).toBeNull();
      expect(limiter.check('dmrx_batch')).not.toBeNull();

      limiter.dispose();
    });
  });

  describe('window durations', () => {
    it('supports second window', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'dmrx_chat:2/second';
      const limiter = new RateLimiter();

      expect(limiter.getStatus('dmrx_chat').windowMs).toBe(1000);

      limiter.dispose();
    });

    it('supports minute window', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'dmrx_chat:2/minute';
      const limiter = new RateLimiter();

      expect(limiter.getStatus('dmrx_chat').windowMs).toBe(60000);

      limiter.dispose();
    });

    it('supports hour window', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'dmrx_chat:2/hour';
      const limiter = new RateLimiter();

      expect(limiter.getStatus('dmrx_chat').windowMs).toBe(3600000);

      limiter.dispose();
    });

    it('supports day window', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'dmrx_chat:2/day';
      const limiter = new RateLimiter();

      expect(limiter.getStatus('dmrx_chat').windowMs).toBe(86400000);

      limiter.dispose();
    });
  });

  describe('getStatus()', () => {
    it('returns current usage stats', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'dmrx_chat:10/minute';
      const limiter = new RateLimiter();

      const initial = limiter.getStatus('dmrx_chat');
      expect(initial.limit).toBe(10);
      expect(initial.remaining).toBe(10);
      expect(initial.windowMs).toBe(60000);

      limiter.check('dmrx_chat');
      limiter.check('dmrx_chat');

      const after = limiter.getStatus('dmrx_chat');
      expect(after.remaining).toBe(8);

      limiter.dispose();
    });
  });

  describe('reset()', () => {
    it('resets rate limit for a tool', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'dmrx_chat:2/minute';
      const limiter = new RateLimiter();

      limiter.check('dmrx_chat');
      limiter.check('dmrx_chat');

      // Should be blocked
      expect(limiter.check('dmrx_chat')).not.toBeNull();

      // Reset
      limiter.reset('dmrx_chat');

      // Should work again
      expect(limiter.check('dmrx_chat')).toBeNull();

      limiter.dispose();
    });
  });

  describe('dispose()', () => {
    it('cleans up resources', () => {
      process.env.DMRX_MCP_RATE_LIMIT = 'dmrx_chat:10/minute';
      const limiter = new RateLimiter();

      // Should not throw
      limiter.dispose();

      // Multiple dispose calls should be safe
      limiter.dispose();
    });
  });
});
