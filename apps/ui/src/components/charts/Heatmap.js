import * as React from 'react';
import { cn } from '@/lib/utils';
export function Heatmap({ data, xLabels, yLabels, colorScale = { low: '#1F2230', high: '#7C5CFF', empty: 'transparent' }, valueFormatter = (n) => String(n), cellSize = 14, showLabels = false, className, }) {
    const max = React.useMemo(() => Math.max(1, ...data.map((d) => d.value)), [data]);
    const lookup = React.useMemo(() => {
        const m = new Map();
        data.forEach((d) => m.set(`${d.x}|${d.y}`, d));
        return m;
    }, [data]);
    const xGap = 8;
    const yGap = 8;
    const labelWidth = 80;
    const labelHeight = 18;
    const width = labelWidth + xLabels.length * (cellSize + xGap);
    const height = labelHeight + yLabels.length * (cellSize + yGap);
    return (<div className={cn('overflow-auto', className)}>
      <svg width={width} height={height} className="font-mono">
        {yLabels.map((y, yi) => (<text key={`y-${y}`} x={labelWidth - 4} y={labelHeight + yi * (cellSize + yGap) + cellSize / 2 + 3} textAnchor="end" fill="var(--text-dim)" fontSize={9}>
            {y}
          </text>))}
        {xLabels.map((x, xi) => (<text key={`x-${x}`} x={labelWidth + xi * (cellSize + xGap) + cellSize / 2} y={labelHeight - 4} textAnchor="middle" fill="var(--text-dim)" fontSize={9} transform={`rotate(-30, ${labelWidth + xi * (cellSize + xGap) + cellSize / 2}, ${labelHeight - 4})`}>
            {x}
          </text>))}
        {yLabels.map((y, yi) => xLabels.map((x, xi) => {
            const cell = lookup.get(`${x}|${y}`);
            const v = cell?.value ?? 0;
            const t = v / max;
            const fill = v === 0
                ? colorScale.empty
                : mixColors(colorScale.low, colorScale.high, t);
            const cx = labelWidth + xi * (cellSize + xGap);
            const cy = labelHeight + yi * (cellSize + yGap);
            return (<g key={`c-${x}-${y}`}>
                <rect x={cx} y={cy} width={cellSize} height={cellSize} rx={2} fill={fill} stroke="var(--border)" strokeWidth={0.5}>
                  <title>
                    {x} · {y} · {valueFormatter(v)}
                  </title>
                </rect>
                {showLabels && v > 0 && (<text x={cx + cellSize / 2} y={cy + cellSize / 2 + 2} textAnchor="middle" fill={t > 0.6 ? '#fff' : 'var(--text-muted)'} fontSize={8}>
                    {valueFormatter(v)}
                  </text>)}
              </g>);
        }))}
      </svg>
    </div>);
}
function mixColors(a, b, t) {
    const ca = hexToRgb(a);
    const cb = hexToRgb(b);
    if (!ca || !cb)
        return a;
    const r = Math.round(ca.r + (cb.r - ca.r) * t);
    const g = Math.round(ca.g + (cb.g - ca.g) * t);
    const bl = Math.round(ca.b + (cb.b - ca.b) * t);
    return `rgb(${r}, ${g}, ${bl})`;
}
function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) {
        const rgb = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(hex);
        if (rgb)
            return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
        return null;
    }
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
//# sourceMappingURL=Heatmap.js.map