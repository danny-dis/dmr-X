import { type SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number; className?: string };

export function EmptyProviders({ size = 120, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" className={className}>
      <circle cx="60" cy="60" r="58" fill="url(#ep-g)" opacity="0.4" />
      <defs>
        <linearGradient id="ep-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7C5CFF" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#22D3EE" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="22" stroke="#3A4055" strokeWidth="1.5" fill="#11131A" />
      <circle cx="60" cy="60" r="4" fill="#7C5CFF" />
      <circle cx="30" cy="35" r="6" stroke="#3A4055" strokeWidth="1.5" fill="#11131A" />
      <circle cx="90" cy="35" r="6" stroke="#3A4055" strokeWidth="1.5" fill="#11131A" />
      <circle cx="30" cy="85" r="6" stroke="#3A4055" strokeWidth="1.5" fill="#11131A" />
      <circle cx="90" cy="85" r="6" stroke="#3A4055" strokeWidth="1.5" fill="#11131A" />
      <path d="M60 60L30 35M60 60L90 35M60 60L30 85M60 60L90 85" stroke="#3A4055" strokeWidth="1.2" strokeDasharray="3 3" />
    </svg>
  );
}

export function EmptyRequests({ size = 120, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" className={className}>
      <rect x="20" y="40" width="80" height="50" rx="6" stroke="#3A4055" strokeWidth="1.5" fill="#11131A" />
      <path d="M30 60h60M30 70h45M30 80h30" stroke="#3A4055" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="90" cy="30" r="12" stroke="#7C5CFF" strokeWidth="1.5" fill="#11131A" />
      <path d="M90 25v5l3 3" stroke="#7C5CFF" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyCharts({ size = 120, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" className={className}>
      <path d="M20 100L40 70L60 80L80 40L100 50" stroke="#3A4055" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 100h80" stroke="#3A4055" strokeWidth="1" />
      <circle cx="40" cy="70" r="3" fill="#7C5CFF" />
      <circle cx="80" cy="40" r="3" fill="#22D3EE" />
    </svg>
  );
}

export function EmptySettings({ size = 120, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" className={className}>
      <circle cx="60" cy="60" r="18" stroke="#3A4055" strokeWidth="1.5" fill="#11131A" />
      <path d="M60 42v-8M60 86v-8M42 60h-8M86 60h-8M48 48l-6-6M72 72l6 6M48 72l-6 6M72 48l6-6" stroke="#3A4055" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function EmptySearch({ size = 120, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" className={className}>
      <circle cx="52" cy="52" r="22" stroke="#3A4055" strokeWidth="1.5" fill="#11131A" />
      <path d="M68 68L86 86" stroke="#3A4055" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyError({ size = 120, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" className={className}>
      <circle cx="60" cy="60" r="40" stroke="#F87171" strokeWidth="1.5" strokeOpacity="0.4" fill="#11131A" />
      <path d="M60 40v26M60 76v.01" stroke="#F87171" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
