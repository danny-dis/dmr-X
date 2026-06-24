import * as React from 'react';

import { cn } from '@/lib/utils';

export interface GaugeProps {
  value: number;
  min?: number;
  max?: number;
  size?: number;
  thickness?: number;
  label?: React.ReactNode;
  unit?: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'accent';
  thresholds?: Array<{ value: number; color: string }>;
  showValue?: boolean;
  className?: string;
}

const toneColor = {
  primary: '#7C5CFF',
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  accent: '#22D3EE',
};

export function Gauge({
  value,
  min = 0,
  max = 100,
  size = 140,
  thickness = 12,
  label,
  unit,
  tone = 'primary',
  thresholds,
  showValue = true,
  className,
}: GaugeProps) {
  const clamped = Math.max(min, Math.min(max, value));
  const t = (clamped - min) / (max - min);

  const cx = size / 2;
  const cy = size * 0.65;
  const radius = size * 0.42;
  const startAngle = Math.PI;
  const endAngle = 0;
  const valueAngle = startAngle + (endAngle - startAngle) * t;

  const arcPath = (a1: number, a2: number, r: number) => {
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    const large = a2 - a1 > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  const color =
    thresholds?.find((th) => clamped <= th.value)?.color ??
    thresholds?.[thresholds.length - 1]?.color ??
    toneColor[tone];

  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <svg width={size} height={size * 0.7} viewBox={`0 0 ${size} ${size * 0.7}`}>
        <path
          d={arcPath(startAngle, endAngle, radius)}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={thickness}
          strokeLinecap="round"
        />
        {thresholds && thresholds.length > 0 ? (
          thresholds.map((th, i) => {
            const prev = i === 0 ? min : thresholds[i - 1].value;
            const a1 = startAngle + (endAngle - startAngle) * ((prev - min) / (max - min));
            const a2 = startAngle + (endAngle - startAngle) * ((th.value - min) / (max - min));
            return (
              <path
                key={i}
                d={arcPath(a1, a2, radius)}
                fill="none"
                stroke={th.color}
                strokeOpacity={0.25}
                strokeWidth={thickness}
              />
            );
          })
        ) : null}
        <path
          d={arcPath(startAngle, valueAngle, radius)}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
        />
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fill="var(--text)"
          fontSize={size * 0.22}
          fontWeight={600}
          className="tabular-nums"
        >
          {showValue ? formatValue(clamped) : ''}
          {unit && <tspan fontSize={size * 0.1} fill="var(--text-muted)"> {unit}</tspan>}
        </text>
        {label && (
          <text
            x={cx}
            y={cy + size * 0.12}
            textAnchor="middle"
            fill="var(--text-dim)"
            fontSize={size * 0.08}
            className="uppercase tracking-wider"
          >
            {label}
          </text>
        )}
      </svg>
    </div>
  );
}

function formatValue(n: number): string {
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}
