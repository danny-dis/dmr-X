/**
 * Error classification utilities for connection, timeout, and abort errors.
 * Ported from OpenRouter SDK's HTTP utilities.
 *
 * Handles heuristics across Node.js, Bun, Deno, and browser runtimes.
 */
/**
 * Check if an error is a connection error (ECONNRESET, "Failed to fetch", etc.)
 */
export function isConnectionError(err) {
    if (typeof err !== 'object' || err == null)
        return false;
    // Browser / Deno fetch
    const isBrowserErr = err instanceof TypeError &&
        err.message.toLowerCase().startsWith('failed to fetch');
    // Node.js fetch
    const isNodeErr = err instanceof TypeError &&
        err.message.toLowerCase().startsWith('fetch failed');
    // Bun
    const isBunErr = 'name' in err && err.name === 'ConnectionError';
    // Generic (Node.js http, Axios)
    const isGenericErr = 'code' in err &&
        typeof err.code === 'string' &&
        err.code.toLowerCase() === 'econnreset';
    return isBrowserErr || isNodeErr || isGenericErr || isBunErr;
}
/**
 * Check if an error is a timeout error.
 */
export function isTimeoutError(err) {
    if (typeof err !== 'object' || err == null)
        return false;
    // Native (fetch in browser, Node.js, Bun, Deno)
    const isNative = 'name' in err && err.name === 'TimeoutError';
    const isLegacyNative = 'code' in err && err.code === 23;
    // Node.js HTTP client and Axios
    const isGenericErr = 'code' in err &&
        typeof err.code === 'string' &&
        err.code.toLowerCase() === 'econnaborted';
    return isNative || isLegacyNative || isGenericErr;
}
/**
 * Check if an error is an abort error.
 */
export function isAbortError(err) {
    if (typeof err !== 'object' || err == null)
        return false;
    const isNative = 'name' in err && err.name === 'AbortError';
    const isLegacyNative = 'code' in err && err.code === 20;
    const isGenericErr = 'code' in err &&
        typeof err.code === 'string' &&
        err.code.toLowerCase() === 'econnaborted';
    return isNative || isLegacyNative || isGenericErr;
}
//# sourceMappingURL=error-classifiers.js.map