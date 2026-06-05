import { type SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

export function ProviderMark({ size = 20, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <defs>
        <linearGradient id="pm-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      <path d="M12 2l9 5v10l-9 5-9-5V7l9-5z" stroke="url(#pm-g)" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
      <circle cx="12" cy="6" r="0.8" fill="currentColor" />
      <circle cx="12" cy="18" r="0.8" fill="currentColor" />
      <circle cx="6.5" cy="9" r="0.8" fill="currentColor" />
      <circle cx="17.5" cy="9" r="0.8" fill="currentColor" />
      <circle cx="6.5" cy="15" r="0.8" fill="currentColor" />
      <circle cx="17.5" cy="15" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function ProviderHub({ size = 24, ...props }: IconProps) {
  return (
    <svg {...props} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M12 9V4M12 20v-5M9 12H4M20 12h-5" />
      <circle cx="12" cy="3" r="1" />
      <circle cx="12" cy="21" r="1" />
      <circle cx="3" cy="12" r="1" />
      <circle cx="21" cy="12" r="1" />
    </svg>
  );
}
