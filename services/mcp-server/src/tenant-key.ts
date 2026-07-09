/**
 * Per-client gateway key resolution for tenant isolation.
 *
 * External MCP clients can pass an `X-DMR-Tenant-Key` HTTP header (hermes-style,
 * like X-Hermes-Session-Key). When present and non-empty it is used as the
 * gateway Bearer token for that client's requests, isolating the client into
 * its own gateway tenant. When absent, we fall back to DMRX_MCP_AGENT_API_KEY
 * (the legacy shared tenant). If neither is set, a best-effort auto-provisioned
 * key (see autoProvisionTenantKey) is used.
 */

import { logger } from '@dmr-x/utils';

export const DMR_TENANT_KEY_HEADER = 'x-dmr-tenant-key';

export type RequestHeaders = Record<string, string | string[] | undefined>;

/**
 * Best-effort auto-provisioned tenant API key. Populated by
 * `autoProvisionTenantKey()` (a fire-and-forget IIFE at server startup).
 */
let autoProvisionedKey: string | undefined;

/** Captures the headers of the most recent inbound MCP HTTP request. */
let lastRequestHeaders: RequestHeaders | undefined;

/** Notified once auto-provisioning resolves (succeeds or fails). */
const provisionWaiters: Array<(key: string | undefined) => void> = [];
let provisionResolved = false;

export function setLastRequestHeaders(headers: RequestHeaders | undefined): void {
  lastRequestHeaders = headers;
}

export function getLastRequestHeaders(): RequestHeaders | undefined {
  return lastRequestHeaders;
}

export function setAutoProvisionedKey(key: string | undefined): void {
  if (autoProvisionedKey === undefined && key !== undefined) {
    autoProvisionedKey = key;
  }
  provisionResolved = true;
  while (provisionWaiters.length) {
    provisionWaiters.shift()?.(autoProvisionedKey);
  }
}

export function getAutoProvisionedKey(): string | undefined {
  return autoProvisionedKey;
}

/**
 * Resolve the gateway key for a request.
 *
 * Order:
 *   1. Incoming request's `X-DMR-Tenant-Key` header (per-client isolation).
 *   2. Config/env `DMRX_MCP_AGENT_API_KEY` (legacy shared tenant).
 *   3. Best-effort auto-provisioned tenant key (see autoProvisionTenantKey).
 *
 * @param requestHeaders Optional per-request headers. If omitted, the most
 *   recently captured request headers are used (fallback for call sites that
 *   cannot access the inbound request directly).
 */
export function resolveGatewayKey(requestHeaders?: RequestHeaders): string | undefined {
  const headers = requestHeaders ?? lastRequestHeaders;
  const tenantKeyHeader = headers?.[DMR_TENANT_KEY_HEADER];
  const tenantKey = Array.isArray(tenantKeyHeader) ? tenantKeyHeader[0] : tenantKeyHeader;
  if (tenantKey && typeof tenantKey === 'string' && tenantKey.trim().length > 0) {
    return tenantKey.trim();
  }

  const configuredKey = process.env.DMRX_MCP_AGENT_API_KEY;
  if (configuredKey && configuredKey.trim().length > 0) {
    return configuredKey.trim();
  }

  return autoProvisionedKey;
}

/**
 * Best-effort zero-config tenant provisioning.
 *
 * If neither X-DMR-Tenant-Key nor DMRX_MCP_AGENT_API_KEY is available, create a
 * dedicated tenant + API key via the gateway admin API so the server isn't
 * multi-tenant-sharing. Non-fatal: if the gateway is unreachable or lacks admin
 * credentials, log a warning and continue (downstream reports "agent key not
 * configured" as before).
 *
 * Must be called as a fire-and-forget async IIFE — must NOT make
 * createDMRXMcpServer async.
 */
export function autoProvisionTenantKey(gatewayUrl: string): void {
  void (async () => {
    try {
      if (process.env.DMRX_MCP_AGENT_API_KEY || autoProvisionedKey) {
        setAutoProvisionedKey(autoProvisionedKey);
        return;
      }
      const adminKey = process.env.DMRX_ADMIN_API_KEY;
      if (!adminKey) {
        logger.warn(
          { gatewayUrl },
          'Tenant isolation: no DMRX_MCP_AGENT_API_KEY, X-DMR-Tenant-Key, or DMRX_ADMIN_API_KEY set — ' +
            'cannot auto-provision a tenant. Per-client isolation will be unavailable until configured.'
        );
        setAutoProvisionedKey(undefined);
        return;
      }

      const tenantName = `mcp-auto-${crypto.randomUUID().slice(0, 8)}`;
      const createTenantRes = await fetch(`${gatewayUrl}/admin/tenants`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': adminKey },
        body: JSON.stringify({ name: tenantName }),
      });
      if (!createTenantRes.ok) {
        logger.warn(
          { status: createTenantRes.status, gatewayUrl },
          'Tenant isolation: failed to auto-create tenant via gateway admin API.'
        );
        setAutoProvisionedKey(undefined);
        return;
      }
      const tenant: any = await createTenantRes.json();
      const tenantId: string | undefined = tenant?.id;
      if (!tenantId) {
        logger.warn({ gatewayUrl }, 'Tenant isolation: gateway returned no tenant id.');
        setAutoProvisionedKey(undefined);
        return;
      }

      const createKeyRes = await fetch(`${gatewayUrl}/admin/api-keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': adminKey },
        body: JSON.stringify({ tenant_id: tenantId, name: 'mcp-server-auto' }),
      });
      if (!createKeyRes.ok) {
        logger.warn(
          { status: createKeyRes.status, gatewayUrl },
          'Tenant isolation: failed to auto-create API key via gateway admin API.'
        );
        setAutoProvisionedKey(undefined);
        return;
      }
      const keyJson: any = await createKeyRes.json();
      const apiKey: string | undefined = keyJson?.key;
      if (!apiKey) {
        logger.warn({ gatewayUrl }, 'Tenant isolation: gateway returned no API key.');
        setAutoProvisionedKey(undefined);
        return;
      }
      setAutoProvisionedKey(apiKey);
      logger.info(
        { tenantId, gatewayUrl },
        'Tenant isolation: auto-provisioned a dedicated tenant + API key for this MCP server.'
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), gatewayUrl },
        'Tenant isolation: auto-provisioning failed (continuing with no key).'
      );
      setAutoProvisionedKey(undefined);
    }
  })();
}
