import { type SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (props: IconProps) => {
  const { size = 24, ...rest } = props;
  return { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...rest };
};

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

export function PulseRing({ size = 24, className = '' }: IconProps) {
  return (
    <span className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <span className="absolute inset-0 rounded-full" style={{ background: 'currentColor', opacity: 0.15 }} />
      <span
        className="absolute rounded-full pulse-dot"
        style={{
          inset: 0,
          border: '2px solid currentColor',
          opacity: 0.4,
          animation: 'pulse-ring 2s var(--ease) infinite',
        }}
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

export function ConnectionLine({ orientation = 'horizontal', className = '' }: { orientation?: 'horizontal' | 'vertical' | 'curved'; className?: string }) {
  if (orientation === 'curved') {
    return (
      <svg width="40" height="20" viewBox="0 0 40 20" className={className}>
        <path d="M0 10 Q 20 0, 40 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
      </svg>
    );
  }
  return (
    <svg width={orientation === 'vertical' ? 4 : 40} height={orientation === 'vertical' ? 40 : 4} className={className}>
      <line x1="0" y1="0" x2={orientation === 'vertical' ? 0 : 40} y2={orientation === 'vertical' ? 40 : 0} stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
    </svg>
  );
}

export function RingLoader({ size = 24, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.2" />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="14 100" strokeLinecap="round" className="animate-spin" style={{ transformOrigin: 'center' }} />
    </svg>
  );
}

export function LiveBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="relative inline-flex w-2 h-2">
        <span className="absolute inset-0 rounded-full bg-danger opacity-60 animate-ping" />
        <span className="relative inline-flex w-2 h-2 rounded-full bg-danger" />
      </span>
      <span className="text-[10px] font-semibold tracking-wider text-danger">LIVE</span>
    </span>
  );
}
