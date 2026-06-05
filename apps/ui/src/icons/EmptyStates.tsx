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
