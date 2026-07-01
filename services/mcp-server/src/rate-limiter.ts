/**
 * Lightweight in-memory sliding-window rate limiter for MCP tools.
 *
 * Configuration via DMRX_MCP_RATE_LIMIT env var:
 *   "dmrx_chat:100/hour,dmrx_generate_image:20/hour,dmrx_batch:10/minute"
 *
 * Format: <tool>:<max>/<window>
 *   window: "second", "minute", "hour", "day"
 */

export interface RateLimitConfig {
  /** Max requests allowed in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

interface WindowEntry {
  timestamps: number[];
}

const WINDOW_MAP: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

/**
 * Parses the DMRX_MCP_RATE_LIMIT env var into a map of tool → config.
 * Returns an empty map if the env var is unset or invalid.
 */
function parseRateLimitConfig(): Map<string, RateLimitConfig> {
  const raw = process.env.DMRX_MCP_RATE_LIMIT || '';
  if (!raw.trim()) return new Map();

  const config = new Map<string, RateLimitConfig>();

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    // Pattern: tool:max/window
    const match = trimmed.match(/^([^:]+):(\d+)\/(\w+)$/);
    if (!match) {
      console.error(`Invalid rate limit entry: "${trimmed}" — expected format: tool:max/window`);
      continue;
    }

    const [, tool, maxStr, windowStr] = match;
    const windowMs = WINDOW_MAP[windowStr];
    if (!windowMs) {
      console.error(`Invalid window "${windowStr}" for tool "${tool}" — use second, minute, hour, or day`);
      continue;
    }

    config.set(tool.trim(), {
      maxRequests: parseInt(maxStr, 10),
      windowMs,
    });
  }

  return config;
}

/**
 * Sliding-window rate limiter.
 * Tracks per-tool request timestamps and rejects when the limit is exceeded.
 */
export class RateLimiter {
  private config: Map<string, RateLimitConfig>;
  private windows: Map<string, WindowEntry> = new Map();
  private sweepInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.config = parseRateLimitConfig();

    // Sweep old entries every 60 seconds
    this.sweepInterval = setInterval(() => this.sweep(), 60_000);
  }

  /**
   * Checks if a tool call is allowed. Returns null if allowed, or an
   * error message string if rate-limited.
   */
  check(toolName: string): string | null {
    const limit = this.config.get(toolName);
    if (!limit) return null; // no limit configured for this tool

    const now = Date.now();
    const windowStart = now - limit.windowMs;

    let entry = this.windows.get(toolName);
    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(toolName, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    if (entry.timestamps.length >= limit.maxRequests) {
      const oldestInWindow = entry.timestamps[0];
      const retryAfterMs = oldestInWindow + limit.windowMs - now;
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);
      return `Rate limit exceeded for ${toolName} — try again in ${retryAfterSec}s (limit: ${limit.maxRequests}/${this.formatWindow(limit.windowMs)})`;
    }

    // Record this request
    entry.timestamps.push(now);
    return null;
  }

  /**
   * Returns current rate limit status for a tool.
   * For unconfigured tools, returns { configured: false }.
   */
  status(toolName: string): { configured: boolean; limit?: number; window?: string; remaining?: number } {
    const limit = this.config.get(toolName);
    if (!limit) return { configured: false };

    const now = Date.now();
    const windowStart = now - limit.windowMs;
    const entry = this.windows.get(toolName);
    const currentCount = entry ? entry.timestamps.filter((t) => t > windowStart).length : 0;

    return {
      configured: true,
      limit: limit.maxRequests,
      window: this.formatWindow(limit.windowMs),
      remaining: Math.max(0, limit.maxRequests - currentCount),
    };
  }

  /**
   * Alias for status() — returns status with windowMs instead of window string.
   */
  getStatus(toolName: string): { limit: number; windowMs: number; remaining: number } {
    const s = this.status(toolName);
    if (!s.configured) return { limit: Infinity, windowMs: 60_000, remaining: Infinity };
    return { limit: s.limit!, windowMs: this.config.get(toolName)!.windowMs, remaining: s.remaining! };
  }

  /**
   * Returns all configured rate limits.
   */
  listConfig(): Array<{ tool: string; maxRequests: number; window: string }> {
    return Array.from(this.config.entries()).map(([tool, cfg]) => ({
      tool,
      maxRequests: cfg.maxRequests,
      window: this.formatWindow(cfg.windowMs),
    }));
  }

  /**
   * Resets the rate limit window for a specific tool.
   */
  reset(toolName: string): void {
    this.windows.delete(toolName);
  }

  /**
   * Cleans up old timestamps from all windows.
   */
  private sweep(): void {
    const now = Date.now();
    for (const [toolName, entry] of this.windows) {
      const limit = this.config.get(toolName);
      if (!limit) {
        this.windows.delete(toolName);
        continue;
      }
      const windowStart = now - limit.windowMs;
      entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
      if (entry.timestamps.length === 0) {
        this.windows.delete(toolName);
      }
    }
  }

  private formatWindow(ms: number): string {
    for (const [name, value] of Object.entries(WINDOW_MAP)) {
      if (value === ms) return name;
    }
    return `${ms}ms`;
  }

  dispose(): void {
    clearInterval(this.sweepInterval);
  }
}
