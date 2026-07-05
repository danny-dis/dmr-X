import type { FastifyInstance } from 'fastify';
import { PROVIDER_CATALOG } from '@dmr-x/registry';
import { encrypt, decrypt, logger } from '@dmr-x/utils';

export function registerOAuthRefresh(
  server: FastifyInstance,
  db: any,
  adapterRegistry: any,
): { oauthRefreshTimer: ReturnType<typeof setTimeout> | null } {
  // Background OAuth token refresh — check every 5 minutes.
  // Uses recursive setTimeout instead of setInterval to avoid overlapping
  // executions if a cycle takes longer than the interval. Providers are
  // refreshed in parallel so one slow/hanging provider doesn't block others.
  const OAUTH_REFRESH_INTERVAL = 5 * 60 * 1000;
  let oauthRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  const refreshOAuthTokens = async () => {
    try {
      const rows = db.prepare(
        `SELECT id, name, oauth_refresh_token, oauth_token_expires_at
         FROM providers
         WHERE auth_method = 'oauth'
         AND oauth_token_expires_at IS NOT NULL
         AND oauth_refresh_token IS NOT NULL`
      ).all() as any[];

      const refreshPromises = rows.map(async (row) => {
        const expiresAt = new Date(row.oauth_token_expires_at);
        const bufferMs = 5 * 60 * 1000; // refresh 5 minutes before expiry
        if (expiresAt.getTime() >= Date.now() + bufferMs) return;

        const template = PROVIDER_CATALOG.find(t => t.id === row.name);
        if (!template?.oauthConfig) return;

        try {
          const { OAuthService } = await import('@dmr-x/oauth');
          const oauthService = new OAuthService();
          let refreshToken: string;
          try {
            refreshToken = decrypt(row.oauth_refresh_token);
          } catch (err) {
            logger.warn({ provider: row.name, err }, 'Failed to decrypt OAuth refresh token, using as plaintext');
            refreshToken = row.oauth_refresh_token;
          }
          const newTokens = await oauthService.refreshAccessToken(template.oauthConfig, refreshToken);

          const encAccess = encrypt(newTokens.accessToken);
          const encRefresh = newTokens.refreshToken ? encrypt(newTokens.refreshToken) : row.oauth_refresh_token;
          db.prepare(
            `UPDATE providers SET oauth_access_token = ?, oauth_refresh_token = ?, oauth_token_expires_at = ?, updated_at = datetime('now') WHERE id = ?`
          ).run(encAccess, encRefresh, newTokens.expiresAt?.toISOString() || null, row.id);

          // Re-initialize adapter
          const adapter = adapterRegistry.get(row.name);
          if (adapter) {
            const providerRow = db.prepare('SELECT base_url FROM providers WHERE id = ?').get(row.id) as any;
            if (providerRow?.base_url) {
              await adapterRegistry.initialize(row.name, {
                baseUrl: providerRow.base_url,
                accessToken: newTokens.accessToken,
                authMethod: 'oauth',
              });
            }
          }

          logger.info({ provider: row.name }, 'Refreshed OAuth token (background)');
        } catch (err) {
          logger.warn({ provider: row.name, err }, 'Failed to refresh OAuth token (background)');
        }
      });

      await Promise.allSettled(refreshPromises);
    } catch (err) {
      logger.warn({ err }, 'OAuth token refresh check failed');
    }
  };

  const scheduleOAuthRefresh = () => {
    oauthRefreshTimer = setTimeout(async () => {
      await refreshOAuthTokens();
      scheduleOAuthRefresh();
    }, OAUTH_REFRESH_INTERVAL);
    oauthRefreshTimer.unref();
  };
  scheduleOAuthRefresh();

  return { oauthRefreshTimer };
}
