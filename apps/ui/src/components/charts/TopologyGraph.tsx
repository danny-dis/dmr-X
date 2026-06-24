import * as React from 'react';

import { cn } from '@/lib/utils';

export interface TopologyNode {
  id: string;
  label: string;
  type: 'gateway' | 'router' | 'provider' | 'tenant' | 'service' | 'model' | 'tool';
  status?: 'online' | 'degraded' | 'offline' | 'unknown';
  x?: number;
  y?: number;
  meta?: Record<string, string | number>;
}

export interface TopologyEdge {
  source: string;
  target: string;
  label?: string;
  active?: boolean;
  weight?: number;
}

export interface TopologyGraphProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  height?: number;
  onNodeClick?: (node: TopologyNode) => void;
  className?: string;
}

const typeColor: Record<TopologyNode['type'], string> = {
  gateway: '#7C5CFF',
  router: '#22D3EE',
  provider: '#34D399',
  tenant: '#F472B6',
  service: '#FBBF24',
  model: '#A3E635',
  tool: '#60A5FA',
};

const statusRingColor: Record<NonNullable<TopologyNode['status']>, string> = {
  online: '#34D399',
  degraded: '#FBBF24',
  offline: '#F87171',
  unknown: '#545B73',
};

export function TopologyGraph({
  nodes,
  edges,
  height = 480,
  onNodeClick,
  className,
}: TopologyGraphProps) {
  const width = 800;
  const layout = React.useMemo(() => layoutGraph(nodes, edges, width, height), [nodes, edges, height]);

  return (
    <div className={cn('relative overflow-auto rounded-xl border border-border bg-surface-1', className)}>
      <svg width={layout.viewWidth} height={height} viewBox={`0 0 ${layout.viewWidth} ${height}`} className="font-sans">
        <defs>
          <pattern id="topo-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeOpacity="0.4" strokeWidth="0.5" />
          </pattern>
          <marker id="topo-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-dim)" />
          </marker>
        </defs>
        <rect width={layout.viewWidth} height={height} fill="url(#topo-grid)" />

        {layout.edges.map((e, i) => {
          const path = `M ${e.x1} ${e.y1} C ${e.x1 + 60} ${e.y1}, ${e.x2 - 60} ${e.y2}, ${e.x2} ${e.y2}`;
          return (
            <g key={i}>
              <path
                d={path}
                fill="none"
                stroke={e.active ? '#7C5CFF' : 'var(--border-2)'}
                strokeWidth={Math.max(1, e.weight ?? 1)}
                strokeOpacity={e.active ? 0.9 : 0.6}
                strokeDasharray={e.active ? '4 4' : undefined}
                markerEnd="url(#topo-arrow)"
                className={e.active ? 'animate-[dash_1.6s_linear_infinite]' : ''}
              >
                {e.label && (
                  <text
                    x={(e.x1 + e.x2) / 2}
                    y={(e.y1 + e.y2) / 2 - 4}
                    textAnchor="middle"
                    fill="var(--text-dim)"
                    fontSize={9}
                  >
                    {e.label}
                  </text>
                )}
              </path>
            </g>
          );
        })}

        {layout.nodes.map((n) => {
          const baseColor = typeColor[n.type];
          const ring = n.status ? statusRingColor[n.status] : statusRingColor.unknown;
          return (
            <g
              key={n.id}
              transform={`translate(${n.x}, ${n.y})`}
              className={onNodeClick ? 'cursor-pointer' : ''}
              onClick={() => onNodeClick?.(n)}
            >
              <circle r={28} fill="var(--bg)" stroke={ring} strokeWidth={1.5} opacity={0.5} />
              <circle r={22} fill={baseColor} fillOpacity={0.18} stroke={baseColor} strokeWidth={1.5} />
              <text textAnchor="middle" dominantBaseline="middle" fill={baseColor} fontSize={9} fontWeight={600} className="uppercase tracking-wider">
                {n.type.slice(0, 4)}
              </text>
              <text textAnchor="middle" y={36} fill="var(--text)" fontSize={11} fontWeight={500}>
                {n.label}
              </text>
              {n.status === 'online' && (
                <circle cx={18} cy={-18} r={4} fill="#34D399" stroke="var(--bg)" strokeWidth={1.5}>
                  <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function layoutGraph(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  width: number,
  height: number
) {
  const layers: Record<string, number> = {
    gateway: 0,
    router: 1,
    service: 1,
    tenant: 2,
    provider: 2,
    model: 3,
    tool: 3,
  };
  const byLayer: Record<number, TopologyNode[]> = {};
  for (const n of nodes) {
    const layer = layers[n.type] ?? 1;
    (byLayer[layer] ??= []).push(n);
  }
  const sortedLayers = Object.keys(byLayer)
    .map(Number)
    .sort((a, b) => a - b);
  const colWidth = width / (sortedLayers.length + 1);

  const positioned: TopologyNode[] = nodes.map((n) => {
    const layer = layers[n.type] ?? 1;
    const layerNodes = byLayer[layer];
    const idxInLayer = layerNodes.indexOf(n);
    const rowHeight = height / (layerNodes.length + 1);
    return {
      ...n,
      x: colWidth * (sortedLayers.indexOf(layer) + 1),
      y: rowHeight * (idxInLayer + 1),
    };
  });

  const lookup = new Map(positioned.map((n) => [n.id, n] as const));
  const laidEdges = edges
    .map((e) => {
      const s = lookup.get(e.source);
      const t = lookup.get(e.target);
      if (!s || !t) return null;
      return {
        ...e,
        x1: s.x ?? 0,
        y1: s.y ?? 0,
        x2: t.x ?? 0,
        y2: t.y ?? 0,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  return { nodes: positioned, edges: laidEdges, viewWidth: width };
}
