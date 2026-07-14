import type { MCPClient, MCPServerConfig } from '@dmr-x/mcp-client';

/**
 * Live-reconcile upstream aggregation-server connections against a desired list.
 * Disconnects servers dropped from config and connects newly added ones.
 * Shared by the config-file watcher and the runnable reload check so the
 * reconnect behavior is defined in exactly one place.
 *
 * ponytail: single source of truth for hot-reload reconnect; no new deps.
 */
export async function reconcileAggregationServers(
  client: MCPClient,
  knownServerIds: Set<string>,
  desiredServers: MCPServerConfig[],
): Promise<Set<string>> {
  const desiredIds = new Set(desiredServers.map((s) => s.id));

  // Disconnect servers no longer in config
  for (const id of knownServerIds) {
    if (!desiredIds.has(id) && client.listServers().includes(id)) {
      try {
        await client.disconnectServer(id);
        console.error(`[config-watcher] Disconnected server: ${id}`);
      } catch (err) {
        console.error(`[config-watcher] Error disconnecting server ${id}:`, err);
      }
    }
  }

  // Connect new servers from config
  for (const serverCfg of desiredServers) {
    if (!knownServerIds.has(serverCfg.id) && !client.listServers().includes(serverCfg.id)) {
      try {
        await client.connectServer(serverCfg);
        console.error(`[config-watcher] Connected server: ${serverCfg.id}`);
      } catch (err) {
        console.error(`[config-watcher] Error connecting server ${serverCfg.id}:`, err);
      }
    }
  }

  return desiredIds;
}
