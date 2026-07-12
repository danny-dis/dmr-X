/**
 * Federation Manager for Multi-Instance Tool Sharing
 * 
 * Enables multiple DMR-X instances to discover and share tools
 * across a network using mDNS/DNS-SD or static configuration.
 * 
 * Features:
 * - Instance discovery via mDNS or static config
 * - Tool synchronization across instances
 * - Health monitoring and failover
 * - Load balancing across federated instances
 */

import { createLogger } from '@dmr-x/utils';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const logger = createLogger('mcp-server:federation');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FederationConfig {
  /** Enable federation */
  enabled?: boolean;
  /** Instance ID (unique identifier for this instance) */
  instanceId?: string;
  /** Instance name (human-readable name) */
  instanceName?: string;
  /** Discovery method: 'mdns', 'static', or 'consul' */
  discoveryMethod?: 'mdns' | 'static' | 'consul';
  /** Static peers (for static discovery) */
  peers?: FederationPeer[];
  /** mDNS service name (for mDNS discovery) */
  mdnsServiceName?: string;
  /** mDNS service type (for mDNS discovery) */
  mdnsServiceType?: string;
  /** Sync interval in seconds */
  syncInterval?: number;
  /** Heartbeat interval in seconds */
  heartbeatInterval?: number;
  /** Peer timeout in seconds */
  peerTimeout?: number;
  /** Enable tool proxying from remote instances */
  enableToolProxy?: boolean;
  /** Maximum remote tools to proxy */
  maxRemoteTools?: number;
}

export interface FederationPeer {
  /** Peer instance ID */
  id: string;
  /** Peer name */
  name: string;
  /** Peer URL */
  url: string;
  /** Peer capabilities */
  capabilities?: string[];
  /** Health status */
  healthy?: boolean;
  /** Last seen timestamp */
  lastSeen?: string;
  /** Latency in ms */
  latencyMs?: number;
}

export interface FederatedTool {
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** Source instance ID */
  instanceId: string;
  /** Source instance name */
  instanceName: string;
  /** Tool modality */
  modality?: string;
  /** Latency to reach this tool */
  latencyMs?: number;
}

export interface FederationState {
  /** Local instance ID */
  instanceId: string;
  /** Local instance name */
  instanceName: string;
  /** Known peers */
  peers: Map<string, FederationPeer>;
  /** Remote tools discovered */
  remoteTools: Map<string, FederatedTool>;
  /** Last sync timestamp */
  lastSync?: string;
  /** Connection pool for peer MCP clients */
  connectionPool: Map<string, PeerConnection>;
}

export interface PeerConnection {
  /** Peer instance ID */
  peerId: string;
  /** MCP Client instance */
  client: Client;
  /** When the connection was established */
  connectedAt: Date;
  /** Whether the connection is currently active */
  active: boolean;
}

// ---------------------------------------------------------------------------
// Federation Manager
// ---------------------------------------------------------------------------

/**
 * Federation Manager for multi-instance tool sharing
 */
export class FederationManager {
  private config: Required<FederationConfig>;
  private state: FederationState;
  private syncTimer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor(config?: FederationConfig) {
    this.config = {
      enabled: false,
      instanceId: crypto.randomUUID(),
      instanceName: `DMR-X-${Date.now()}`,
      discoveryMethod: 'static',
      peers: [],
      mdnsServiceName: 'dmrx-mcp',
      mdnsServiceType: '_mcp._tcp',
      syncInterval: 30,
      heartbeatInterval: 10,
      peerTimeout: 60,
      enableToolProxy: true,
      maxRemoteTools: 100,
      ...config,
    };

    this.state = {
      instanceId: this.config.instanceId,
      instanceName: this.config.instanceName,
      peers: new Map(),
      remoteTools: new Map(),
      connectionPool: new Map(),
    };

    // Add static peers
    for (const peer of this.config.peers) {
      this.state.peers.set(peer.id, peer);
    }
  }

  /**
   * Start federation services
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      logger.info('Federation disabled');
      return;
    }

    logger.info({
      instanceId: this.config.instanceId,
      instanceName: this.config.instanceName,
      discoveryMethod: this.config.discoveryMethod,
      peerCount: this.config.peers.length,
    }, 'Starting federation manager');

    // Start discovery
    await this.startDiscovery();

    // Start periodic sync
    this.syncTimer = setInterval(
      () => this.syncPeers(),
      this.config.syncInterval * 1000
    );

    // Start heartbeat
    this.heartbeatTimer = setInterval(
      () => this.sendHeartbeat(),
      this.config.heartbeatInterval * 1000
    );

    // Initial sync
    await this.syncPeers();
  }

  /**
   * Stop federation services
   */
  async stop(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    await this.closeAllConnections();
    logger.info('Federation manager stopped');
  }

