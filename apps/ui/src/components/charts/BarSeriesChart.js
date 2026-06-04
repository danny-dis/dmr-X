import * as React from 'react';
import { BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList, } from 'recharts';
import { formatNumber } from '@/lib/formatters';
const defaultYFormatter = (n) => formatNumber(n, true);
const defaultXFormatter = (v) => String(v);
export function BarSeriesChart({ data, bars, xKey, height = 220, layout = 'horizontal', showGrid = true, yFormatter = defaultYFormatter, xFormatter = defaultXFormatter, className, showValues = false, onBarClick, }) {
    const isVertical = layout === 'vertical';
    return (<div className={className} style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <RechartsBarChart data={data} layout={layout} margin={{ top: 6, right: 6, left: 0, bottom: 0 }} onClick={(e) => {
            if (onBarClick && e && e.activePayload?.[0]?.payload) {
                onBarClick(e.activePayload[0].payload);
            }
        }}>
          {showGrid && (<CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} horizontal={!isVertical}/>)}
          {isVertical ? (<>
              <XAxis type="number" tick={{ fill: 'var(--text-dim)', fontSize: 10 }} tickFormatter={yFormatter} stroke="var(--border)" tickLine={false} axisLine={false}/>
              <YAxis type="category" dataKey={xKey} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickFormatter={xFormatter} stroke="var(--border)" tickLine={false} axisLine={false} width={100}/>
            </>) : (<>
              <XAxis dataKey={xKey} tick={{ fill: 'var(--text-dim)', fontSize: 10 }} tickFormatter={xFormatter} stroke="var(--border)" tickLine={false} axisLine={false}/>
              <YAxis tick={{ fill: 'var(--text-dim)', fontSize: 10 }} tickFormatter={yFormatter} stroke="var(--border)" tickLine={false} axisLine={false} width={48}/>
            </>)}
          <Tooltip cursor={{ fill: 'var(--surface-2)', opacity: 0.5 }} contentStyle={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border-2)',
            borderRadius: 8,
            fontSize: 11,
            padding: '6px 10px',
        }} labelStyle={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4 }} itemStyle={{ color: 'var(--text)', fontSize: 11 }} formatter={(value) => [yFormatter(value), '']}/>
          {bars.map((b) => (<Bar key={b.key} dataKey={b.key} name={b.name ?? b.key} fill={b.color} radius={b.radius ?? [4, 4, 0, 0]} onClick={onBarClick ? (entry) => onBarClick(entry) : undefined}>
              {showValues && (<LabelList dataKey={b.key} position={isVertical ? 'right' : 'top'} fill="var(--text-muted)" fontSize={10} formatter={(v) => yFormatter(v)}/>)}
              {bars.length === 1 && data.map((d, i) => (<Cell key={`cell-${i}`} fill={b.color}/>))}
            </Bar>))}
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>);
}
//# sourceMappingURL=BarSeriesChart.js.map