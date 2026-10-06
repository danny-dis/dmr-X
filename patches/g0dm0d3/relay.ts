/**
 * Relay mode.
 *
 * When G0DM0D3 runs as DMR-X's internal proxy it must not talk to OpenRouter
 * directly — it forwards to whatever OpenAI-compatible endpoint DMR-X hands it
 * (normally the DMR-X gateway itself), so the host's provider vault, routing,
 * and key rotation stay in charge.
 *
 * DMR-X already sets these on the child process; nothing here is hardcoded:
 *   G0DM0D3_LLM_BASE_URL  OpenAI-compatible base, e.g. http://localhost:47113/v1
 *   G0DM0D3_LLM_API_KEY   bearer for that base (may be empty in local mode)
 *   GODMODE_RELAY=1       marks the process as an internal relay
 *
 * Without this the server required OPENROUTER_API_KEY unconditionally and
 * every relayed request failed with `missing_api_key`.
 */

export function isRelayMode(): boolean {
  return process.env.GODMODE_RELAY === '1' || !!process.env.G0DM0D3_LLM_BASE_URL;
}

/** Base URL for upstream chat completions, without a trailing slash. */
export function relayBaseUrl(): string {
  const base = (process.env.G0DM0D3_LLM_BASE_URL || '').replace(/\/+$/, '');
  if (base) {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || /(^|\.)openrouter\.ai$/i.test(url.hostname)) {
      throw new Error('DMR-X relay must use the host gateway, not direct OpenRouter');
    }
  }
  return base;
}

/** Full chat/completions URL for the active upstream. */
export function chatCompletionsUrl(): string {
  const base = relayBaseUrl();
  if (base) {
    return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  }
  if (isRelayMode()) {
    throw new Error('DMR-X relay base URL is required (G0DM0D3_LLM_BASE_URL)');
  }
  return 'https://openrouter.ai/api/v1/chat/completions';
}

/**
 * Bearer to send upstream. In relay mode this is the DMR-X key (often empty
 * when the gateway runs in LOCAL MODE), otherwise the caller/env OpenRouter key.
 */
export function upstreamApiKey(callerKey?: string): string {
  if (isRelayMode()) {
    // Empty is intentional in local mode. Provider credentials must never
    // leak into the host gateway's authentication boundary.
    return process.env.G0DM0D3_LLM_API_KEY || '';
  }
  return callerKey || process.env.OPENROUTER_API_KEY || '';
}

/**
 * True when a request can proceed without an OpenRouter key. Relay mode has
 * its own upstream, so the OpenRouter-key requirement does not apply.
 */
export function hasUsableUpstream(callerKey?: string): boolean {
  if (isRelayMode()) return !!relayBaseUrl();
  return !!(callerKey || process.env.OPENROUTER_API_KEY);
}

/** Headers for the upstream call. OpenRouter attribution is skipped on relay. */
export function upstreamHeaders(callerKey?: string): Record<string, string> {
  const key = upstreamApiKey(callerKey);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;
  if (isRelayMode()) {
    // The internal proxy must not re-enter wrapping or escape the free pool.
    headers['X-DMRX-Godmode-Proxy'] = '1';
    headers['X-Cost-Filter'] = 'free';
    headers['X-Free-Tier-Strategy'] = 'free_only';
  } else {
    headers['HTTP-Referer'] = 'https://godmod3.ai';
    headers['X-Title'] = 'GODMOD3.AI';
  }
  return headers;
}
