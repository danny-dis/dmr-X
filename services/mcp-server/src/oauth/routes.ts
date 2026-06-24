/**
 * OAuth 2.1 HTTP Routes for MCP Server
 * 
 * Implements the OAuth 2.0 Authorization Server Metadata (RFC 8414)
 * and MCP Authorization specification endpoints.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { createLogger } from '@dmr-x/utils';

import { getOAuthServer, type OAuthConfig } from './authorize.js';
import { getTokenExchangeService, type TokenExchangeConfig } from './token-exchange.js';

const logger = createLogger('mcp-server:oauth-routes');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OAuthRoutesConfig {
  /** OAuth authorization server config */
  oauth?: OAuthConfig;
  /** Token exchange config */
  tokenExchange?: TokenExchangeConfig;
}

// ---------------------------------------------------------------------------
// OAuth Routes Handler
// ---------------------------------------------------------------------------

/**
 * Handle OAuth-related HTTP requests
 */
export async function handleOAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  config?: OAuthRoutesConfig
): Promise<boolean> {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;

  // Check if this is an OAuth route
  if (!path.startsWith('/oauth/') && path !== '/.well-known/oauth-authorization-server') {
    return false;
  }

  const oauthServer = getOAuthServer(config?.oauth);
  const tokenExchange = getTokenExchangeService(config?.tokenExchange);

  try {
    // RFC 8414: Authorization Server Metadata
    if (path === '/.well-known/oauth-authorization-server' && req.method === 'GET') {
      const metadata = oauthServer.getServerMetadata();
      sendJson(res, 200, metadata);
      return true;
    }

    // RFC 7591: Dynamic Client Registration
    if (path === '/oauth/register' && req.method === 'POST') {
      const body = await readBody(req);
      const client = await oauthServer.registerClient(body);
      sendJson(res, 201, {
        client_id: client.id,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: client.grantTypes,
        response_types: client.responseTypes,
        scope: client.scope,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      });
      return true;
    }

    // Authorization endpoint
    if (path === '/oauth/authorize' && req.method === 'GET') {
      const clientId = url.searchParams.get('client_id');
      const redirectUri = url.searchParams.get('redirect_uri');
      const scope = url.searchParams.get('scope') || 'openid profile email';
      const state = url.searchParams.get('state');
      const codeChallenge = url.searchParams.get('code_challenge');
      const codeChallengeMethod = url.searchParams.get('code_challenge_method');

      if (!clientId || !redirectUri || !state || !codeChallenge) {
        sendJson(res, 400, { error: 'Missing required parameters' });
        return true;
      }

      if (codeChallengeMethod !== 'S256') {
        sendJson(res, 400, { error: 'Only S256 code challenge method is supported' });
        return true;
      }

      // In a real implementation, this would show a consent page
      // For now, we'll auto-approve and redirect
      const { redirectUri: authRedirect } = await oauthServer.handleAuthorization({
        clientId,
        redirectUri,
        scope,
        state,
        codeChallenge,
        codeChallengeMethod,
        userId: 'anonymous', // Would be set from session
      });

      res.writeHead(302, { Location: authRedirect });
      res.end();
      return true;
    }

    // Token endpoint
    if (path === '/oauth/token' && req.method === 'POST') {
      const body = await readBody(req);
      const grantType = body.grant_type;

      if (grantType === 'authorization_code') {
        if (!body.code || !body.client_id || !body.redirect_uri || !body.code_verifier) {
          sendJson(res, 400, { error: 'Missing required parameters' });
          return true;
        }

        const tokenResponse = await oauthServer.exchangeCode({
          code: body.code as string,
          clientId: body.client_id as string,
          redirectUri: body.redirect_uri as string,
          codeVerifier: body.code_verifier as string,
        });

        sendJson(res, 200, tokenResponse);
        return true;
      }

      if (grantType === 'refresh_token') {
        if (!body.refresh_token || !body.client_id) {
          sendJson(res, 400, { error: 'Missing required parameters' });
          return true;
        }

        const tokenResponse = await oauthServer.refreshToken({
          refreshToken: body.refresh_token as string,
          clientId: body.client_id as string,
        });

        sendJson(res, 200, tokenResponse);
        return true;
      }

      sendJson(res, 400, { error: 'Unsupported grant_type' });
      return true;
    }

    // Token revocation endpoint
    if (path === '/oauth/revoke' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.token) {
        sendJson(res, 400, { error: 'Missing token parameter' });
        return true;
      }

      oauthServer.revokeToken(body.token as string);
      sendJson(res, 200, {});
      return true;
    }

    // Token introspection endpoint
    if (path === '/oauth/introspect' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.token) {
        sendJson(res, 400, { error: 'Missing token parameter' });
        return true;
      }

      const tokenSet = oauthServer.validateToken(body.token as string);
      if (tokenSet) {
        sendJson(res, 200, {
          active: true,
          scope: tokenSet.scope,
          client_id: tokenSet.clientId,
          username: tokenSet.userId,
          token_type: 'Bearer',
          exp: Math.floor(tokenSet.expiresAt.getTime() / 1000),
        });
      } else {
        sendJson(res, 200, { active: false });
      }
      return true;
    }

    // User token exchange endpoint
    if (path === '/oauth/exchange' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.user_id || !body.provider) {
        sendJson(res, 400, { error: 'Missing user_id or provider' });
        return true;
      }

      const providerConfig = config?.oauth?.externalProviders?.[body.provider as string];
      if (!providerConfig) {
        sendJson(res, 400, { error: `Unknown provider: ${body.provider}` });
        return true;
      }

      const result = await tokenExchange.exchangeToken({
        userId: body.user_id as string,
        provider: body.provider as string,
        providerConfig,
        userAccessToken: body.user_access_token as string | undefined,
      });

      sendJson(res, 200, result);
      return true;
    }

    // OAuth routes not found
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error, path }, 'OAuth route error');
    sendJson(res, 500, { error: message });
    return true;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString();
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}
