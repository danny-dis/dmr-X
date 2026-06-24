/**
 * DMR-X Kubernetes Operator
 * 
 * Provides CRD definitions and utilities for managing DMR-X resources
 * in Kubernetes.
 */

import { logger } from '@dmr-x/utils';

export interface OperatorConfig {
  namespace?: string;
}

/**
 * CRD Definitions for DMR-X resources
 */
export const CRD_DEFINITIONS = {
  MCPServer: {
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
    metadata: { name: 'mcpservers.dmrx.io' },
    spec: {
      group: 'dmrx.io',
      versions: [{
        name: 'v1',
        served: true,
        storage: true,
        schema: {
          openAPIV3Schema: {
            type: 'object',
            properties: {
              spec: {
                type: 'object',
                properties: {
                  replicas: { type: 'integer' },
                  image: { type: 'string' },
                  toolSearch: { type: 'object' },
                  oauth: { type: 'object' },
                  guardrails: { type: 'object' },
                  audit: { type: 'object' },
                  rbac: { type: 'object' },
                  federation: { type: 'object' },
                },
              },
              status: { type: 'object' },
            },
          },
        },
        subresources: { status: {} },
      }],
      scope: 'Namespaced',
      names: {
        plural: 'mcpservers',
        singular: 'mcpserver',
        kind: 'MCPServer',
        shortNames: ['mcp'],
      },
    },
  },

  Federation: {
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
    metadata: { name: 'federations.dmrx.io' },
    spec: {
      group: 'dmrx.io',
      versions: [{
        name: 'v1',
        served: true,
        storage: true,
        schema: {
          openAPIV3Schema: {
            type: 'object',
            properties: {
              spec: {
                type: 'object',
                properties: {
                  peers: { type: 'array' },
                  discovery: { type: 'object' },
                  syncInterval: { type: 'string' },
                },
              },
              status: { type: 'object' },
            },
          },
        },
        subresources: { status: {} },
      }],
      scope: 'Namespaced',
      names: {
        plural: 'federations',
        singular: 'federation',
        kind: 'Federation',
        shortNames: ['fed'],
      },
    },
  },

  Workflow: {
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
    metadata: { name: 'workflows.dmrx.io' },
    spec: {
      group: 'dmrx.io',
      versions: [{
        name: 'v1',
        served: true,
        storage: true,
        schema: {
          openAPIV3Schema: {
            type: 'object',
            properties: {
              spec: {
                type: 'object',
                properties: {
                  steps: { type: 'array' },
                  variables: { type: 'object' },
                  timeout: { type: 'string' },
                  retryPolicy: { type: 'object' },
                },
              },
              status: { type: 'object' },
            },
          },
        },
        subresources: { status: {} },
      }],
      scope: 'Namespaced',
      names: {
        plural: 'workflows',
        singular: 'workflow',
        kind: 'Workflow',
        shortNames: ['wf'],
      },
    },
  },

  ToolSearchIndex: {
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
    metadata: { name: 'toolsearchindices.dmrx.io' },
    spec: {
      group: 'dmrx.io',
      versions: [{
        name: 'v1',
        served: true,
        storage: true,
        schema: {
          openAPIV3Schema: {
            type: 'object',
            properties: {
              spec: {
                type: 'object',
                properties: {
                  sources: { type: 'array' },
                  bm25: { type: 'object' },
                  semantic: { type: 'object' },
                  hybrid: { type: 'object' },
                  rebuildInterval: { type: 'string' },
                },
              },
              status: { type: 'object' },
            },
          },
        },
        subresources: { status: {} },
      }],
      scope: 'Namespaced',
      names: {
        plural: 'toolsearchindices',
        singular: 'toolsearchindex',
        kind: 'ToolSearchIndex',
        shortNames: ['tsi'],
      },
    },
  },
};

/**
 * Generate MCPServer manifest
 */
export function generateMCPServerManifest(
  name: string,
  namespace: string,
  spec: MCPServerSpec
): any {
  return {
    apiVersion: 'dmrx.io/v1',
    kind: 'MCPServer',
    metadata: {
      name,
      namespace,
      labels: {
        'app.kubernetes.io/name': 'mcp-server',
        'app.kubernetes.io/instance': name,
        'app.kubernetes.io/managed-by': 'dmrx-operator',
      },
    },
    spec,
  };
}

/**
 * Generate Federation manifest
 */
