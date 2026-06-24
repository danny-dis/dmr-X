/**
 * Token Exchange for per-user authentication
 * 
 * Enables the MCP proxy to exchange user tokens for service-specific tokens
 * when connecting to external MCP servers (GitHub, Jira, etc.)
 * 
 * Based on:
 * - RFC 8693 (OAuth 2.0 Token Exchange)
 * - MCP Authorization spec (March 2025 revision)
 */

import crypto from 'node:crypto';

import { createLogger } from '@dmr-x/utils';

import type { ExternalProviderConfig } from './authorize.js';

const logger = createLogger('mcp-server:token-exchange');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenExchangeConfig {
  /** Enable token exchange */
  enabled?: boolean;
  /** Storage path for per-user tokens */
  storagePath?: string;
  /** Token cache TTL in seconds */
  cacheTtl?: number;
}

export interface UserTokenSet {
  /** User identifier */
  userId: string;
  /** Service provider (e.g., 'github', 'jira') */
  provider: string;
  /** Access token for the service */
  accessToken: string;
  /** Refresh token (if available) */
  refreshToken?: string;
  /** Token expiry */
  expiresAt?: Date;
  /** Scopes granted */
  scopes: string[];
  /** When this token was last used */
  lastUsedAt: Date;
}

export interface TokenExchangeResult {
  /** Exchanged access token */
  accessToken: string;
  /** Token type */
  tokenType: string;
  /** Expiry in seconds */
  expiresIn?: number;
  /** Scopes granted */
  scopes?: string[];
}

// ---------------------------------------------------------------------------
// Token Exchange Service
// ---------------------------------------------------------------------------

/**
 * Token exchange service for per-user authentication
 */
export class TokenExchangeService {
  private userTokens = new Map<string, UserTokenSet>(); // key: `${userId}:${provider}`
  private config: Required<TokenExchangeConfig>;

  constructor(config?: TokenExchangeConfig) {
    this.config = {
      enabled: false,
      storagePath: './data/user-tokens.db',
      cacheTtl: 3600,
      ...config,
    };
  }

  /**
   * Exchange a user's token for a service-specific token
   * 
   * This is used when a user wants to access an external MCP server
   * using their own credentials (e.g., their GitHub token).
   */
  async exchangeToken(params: {
    userId: string;
    provider: string;
    providerConfig: ExternalProviderConfig;
    userAccessToken?: string;
  }): Promise<TokenExchangeResult> {
    const { userId, provider, providerConfig, userAccessToken } = params;

    // Check if we already have a valid token
    const existingToken = this.getUserToken(userId, provider);
    if (existingToken && this.isTokenValid(existingToken)) {
      logger.debug({ userId, provider }, 'Using cached token');
      return {
        accessToken: existingToken.accessToken,
        tokenType: 'Bearer',
        expiresIn: existingToken.expiresAt
          ? Math.floor((existingToken.expiresAt.getTime() - Date.now()) / 1000)
          : undefined,
        scopes: existingToken.scopes,
      };
    }

    // If user provided their own token, store it directly
    if (userAccessToken) {
      const tokenSet: UserTokenSet = {
        userId,
        provider,
        accessToken: userAccessToken,
        scopes: providerConfig.scopes,
        lastUsedAt: new Date(),
      };

      this.storeUserToken(tokenSet);

      return {
        accessToken: userAccessToken,
        tokenType: 'Bearer',
        scopes: providerConfig.scopes,
      };
    }

    // Otherwise, we need to perform token exchange via OAuth
    // This would typically involve redirecting the user to the provider
    // For now, we'll throw an error indicating the user needs to authenticate
    throw new Error(
      `User ${userId} needs to authenticate with ${provider}. ` +
      `Please complete the OAuth flow at ${providerConfig.authorizationUrl}`
    );
  }

  /**
   * Store a user's token for a service
   */
  storeUserToken(tokenSet: UserTokenSet): void {
    const key = `${tokenSet.userId}:${tokenSet.provider}`;
    this.userTokens.set(key, tokenSet);
    logger.debug({ userId: tokenSet.userId, provider: tokenSet.provider }, 'User token stored');
  }

  /**
   * Get a user's token for a service
   */
  getUserToken(userId: string, provider: string): UserTokenSet | null {
    const key = `${userId}:${provider}`;
    return this.userTokens.get(key) || null;
  }

  /**
   * Remove a user's token for a service
   */
  removeUserToken(userId: string, provider: string): boolean {
    const key = `${userId}:${provider}`;
    return this.userTokens.delete(key);
  }

  /**
   * Get all tokens for a user
   */
  getUserTokens(userId: string): UserTokenSet[] {
    const tokens: UserTokenSet[] = [];
    for (const [key, token] of this.userTokens) {
      if (key.startsWith(`${userId}:`)) {
        tokens.push(token);
      }
    }
    return tokens;
  }

  /**
   * Refresh a user's token
   */
  async refreshToken(params: {
    userId: string;
    provider: string;
    providerConfig: ExternalProviderConfig;
  }): Promise<TokenExchangeResult> {
    const { userId, provider, providerConfig } = params;
    const existingToken = this.getUserToken(userId, provider);

    if (!existingToken?.refreshToken) {
      throw new Error(`No refresh token available for user ${userId} on ${provider}`);
    }

    // Perform refresh token exchange
    const response = await fetch(providerConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: existingToken.refreshToken,
        client_id: providerConfig.clientId,
        client_secret: providerConfig.clientSecret,
      }).toString(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Token refresh failed (${response.status}): ${text}`);
    }

    const data = await response.json() as Record<string, unknown>;

    const newTokenSet: UserTokenSet = {
      userId,
      provider,
      accessToken: data.access_token as string,
      refreshToken: (data.refresh_token as string) || existingToken.refreshToken,
      expiresAt: data.expires_in
        ? new Date(Date.now() + (data.expires_in as number) * 1000)
        : undefined,
      scopes: existingToken.scopes,
      lastUsedAt: new Date(),
    };

    this.storeUserToken(newTokenSet);

    logger.info({ userId, provider }, 'Token refreshed');

    return {
      accessToken: newTokenSet.accessToken,
      tokenType: 'Bearer',
      expiresIn: data.expires_in as number | undefined,
      scopes: newTokenSet.scopes,
    };
  }

  /**
   * Validate a user token
   */
  validateUserToken(userId: string, provider: string): boolean {
    const token = this.getUserToken(userId, provider);
    return token !== null && this.isTokenValid(token);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalTokens: number;
    tokensByProvider: Record<string, number>;
    expiredTokens: number;
  } {
    const tokensByProvider: Record<string, number> = {};
    let expiredTokens = 0;

    for (const token of this.userTokens.values()) {
      tokensByProvider[token.provider] = (tokensByProvider[token.provider] || 0) + 1;
      if (!this.isTokenValid(token)) {
        expiredTokens++;
      }
    }

    return {
      totalTokens: this.userTokens.size,
      tokensByProvider,
      expiredTokens,
    };
  }

  /**
   * Clean up expired tokens
   */
  cleanupExpired(): number {
    let cleaned = 0;
    for (const [key, token] of this.userTokens) {
      if (!this.isTokenValid(token)) {
        this.userTokens.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  private isTokenValid(token: UserTokenSet): boolean {
    if (!token.expiresAt) return true;
    return token.expiresAt > new Date();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: TokenExchangeService | null = null;

export function getTokenExchangeService(config?: TokenExchangeConfig): TokenExchangeService {
  if (!instance) {
    instance = new TokenExchangeService(config);
  }
  return instance;
}

export function resetTokenExchangeService(): void {
  instance = null;
}
