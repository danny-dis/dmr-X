import { type SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

export function HealthDot({ size = 8, className = '', color = 'currentColor' }: { size?: number; className?: string; color?: string }) {
  return (
    <span className={`relative inline-flex ${className}`} style={{ width: size, height: size }}>
      <span className="absolute inset-0 rounded-full" style={{ background: color }} />
      <span
        className="absolute inset-0 rounded-full animate-ping"
        style={{ background: color, opacity: 0.5, animationDuration: '2s' }}
      />
    </span>
  );
}

export function Sparkline({ points, width = 80, height = 24, stroke = 'currentColor', fill = 'transparent', strokeWidth = 1.5 }: { points: number[]; width?: number; height?: number; stroke?: string; fill?: string; strokeWidth?: number }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - ((p - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });
  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {fill !== 'transparent' && <path d={area} fill={fill} />}
      <path d={path} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
