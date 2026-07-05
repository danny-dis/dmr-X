export interface VersionedStrategy {
  versionId: string;
  name: string;
  description: string;
  createdAt: string;
  active: boolean;
  config: {
    routingStrategy: string;
    scoringWeights?: Record<string, number>;
    capabilityThresholds?: Record<string, number>;
    costMultiplier?: number;
    latencyMultiplier?: number;
    qualityMultiplier?: number;
    clusterEnabled?: boolean;
    clusterConfig?: {
      similarityThreshold: number;
      maxCentroids: number;
      minClusterSize: number;
    };
  };
}

export interface VersionAssignment {
  tenantId: string | '*';
  versionId: string;
  weight: number;
  pinned: boolean;
}

export class RoutingVersionRegistry {
  private versions: Map<string, VersionedStrategy> = new Map();
  private assignments: VersionAssignment[] = [];

  constructor() {
    this.registerVersion({
      versionId: 'stable',
      name: 'Stable Routing',
      description: 'Default routing strategy with heuristic scoring',
      createdAt: new Date().toISOString(),
      active: true,
      config: {
        routingStrategy: 'thompson',
        scoringWeights: {
          quality: 0.35,
          cost: 0.30,
          latency: 0.20,
          context: 0.15,
        },
      },
    });

    this.registerVersion({
      versionId: 'cluster',
      name: 'Cluster-Based Routing',
      description: 'Experimental cluster-scorer based routing',
      createdAt: new Date().toISOString(),
      active: true,
      config: {
        routingStrategy: 'thompson',
        clusterEnabled: true,
        clusterConfig: {
          similarityThreshold: 0.75,
          maxCentroids: 50,
          minClusterSize: 5,
        },
      },
    });
  }

  registerVersion(version: VersionedStrategy): void {
    this.versions.set(version.versionId, version);
  }

  getVersion(versionId: string): VersionedStrategy | undefined {
    return this.versions.get(versionId);
  }

  getAllVersions(): VersionedStrategy[] {
    return Array.from(this.versions.values());
  }

  getActiveVersions(): VersionedStrategy[] {
    return Array.from(this.versions.values()).filter(v => v.active);
  }

  setAssignment(assignment: VersionAssignment): void {
    const idx = this.assignments.findIndex(a => a.tenantId === assignment.tenantId);
    if (idx >= 0) {
      this.assignments[idx] = assignment;
    } else {
      this.assignments.push(assignment);
    }
  }

  getAssignment(tenantId: string): VersionAssignment | undefined {
    const specific = this.assignments.find(a => a.tenantId === tenantId);
    if (specific) return specific;
    return this.assignments.find(a => a.tenantId === '*');
  }

  resolveVersion(tenantId: string, requestId?: string): VersionedStrategy {
    const assignment = this.getAssignment(tenantId);
    if (!assignment) {
      return this.getVersion('stable')!;
    }

    if (assignment.pinned) {
      return this.getVersion(assignment.versionId) ?? this.getVersion('stable')!;
    }

    const hash = this.simpleHash(`${tenantId}:${requestId ?? ''}`);
    const roll = hash % 100;

    const allAssignments = this.assignments.filter(a => a.tenantId === tenantId || a.tenantId === '*');
    let cumulativeWeight = 0;

    for (const a of allAssignments) {
      cumulativeWeight += a.weight;
      if (roll < cumulativeWeight) {
        const version = this.getVersion(a.versionId);
        if (version) return version;
      }
    }

    return this.getVersion('stable')!;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}

export const routingVersionRegistry = new RoutingVersionRegistry();
