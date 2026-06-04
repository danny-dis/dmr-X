import * as React from 'react';
import { BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, } from 'recharts';
import { formatCurrency, formatNumber } from '@/lib/formatters';
const DEFAULT_COLORS = {
    start: '#7C5CFF',
    positive: '#34D399',
    negative: '#F87171',
    total: '#22D3EE',
};
export function WaterfallChart({ steps, height = 240, unit = 'count', className, }) {
    const data = React.useMemo(() => {
        let running = 0;
        return steps.map((s) => {
            const type = s.type ?? (s.value >= 0 ? 'positive' : 'negative');
            const start = running;
            const end = running + s.value;
            const isTotal = type === 'total';
            if (isTotal) {
                running = end;
                return { label: s.label, start: 0, end, range: [0, end], type, base: 0, value: s.value };
            }
            else {
                running = end;
                return {
                    label: s.label,
                    start: Math.min(start, end),
                    end: Math.max(start, end),
                    range: [Math.min(start, end), Math.max(start, end)],
                    type,
                    base: Math.min(start, end),
                    value: s.value,
                };
            }
        });
    }, [steps]);
    const fmt = unit === 'currency' ? (n) => formatCurrency(n) : (n) => formatNumber(n, true);
    return (<div className={className} style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <RechartsBarChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false}/>
          <XAxis dataKey="label" tick={{ fill: 'var(--text-dim)', fontSize: 10 }} stroke="var(--border)" tickLine={false} axisLine={false}/>
          <YAxis tick={{ fill: 'var(--text-dim)', fontSize: 10 }} tickFormatter={fmt} stroke="var(--border)" tickLine={false} axisLine={false} width={60}/>
          <Tooltip cursor={{ fill: 'var(--surface-2)', opacity: 0.5 }} contentStyle={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border-2)',
            borderRadius: 8,
            fontSize: 11,
        }} formatter={(value, _name, item) => {
            const v = item?.payload?.value;
            return [fmt(v ?? value), ''];
        }}/>
          <Bar dataKey="end" stackId="wf" fill="transparent"/>
          <Bar dataKey="start" stackId="wf" fill="transparent"/>
          <Bar dataKey="base" stackId="wf" fill="transparent">
            {data.map((d, i) => (<Cell key={`b-${i}`} fill="transparent"/>))}
          </Bar>
          <Bar dataKey="value" stackId="wf-2">
            {data.map((d, i) => {
            const color = d.type === 'total' ? DEFAULT_COLORS.total : DEFAULT_COLORS[d.type];
            return (<Cell key={`v-${i}`} fill={color} fillOpacity={0.85}/>);
        })}
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>);
}
//# sourceMappingURL=WaterfallChart.js.map