/**
 * OAuth 2.1 Authorization Server for MCP
 * 
 * Implements the MCP Authorization specification:
 * - OAuth 2.1 with mandatory PKCE
 * - Dynamic Client Registration (RFC 7591)
 * - Authorization Server Metadata (RFC 8414)
 * - Token exchange for per-user authentication
 * 
 * Based on MCP spec (March 2025 revision)
 */

import crypto from 'node:crypto';

import { createLogger } from '@dmr-x/utils';

const logger = createLogger('mcp-server:oauth');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthConfig {
  /** Enable OAuth 2.1 authorization server */
  enabled?: boolean;
  /** Issuer URL for the authorization server */
  issuer?: string;
  /** Storage backend for tokens and clients */
  storage?: 'sqlite' | 'memory';
  /** SQLite database path (if storage is sqlite) */
  storagePath?: string;
  /** Access token expiry in seconds */
  accessTokenExpiry?: number;
  /** Refresh token expiry in seconds */
  refreshTokenExpiry?: number;
  /** Authorization code expiry in seconds */
  authorizationCodeExpiry?: number;
  /** External OAuth providers for token exchange */
  externalProviders?: Record<string, ExternalProviderConfig>;
}

export interface ExternalProviderConfig {
  /** OAuth 2.0 client ID */
  clientId: string;
  /** OAuth 2.0 client secret */
  clientSecret: string;
  /** Authorization URL */
  authorizationUrl: string;
  /** Token URL */
  tokenUrl: string;
  /** Scopes to request */
  scopes: string[];
  /** Whether to use PKCE */
  usePKCE?: boolean;
}

export interface RegisteredClient {
  id: string;
  name: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  scope: string;
  createdAt: Date;
}

export interface AuthorizationCode {
  code: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: Date;
  userId?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
  userId?: string;
  clientId: string;
}

// ---------------------------------------------------------------------------
// PKCE Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random code verifier
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate a code challenge from a code verifier using SHA-256
 */
export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ---------------------------------------------------------------------------
// Authorization Server
// ---------------------------------------------------------------------------

/**
 * OAuth 2.1 Authorization Server for MCP
 */
export class OAuthAuthorizationServer {
  private config: Required<OAuthConfig>;
  private clients = new Map<string, RegisteredClient>();
  private authorizationCodes = new Map<string, AuthorizationCode>();
  private tokens = new Map<string, TokenSet>();
  private codeVerifiers = new Map<string, string>(); // state -> codeVerifier

  constructor(config?: OAuthConfig) {
    this.config = {
      enabled: false,
      // Must match the port the MCP server actually listens on, since the
      // issuer is echoed in discovery metadata and validated by clients.
      issuer: 'http://localhost:47114',
      storage: 'memory',
      storagePath: './data/oauth.db',
      accessTokenExpiry: 3600, // 1 hour
      refreshTokenExpiry: 2592000, // 30 days
      authorizationCodeExpiry: 600, // 10 minutes
      externalProviders: {},
      ...config,
    };
  }

