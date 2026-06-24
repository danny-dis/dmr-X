/**
 * Federation Module for Multi-Instance Tool Sharing
 * 
 * Enables multiple DMR-X instances to discover and share tools
 * across a network.
 * 
 * Features:
 * - Instance discovery via mDNS or static config
 * - Tool synchronization across instances
 * - Health monitoring and failover
 * - Load balancing across federated instances
 */

export {
  FederationManager,
  getFederationManager,
  resetFederationManager,
  type FederationConfig,
  type FederationPeer,
  type FederatedTool,
  type FederationState,
} from './manager.js';