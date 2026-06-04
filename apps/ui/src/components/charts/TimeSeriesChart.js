import * as React from 'react';
import { AreaChart as RechartsAreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, } from 'recharts';
import { formatNumber } from '@/lib/formatters';
const defaultYFormatter = (n) => formatNumber(n, true);
const defaultXFormatter = (v) => String(v);
export function TimeSeriesChart({ data, series, xKey, height = 220, showGrid = true, showLegend = false, yFormatter = defaultYFormatter, xFormatter = defaultXFormatter, className, stacked = false, }) {
    return (<div className={className} style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <RechartsAreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          {showGrid && (<CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false}/>)}
          <XAxis dataKey={xKey} tick={{ fill: 'var(--text-dim)', fontSize: 10 }} tickFormatter={xFormatter} stroke="var(--border)" tickLine={false} axisLine={false} minTickGap={32}/>
          <YAxis tick={{ fill: 'var(--text-dim)', fontSize: 10 }} tickFormatter={yFormatter} stroke="var(--border)" tickLine={false} axisLine={false} width={48}/>
          <Tooltip contentStyle={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border-2)',
            borderRadius: 8,
            fontSize: 11,
            padding: '6px 10px',
        }} labelStyle={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4 }} itemStyle={{ color: 'var(--text)', fontSize: 11 }} cursor={{ stroke: 'var(--border-3)', strokeWidth: 1, strokeDasharray: '2 2' }} formatter={(value) => [yFormatter(value), '']}/>
          {showLegend && (<Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }}/>)}
          {series.map((s) => (<Area key={s.key} dataKey={s.key} name={s.name ?? s.key} type={s.type ?? 'monotone'} stroke={s.color} fill={s.color} fillOpacity={s.fillOpacity ?? 0.18} strokeWidth={1.5} stackId={stacked ? 's' : undefined}/>))}
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>);
}
//# sourceMappingURL=TimeSeriesChart.js.map