  /**
   * Get OAuth 2.0 Authorization Server Metadata (RFC 8414)
   */
  getServerMetadata(): Record<string, unknown> {
    return {
      issuer: this.config.issuer,
      authorization_endpoint: `${this.config.issuer}/oauth/authorize`,
      token_endpoint: `${this.config.issuer}/oauth/token`,
      registration_endpoint: `${this.config.issuer}/oauth/register`,
      scopes_supported: ['openid', 'profile', 'email', 'mcp:tools'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
      service_documentation: 'https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization',
      revocation_endpoint: `${this.config.issuer}/oauth/revoke`,
    };
  }

  /**
   * Register a new client (RFC 7591 - Dynamic Client Registration)
   */
  async registerClient(body: {
    client_name?: string;
    redirect_uris?: string[];
    grant_types?: string[];
    response_types?: string[];
    scope?: string;
  }): Promise<RegisteredClient> {
    const client: RegisteredClient = {
      id: crypto.randomUUID(),
      name: body.client_name || 'Unknown Client',
      redirectUris: body.redirect_uris || [],
      grantTypes: body.grant_types || ['authorization_code'],
      responseTypes: body.response_types || ['code'],
      scope: body.scope || 'openid profile email',
      createdAt: new Date(),
    };

    this.clients.set(client.id, client);
    logger.info({ clientId: client.id, name: client.name }, 'Client registered');

    return client;
  }

  /**
   * Generate an authorization URL with PKCE
   */
  generateAuthorizationUrl(params: {
    clientId: string;
    redirectUri: string;
    scope?: string;
    state?: string;
  }): { authorizationUrl: string; state: string } {
    const client = this.clients.get(params.clientId);
    if (!client) {
      throw new Error('Invalid client_id');
    }

    if (!client.redirectUris.includes(params.redirectUri)) {
      throw new Error('Invalid redirect_uri');
    }

    const state = params.state || crypto.randomBytes(16).toString('hex');
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Store code verifier for later validation
    this.codeVerifiers.set(state, codeVerifier);

    const paramsObj = new URLSearchParams({
      response_type: 'code',
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      state,
      scope: params.scope || 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authorizationUrl = `${this.config.issuer}/oauth/authorize?${paramsObj.toString()}`;

    return { authorizationUrl, state };
  }

  /**
   * Handle authorization request and generate code
   */
  async handleAuthorization(params: {
    clientId: string;
    redirectUri: string;
    scope: string;
    state: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    userId?: string;
  }): Promise<{ code: string; redirectUri: string }> {
    const client = this.clients.get(params.clientId);
    if (!client) {
      throw new Error('Invalid client_id');
    }

    if (params.codeChallengeMethod !== 'S256') {
      throw new Error('Only S256 code challenge method is supported');
    }

    const code = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.config.authorizationCodeExpiry * 1000);

    const authCode: AuthorizationCode = {
      code,
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      scope: params.scope,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
      expiresAt,
      userId: params.userId,
    };

    this.authorizationCodes.set(code, authCode);
    logger.info({ clientId: params.clientId, userId: params.userId }, 'Authorization code issued');

    const redirectUri = new URL(params.redirectUri);
    redirectUri.searchParams.set('code', code);
    redirectUri.searchParams.set('state', params.state);

    return { code, redirectUri: redirectUri.toString() };
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(params: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<TokenResponse> {
    const authCode = this.authorizationCodes.get(params.code);
    if (!authCode) {
      throw new Error('Invalid authorization code');
    }

    if (authCode.expiresAt < new Date()) {
      this.authorizationCodes.delete(params.code);
      throw new Error('Authorization code expired');
    }

    if (authCode.clientId !== params.clientId) {
      throw new Error('Client ID mismatch');
    }

    if (authCode.redirectUri !== params.redirectUri) {
      throw new Error('Redirect URI mismatch');
    }

    // Validate PKCE
    if (!params.codeVerifier) {
      throw new Error('code_verifier is required');
    }

    const expectedChallenge = generateCodeChallenge(params.codeVerifier);
    if (expectedChallenge !== authCode.codeChallenge) {
      throw new Error('Invalid code_verifier');
    }

    // Generate tokens
    const accessToken = crypto.randomBytes(32).toString('hex');
    const refreshToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.config.accessTokenExpiry * 1000);

    const tokenSet: TokenSet = {
      accessToken,
      refreshToken,
      expiresAt,
      scope: authCode.scope,
      userId: authCode.userId,
      clientId: params.clientId,
    };

    this.tokens.set(accessToken, tokenSet);

    // Clean up authorization code
    this.authorizationCodes.delete(params.code);

    logger.info({ clientId: params.clientId, userId: authCode.userId }, 'Tokens issued');

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.config.accessTokenExpiry,
      refresh_token: refreshToken,
      scope: authCode.scope,
    };
  }

  /**
   * Refresh an access token
   */
  async refreshToken(params: {
    refreshToken: string;
    clientId: string;
  }): Promise<TokenResponse> {
    // Find token set by refresh token
    let tokenSet: TokenSet | null = null;
    for (const ts of this.tokens.values()) {
      if (ts.refreshToken === params.refreshToken) {
        tokenSet = ts;
        break;
      }
    }

    if (!tokenSet) {
      throw new Error('Invalid refresh token');
    }

    if (tokenSet.clientId !== params.clientId) {
      throw new Error('Client ID mismatch');
    }

    // Generate new tokens
    const newAccessToken = crypto.randomBytes(32).toString('hex');
    const newRefreshToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.config.accessTokenExpiry * 1000);

    const newTokenSet: TokenSet = {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresAt,
      scope: tokenSet.scope,
      userId: tokenSet.userId,
      clientId: params.clientId,
    };

    // Remove old token and add new one
    this.tokens.delete(tokenSet.accessToken);
    this.tokens.set(newAccessToken, newTokenSet);

    logger.info({ clientId: params.clientId }, 'Token refreshed');

    return {
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: this.config.accessTokenExpiry,
      refresh_token: newRefreshToken,
      scope: tokenSet.scope,
    };
  }

  /**
   * Validate an access token
   */
  validateToken(accessToken: string): TokenSet | null {
    const tokenSet = this.tokens.get(accessToken);
    if (!tokenSet) {
      return null;
    }

    if (tokenSet.expiresAt < new Date()) {
      this.tokens.delete(accessToken);
      return null;
    }

    return tokenSet;
  }

  /**
   * Revoke a token
   */
  revokeToken(token: string): boolean {
    // Try to find and remove by access token
    if (this.tokens.has(token)) {
      this.tokens.delete(token);
      return true;
    }

    // Try to find by refresh token
    for (const [accessToken, tokenSet] of this.tokens) {
      if (tokenSet.refreshToken === token) {
        this.tokens.delete(accessToken);
        return true;
      }
    }

    return false;
  }

  /**
   * Get client info
   */
  getClient(clientId: string): RegisteredClient | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Get server statistics
   */
  getStats(): {
    clientCount: number;
    activeTokens: number;
    pendingAuthorizations: number;
  } {
    return {
      clientCount: this.clients.size,
      activeTokens: this.tokens.size,
      pendingAuthorizations: this.authorizationCodes.size,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: OAuthAuthorizationServer | null = null;

export function getOAuthServer(config?: OAuthConfig): OAuthAuthorizationServer {
  if (!instance) {
    instance = new OAuthAuthorizationServer(config);
  }
  return instance;
}

export function resetOAuthServer(): void {
  instance = null;
}
