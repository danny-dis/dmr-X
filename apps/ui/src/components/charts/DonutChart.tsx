import * as React from 'react';

import { cn } from '@/lib/utils';

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  data: DonutSlice[];
  size?: number;
  thickness?: number;
  showLegend?: boolean;
  showLabels?: boolean;
  centerLabel?: React.ReactNode;
  centerValue?: React.ReactNode;
  className?: string;
}

export function DonutChart({
  data,
  size = 200,
  thickness = 22,
  showLegend = false,
  showLabels = false,
  centerLabel,
  centerValue,
  className,
}: DonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = size / 2;
  const inner = radius - thickness;
  const cx = radius;
  const cy = radius;

  if (total === 0) {
    return (
      <div className={cn('flex items-center justify-center', className)} style={{ width: size, height: size }}>
        <div
          className="rounded-full border-2 border-dashed border-border-strong"
          style={{ width: size - 8, height: size - 8 }}
        />
      </div>
    );
  }

  let acc = 0;
  const segments = data.map((d) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += d.value;
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
    return { ...d, start, end };
  });

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {segments.map((s, i) => {
            if (s.end - s.start >= Math.PI * 2 - 0.001) {
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={radius - thickness / 2}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={thickness}
                />
              );
            }
            const large = s.end - s.start > Math.PI ? 1 : 0;
            const x1 = cx + (radius - thickness / 2) * Math.cos(s.start);
            const y1 = cy + (radius - thickness / 2) * Math.sin(s.start);
            const x2 = cx + (radius - thickness / 2) * Math.cos(s.end);
            const y2 = cy + (radius - thickness / 2) * Math.sin(s.end);
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} A ${radius - thickness / 2} ${radius - thickness / 2} 0 ${large} 1 ${x2} ${y2}`}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeLinecap="round"
              />
            );
          })}
        </svg>
        {(centerLabel || centerValue) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {centerValue && <div className="text-lg font-semibold text-fg tabular-nums">{centerValue}</div>}
            {centerLabel && <div className="text-[10px] uppercase tracking-wider text-fg-subtle">{centerLabel}</div>}
          </div>
        )}
      </div>
      {showLegend && (
        <div className="flex flex-col gap-1.5 min-w-0">
          {data.map((d) => (
            <div key={d.label} className="flex items-center gap-2 text-xs">
              <span className="size-2 shrink-0 rounded-full" style={{ background: d.color }} />
              <span className="text-fg-muted truncate flex-1">{d.label}</span>
              <span className="text-fg tabular-nums font-medium">{d.value}</span>
              {showLabels && (
                <span className="text-fg-subtle tabular-nums w-10 text-right">
                  {((d.value / total) * 100).toFixed(1)}%
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface SunburstRing {
  label: string;
  value: number;
  color?: string;
  children?: SunburstRing[];
}

export interface SunburstProps {
  data: SunburstRing[];
  size?: number;
  className?: string;
}

const SUNBURST_PALETTE = [
  '#7C5CFF', '#22D3EE', '#34D399', '#FBBF24', '#F87171',
  '#F472B6', '#A3E635', '#60A5FA', '#C084FC', '#FB923C',
];

export function Sunburst({ data, size = 280, className }: SunburstProps) {
  return (
    <div className={cn('flex justify-center', className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <SunburstNode data={data} size={size} depth={0} index={0} />
      </svg>
    </div>
  );
}

function SunburstNode({
  data,
  size,
  depth,
  index,
  parentColor,
}: {
  data: SunburstRing[];
  size: number;
  depth: number;
  index: number;
  parentColor?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  const cx = size / 2;
  const cy = size / 2;
  const innerR = (size / 2) * (depth / 3) * 0.5;
  const outerR = (size / 2) * ((depth + 1) / 3) * 0.85;

  let acc = 0;
  const arcs = data.map((d, i) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
    acc += d.value;
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const color = d.color ?? parentColor ?? SUNBURST_PALETTE[(i + index) % SUNBURST_PALETTE.length];
    return { ...d, start, end, color, i };
  });

  return (
    <g>
      {arcs.map((a) => {
        const large = a.end - a.start > Math.PI ? 1 : 0;
        const x1 = cx + innerR * Math.cos(a.start);
        const y1 = cy + innerR * Math.sin(a.start);
        const x2 = cx + outerR * Math.cos(a.start);
        const y2 = cy + outerR * Math.sin(a.start);
        const x3 = cx + outerR * Math.cos(a.end);
        const y3 = cy + outerR * Math.sin(a.end);
        const x4 = cx + innerR * Math.cos(a.end);
        const y4 = cy + innerR * Math.sin(a.end);
        return (
          <g key={a.label + depth}>
            <path
              d={`M ${x1} ${y1} L ${x2} ${y2} A ${outerR} ${outerR} 0 ${large} 1 ${x3} ${y3} L ${x4} ${y4} A ${innerR} ${innerR} 0 ${large} 0 ${x1} ${y1} Z`}
              fill={a.color}
              fillOpacity={depth === 0 ? 0.85 : 0.55 - depth * 0.1}
              stroke="var(--bg)"
              strokeWidth={1.5}
            >
              <title>{a.label} · {a.value}</title>
            </path>
            {a.children && depth < 2 && (
              <SunburstNode
                data={a.children}
                size={size}
                depth={depth + 1}
                index={a.i}
                parentColor={a.color}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}