export function generateFederationManifest(
  name: string,
  namespace: string,
  spec: FederationSpec
): any {
  return {
    apiVersion: 'dmrx.io/v1',
    kind: 'Federation',
    metadata: {
      name,
      namespace,
      labels: {
        'app.kubernetes.io/name': 'federation',
        'app.kubernetes.io/instance': name,
        'app.kubernetes.io/managed-by': 'dmrx-operator',
      },
    },
    spec,
  };
}

/**
 * Generate Workflow manifest
 */
export function generateWorkflowManifest(
  name: string,
  namespace: string,
  spec: WorkflowSpec
): any {
  return {
    apiVersion: 'dmrx.io/v1',
    kind: 'Workflow',
    metadata: {
      name,
      namespace,
      labels: {
        'app.kubernetes.io/name': 'workflow',
        'app.kubernetes.io/instance': name,
        'app.kubernetes.io/managed-by': 'dmrx-operator',
      },
    },
    spec,
  };
}

/**
 * Generate ToolSearchIndex manifest
 */
export function generateToolSearchIndexManifest(
  name: string,
  namespace: string,
  spec: ToolSearchIndexSpec
): any {
  return {
    apiVersion: 'dmrx.io/v1',
    kind: 'ToolSearchIndex',
    metadata: {
      name,
      namespace,
      labels: {
        'app.kubernetes.io/name': 'tool-search-index',
        'app.kubernetes.io/instance': name,
        'app.kubernetes.io/managed-by': 'dmrx-operator',
      },
    },
    spec,
  };
}

// Type definitions
export interface MCPServerSpec {
  replicas?: number;
  image?: string;
  toolSearch?: {
    enabled?: boolean;
    bm25?: boolean;
    semantic?: boolean;
  };
  oauth?: {
    enabled?: boolean;
    issuerUrl?: string;
  };
  guardrails?: {
    enabled?: boolean;
    pii?: boolean;
    contentFilter?: boolean;
  };
  audit?: {
    enabled?: boolean;
    backend?: string;
  };
  rbac?: {
    enabled?: boolean;
  };
  federation?: {
    enabled?: boolean;
    peers?: string[];
  };
}

export interface FederationSpec {
  peers: Array<{
    name: string;
    endpoint: string;
    secretRef?: string;
  }>;
  discovery?: {
    mdns?: boolean;
    dns?: {
      domain?: string;
    };
  };
  syncInterval?: string;
}

export interface WorkflowSpec {
  steps: Array<{
    name: string;
    tool: string;
    input?: Record<string, any>;
    dependsOn?: string[];
  }>;
  variables?: Record<string, any>;
  timeout?: string;
  retryPolicy?: {
    maxRetries?: number;
    backoffMultiplier?: number;
  };
}

export interface ToolSearchIndexSpec {
  sources: Array<{
    type: string;
    endpoint: string;
  }>;
  bm25?: {
    enabled?: boolean;
    k1?: number;
    b?: number;
  };
  semantic?: {
    enabled?: boolean;
    model?: string;
  };
  hybrid?: {
    enabled?: boolean;
    rrfConstant?: number;
  };
  rebuildInterval?: string;
}

/**
 * Operator class for managing DMR-X resources
 */
export class Operator {
  private namespace: string;

  constructor(config: OperatorConfig = {}) {
    this.namespace = config.namespace || 'default';
  }

  /**
   * Get all CRD definitions
   */
  getCRDs(): any[] {
    return Object.values(CRD_DEFINITIONS);
  }

  /**
   * Get CRD by name
   */
  getCRD(name: string): any {
    return CRD_DEFINITIONS[name as keyof typeof CRD_DEFINITIONS];
  }

  /**
   * Generate manifest for a resource
   */
  generateManifest(
    kind: string,
    name: string,
    spec: MCPServerSpec | FederationSpec | WorkflowSpec | ToolSearchIndexSpec
  ): any {
    switch (kind) {
      case 'MCPServer':
        return generateMCPServerManifest(name, this.namespace, spec as MCPServerSpec);
      case 'Federation':
        return generateFederationManifest(name, this.namespace, spec as FederationSpec);
      case 'Workflow':
        return generateWorkflowManifest(name, this.namespace, spec as WorkflowSpec);
      case 'ToolSearchIndex':
        return generateToolSearchIndexManifest(name, this.namespace, spec as ToolSearchIndexSpec);
      default:
        throw new Error(`Unknown resource kind: ${kind}`);
    }
  }

  /**
   * Generate kubectl apply command
   */
  generateKubectlCommand(manifest: any): string {
    const json = JSON.stringify(manifest);
    return `kubectl apply -f - <<'EOF'\n${json}\nEOF`;
  }
}
