import * as React from 'react';
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import { cn } from '@/lib/utils';

export interface PieDatum {
  name: string;
  value: number;
  color: string;
}

export interface PieChartProps {
  data: PieDatum[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
  showLegend?: boolean;
  valueFormatter?: (v: number) => string;
  className?: string;
}

export function PieChart({
  data,
  height = 200,
  innerRadius = 50,
  outerRadius = 80,
  showLegend = true,
  valueFormatter = (v) => String(v),
  className,
}: PieChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <RechartsPieChart>
            <Tooltip
              contentStyle={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border-2)',
                borderRadius: 8,
                fontSize: 11,
              }}
              formatter={(value: number) => [valueFormatter(value), '']}
            />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={2}
              stroke="var(--bg)"
              strokeWidth={2}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
          </RechartsPieChart>
        </ResponsiveContainer>
      </div>
      {showLegend && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 w-full">
          {data.map((d) => (
            <div key={d.name} className="flex items-center gap-2 text-xs min-w-0">
              <span className="size-2 shrink-0 rounded-full" style={{ background: d.color }} />
              <span className="text-fg-muted truncate flex-1">{d.name}</span>
              <span className="text-fg tabular-nums font-medium shrink-0">
                {((d.value / total) * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
