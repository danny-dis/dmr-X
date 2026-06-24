import * as React from 'react';
import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

import { formatDuration } from '@/lib/formatters';

export interface LatencyPoint {
  t: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface LatencyChartProps {
  data: LatencyPoint[];
  height?: number;
  showReference?: boolean;
  className?: string;
}

export function LatencyChart({
  data,
  height = 240,
  showReference = true,
  className,
}: LatencyChartProps) {
  return (
    <div className={className} style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <RechartsAreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="lat-p50" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34D399" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#34D399" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="lat-p95" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FBBF24" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#FBBF24" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="lat-p99" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F87171" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#F87171" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="t"
            tick={{ fill: 'var(--text-dim)', fontSize: 10 }}
            tickFormatter={(v) => new Date(v).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            stroke="var(--border)"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: 'var(--text-dim)', fontSize: 10 }}
            tickFormatter={(v) => formatDuration(v)}
            stroke="var(--border)"
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border-2)',
              borderRadius: 8,
              fontSize: 11,
              padding: '6px 10px',
            }}
            labelStyle={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4 }}
            itemStyle={{ fontSize: 11 }}
            labelFormatter={(v) => new Date(v as number).toLocaleString()}
            formatter={(value: number, name) => [formatDuration(value), name]}
          />
          <Area
            type="monotone"
            dataKey="p99"
            stroke="#F87171"
            fill="url(#lat-p99)"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
          <Area
            type="monotone"
            dataKey="p95"
            stroke="#FBBF24"
            fill="url(#lat-p95)"
            strokeWidth={1.5}
          />
          <Area
            type="monotone"
            dataKey="p50"
            stroke="#34D399"
            fill="url(#lat-p50)"
            strokeWidth={1.5}
          />
          {showReference && (
            <ReferenceLine
              y={1000}
              stroke="var(--danger)"
              strokeDasharray="3 3"
              strokeOpacity={0.4}
              label={{ value: '1s', position: 'right', fill: 'var(--text-dim)', fontSize: 9 }}
            />
          )}
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
