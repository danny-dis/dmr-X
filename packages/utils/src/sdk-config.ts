/**
 * Ported from OpenRouter SDK's config.ts with adaptations for DMR-X.
 *
 * SDK configuration: SDKOptions, serverURLFromOptions(), ServerList, SDK_METADATA.
 */

import type { RetryConfig } from "./retry.js";

// ---------------------------------------------------------------------------
// Minimal local stand-ins for OpenRouter SDK dependencies
// ---------------------------------------------------------------------------

/** Minimal HTTP client interface (replaces OpenRouter SDK's HTTPClient). */
export type HTTPClient = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

/** Minimal logger interface (replaces OpenRouter SDK's Logger). */
export type Logger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

/** Simple path resolver (replaces OpenRouter SDK's pathToFunc from url.ts). */
function pathToFunc(
  basePath: string,
): (params: Record<string, string>) => string {
  return (_params: Record<string, string>) => basePath;
}

// ---------------------------------------------------------------------------
// Server list
// ---------------------------------------------------------------------------

/**
 * Production server
 */
export const ServerProduction = "production";

/**
 * Contains the list of servers available to the SDK
 */
export const ServerList = {
  [ServerProduction]: "https://openrouter.ai/api/v1",
} as const;

// ---------------------------------------------------------------------------
// SDK Options
// ---------------------------------------------------------------------------

export type SDKOptions = {
  apiKey?: string | (() => Promise<string>) | undefined;

  /**
   * Allows setting the httpReferer parameter for all supported operations
   */
  httpReferer?: string | undefined;

  /**
   * Allows setting the appTitle parameter for all supported operations
   */
  appTitle?: string | undefined;

  /**
   * Allows setting the appCategories parameter for all supported operations
   */
  appCategories?: string | undefined;

  httpClient?: HTTPClient;
  /**
   * Allows overriding the default server used by the SDK
   */
  server?: keyof typeof ServerList | undefined;
  /**
   * Allows overriding the default server URL used by the SDK
   */
  serverURL?: string | undefined;
  /**
   * Allows overriding the default user agent used by the SDK
   */
  userAgent?: string | undefined;
  /**
   * Allows overriding the default retry config used by the SDK
   */
  retryConfig?: RetryConfig;
  timeoutMs?: number;
  debugLogger?: Logger;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function serverURLFromOptions(options: SDKOptions): URL | null {
  let serverURL = options.serverURL;

  const params: Record<string, string> = {};

  if (!serverURL) {
    const server = options.server ?? ServerProduction;
    serverURL = ServerList[server] || "";
  }

  const u = pathToFunc(serverURL)(params);
  return new URL(u);
}

export const SDK_METADATA = {
  language: "typescript",
  openapiDocVersion: "1.0.0",
  sdkVersion: "0.12.77",
  genVersion: "2.884.4",
  userAgent: "speakeasy-sdk/typescript 0.12.77 2.884.4 1.0.0 @openrouter/sdk",
} as const;