  /**
   * Start discovery based on configured method
   */
  private async startDiscovery(): Promise<void> {
    switch (this.config.discoveryMethod) {
      case 'mdns':
        await this.startMDNSDiscovery();
        break;
      case 'static':
        // Static peers already loaded in constructor
        logger.info({ peerCount: this.state.peers.size }, 'Static peers loaded');
        break;
      case 'consul':
        await this.startConsulDiscovery();
        break;
    }
  }

  /**
   * Start mDNS discovery
   */
  private async startMDNSDiscovery(): Promise<void> {
    try {
      // Dynamic import for mDNS (optional dependency)
      // Note: mdns package needs to be installed separately if mDNS discovery is needed
      let mdns: any;
      try {
        // mdns is an optional peer dependency, so resolve it dynamically
        // without static module resolution (casting the specifier to string).
        mdns = await import('mdns' as string);
      } catch {
        logger.warn('mDNS module not available, falling back to static discovery');
        this.config.discoveryMethod = 'static';
        return;
      }
      
      if (!mdns?.createBrowser) {
        logger.warn('mDNS module invalid, falling back to static discovery');
        this.config.discoveryMethod = 'static';
        return;
      }
      
      const browser = mdns.createBrowser(
        mdns.tcp(this.config.mdnsServiceType)
      );

      browser.on('serviceUp', (service: any) => {
        logger.info({ service: service.name }, 'Discovered peer via mDNS');
        this.addPeer({
          id: service.name,
          name: service.name,
          url: `http://${service.host}:${service.port}`,
          capabilities: service.txtRecord?.capabilities?.split(',') || [],
        });
      });

      browser.on('serviceDown', (service: any) => {
        logger.info({ service: service.name }, 'Peer went down');
        this.removePeer(service.name);
      });

      browser.start();
      logger.info({ serviceType: this.config.mdnsServiceType }, 'mDNS discovery started');
    } catch (error) {
      logger.warn({ error }, 'mDNS not available, falling back to static discovery');
      this.config.discoveryMethod = 'static';
    }
  }

  /**
   * Start Consul discovery
   */
  private async startConsulDiscovery(): Promise<void> {
    // TODO: Implement Consul service discovery
    logger.warn('Consul discovery not yet implemented');
    this.config.discoveryMethod = 'static';
  }

  /**
   * Add a peer
   */
  addPeer(peer: FederationPeer): void {
    this.state.peers.set(peer.id, {
      ...peer,
      healthy: true,
      lastSeen: new Date().toISOString(),
    });
    logger.info({ peerId: peer.id, peerName: peer.name }, 'Peer added');
  }

  /**
   * Remove a peer
   */
  async removePeer(peerId: string): Promise<void> {
    await this.closePeerConnection(peerId);
    this.state.peers.delete(peerId);
    // Remove remote tools from this peer
    for (const [toolId, tool] of this.state.remoteTools) {
      if (tool.instanceId === peerId) {
        this.state.remoteTools.delete(toolId);
      }
    }
    logger.info({ peerId }, 'Peer removed');
  }

  /**
   * Sync with peers
   */
  async syncPeers(): Promise<void> {
    logger.debug('Syncing with peers');

    for (const [peerId, peer] of this.state.peers) {
      try {
        // Fetch peer's agent card
        const response = await fetch(`${peer.url}/.well-known/agent.json`, {
          signal: AbortSignal.timeout(this.config.peerTimeout * 1000),
        });

        if (response.ok) {
          const agentCard = await response.json() as { skills?: Array<{ id: string; name: string; description: string }> };
          
          // Update peer capabilities
          peer.healthy = true;
          peer.lastSeen = new Date().toISOString();
          peer.capabilities = agentCard.skills?.map((s) => s.name) || [];

          // Update remote tools
          if (this.config.enableToolProxy && agentCard.skills) {
            for (const skill of agentCard.skills) {
              if (!this.state.remoteTools.has(skill.id)) {
                this.state.remoteTools.set(skill.id, {
                  name: skill.name,
                  description: skill.description,
                  instanceId: peerId,
                  instanceName: peer.name,
                });
              }
            }
          }

          logger.debug({ peerId, toolCount: agentCard.skills?.length }, 'Synced with peer');
        } else {
          peer.healthy = false;
          logger.warn({ peerId, status: response.status }, 'Failed to sync with peer');
        }
      } catch (error) {
        peer.healthy = false;
        logger.warn({ peerId, error }, 'Failed to reach peer');
      }
    }

    this.state.lastSync = new Date().toISOString();
  }

