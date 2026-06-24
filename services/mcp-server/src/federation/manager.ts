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
      // Use Function constructor to avoid TypeScript type checking for optional dependency
      let mdns: any;
      try {
        mdns = await new Function('return import("mdns")')();
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
  removePeer(peerId: string): void {
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
    lastSync?: string;
  } {
    return {
      instanceId: this.config.instanceId,
      instanceName: this.config.instanceName,
      peerCount: this.state.peers.size,
      healthyPeerCount: this.getHealthyPeers().length,
      remoteToolCount: this.state.remoteTools.size,
      lastSync: this.state.lastSync,
    };
  }

  /**
   * Call a remote tool
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

    // TODO: Implement actual A2A task execution
    throw new Error('Remote tool execution not yet implemented');
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