/**
 * OAuth 2.1 module for MCP Server
 * 
 * Provides OAuth 2.1 authorization server with:
 * - PKCE support (mandatory per MCP spec)
 * - Dynamic Client Registration (RFC 7591)
 * - Authorization Server Metadata (RFC 8414)
 * - Token exchange for per-user authentication
 */

export {
  OAuthAuthorizationServer,
  getOAuthServer,
  resetOAuthServer,
  generateCodeVerifier,
  generateCodeChallenge,
  type OAuthConfig,
  type RegisteredClient,
  type AuthorizationCode,
  type TokenResponse,
  type TokenSet,
  type ExternalProviderConfig,
} from './authorize.js';

export {
  TokenExchangeService,
  getTokenExchangeService,
  resetTokenExchangeService,
  type TokenExchangeConfig,
  type UserTokenSet,
  type TokenExchangeResult,
} from './token-exchange.js';

export { handleOAuthRoutes, type OAuthRoutesConfig } from './routes.js';