  /**
   * Send heartbeat to peers
   */
  private async sendHeartbeat(): Promise<void> {
    for (const [peerId, peer] of this.state.peers) {
      if (!peer.healthy) continue;

      try {
        const start = Date.now();
        await fetch(`${peer.url}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        peer.latencyMs = Date.now() - start;
        peer.lastSeen = new Date().toISOString();
      } catch {
        peer.latencyMs = undefined;
        // Close connection to unhealthy peer
        await this.closePeerConnection(peerId);
      }
    }
  }

  /**
   * Get all known peers
   */
  getPeers(): FederationPeer[] {
    return Array.from(this.state.peers.values());
  }

  /**
   * Get healthy peers
   */
  getHealthyPeers(): FederationPeer[] {
    return this.getPeers().filter((p) => p.healthy);
  }

  /**
   * Get remote tools
   */
  getRemoteTools(): FederatedTool[] {
    return Array.from(this.state.remoteTools.values());
  }

  /**
   * Get a specific remote tool
   */
  getRemoteTool(toolName: string): FederatedTool | undefined {
    return this.state.remoteTools.get(toolName);
  }

  /**
   * Get federation status
   */
  getStatus(): {
    instanceId: string;
    instanceName: string;
    peerCount: number;
    healthyPeerCount: number;
    remoteToolCount: number;
    activeConnections: number;
    lastSync?: string;
  } {
    return {
      instanceId: this.config.instanceId,
      instanceName: this.config.instanceName,
      peerCount: this.state.peers.size,
      healthyPeerCount: this.getHealthyPeers().length,
      remoteToolCount: this.state.remoteTools.size,
      activeConnections: this.state.connectionPool.size,
      lastSync: this.state.lastSync,
    };
  }

  /**
   * Call a remote tool on a federated peer
   */
  async callRemoteTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const tool = this.state.remoteTools.get(toolName);
    if (!tool) {
      throw new Error(`Remote tool not found: ${toolName}`);
    }

    const peer = this.state.peers.get(tool.instanceId);
    if (!peer || !peer.healthy) {
      throw new Error(`Peer not available: ${tool.instanceId}`);
    }

    // Get or create connection to the peer
    const client = await this.getPeerConnection(peer);

    try {
      logger.info({ peerId: peer.id, toolName }, 'Calling remote tool');

      // Call the tool on the peer with timeout
      const timeoutMs = this.config.peerTimeout * 1000;
      const result = await Promise.race([
        client.callTool({ name: tool.name, arguments: args }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Remote tool call timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);

      logger.info({ peerId: peer.id, toolName }, 'Remote tool call completed');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ peerId: peer.id, toolName, error: message }, 'Remote tool call failed');

      // Mark peer as unhealthy if connection failed
      if (message.includes('ECONNREFUSED') || message.includes('timeout') || message.includes('ECONNRESET')) {
        peer.healthy = false;
        logger.warn({ peerId: peer.id }, 'Marked peer as unhealthy due to connection failure');
      }

      throw new Error(`Remote tool call failed: ${message}`);
    }
  }

  /**
   * Get or create a connection to a peer
   */
  private async getPeerConnection(peer: FederationPeer): Promise<Client> {
    // Check if we already have an active connection
    const existing = this.state.connectionPool.get(peer.id);
    if (existing && existing.active) {
      return existing.client;
    }

    // Create new connection
    logger.info({ peerId: peer.id, url: peer.url }, 'Creating new peer connection');

    const client = new Client(
      { name: `dmrx-federation-${this.config.instanceId}`, version: '0.1.0' },
      { capabilities: {} }
    );

    const transport = new SSEClientTransport(new URL(`${peer.url}/sse`));
    await client.connect(transport);

    // Store in connection pool
    this.state.connectionPool.set(peer.id, {
      peerId: peer.id,
      client,
      connectedAt: new Date(),
      active: true,
    });

    logger.info({ peerId: peer.id }, 'Peer connection established');
    return client;
  }

  /**
   * Close connection to a specific peer
   */
  private async closePeerConnection(peerId: string): Promise<void> {
    const conn = this.state.connectionPool.get(peerId);
    if (conn) {
      conn.active = false;
      try {
        await conn.client.close();
      } catch {
        // Ignore close errors
      }
      this.state.connectionPool.delete(peerId);
      logger.info({ peerId }, 'Peer connection closed');
    }
  }

  /**
   * Close all peer connections
   */
  private async closeAllConnections(): Promise<void> {
    for (const [peerId] of this.state.connectionPool) {
      await this.closePeerConnection(peerId);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: FederationManager | null = null;

export function getFederationManager(config?: FederationConfig): FederationManager {
  if (!instance) {
    instance = new FederationManager(config);
  }
  return instance;
}

export function resetFederationManager(): void {
  instance = null;
}