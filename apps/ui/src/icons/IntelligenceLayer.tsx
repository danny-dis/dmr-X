import { type SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number; color?: string };

const base = (props: IconProps) => {
  const { size = 24, ...rest } = props;
  return { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...rest };
};

export function BrainIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5v1a3 3 0 0 0 3 3 3 3 0 0 0 3-3V4a3 3 0 0 0-3 0z" />
      <path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-2 5v1a3 3 0 0 1-3 3 3 3 0 0 1-3-3" />
      <path d="M12 7v13M9 10h.01M9 14h.01M9 18h.01" />
    </svg>
  );
}

export function ThinkerIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M10 8h.01M14 8h.01" />
      <path d="M12 4.5v-1M8 6L7 5M16 6l1-1" />
    </svg>
  );
}

export function ExecutorIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M9 11l3 2-3 2v-4z" fill="currentColor" />
      <path d="M14 10h4M14 14h3" />
    </svg>
  );
}

export function WorkerIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6" y="4" width="12" height="12" rx="1.5" />
      <path d="M6 9h12M9 4v-1M12 4v-1M15 4v-1" />
      <path d="M4 20h16" />
      <path d="M9 12l3 2 3-2" />
    </svg>
  );
}

export function TempWorkerIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M3 12h6M15 12h6M12 3v6M12 15v6" />
      <path d="M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4" strokeOpacity="0.5" />
    </svg>
  );
}

export const IntelligenceLayerIcons = {
  brain: BrainIcon,
  thinker: ThinkerIcon,
  executor: ExecutorIcon,
  worker: WorkerIcon,
  temp_worker: TempWorkerIcon,
};

export type IntelligenceLayerName = keyof typeof IntelligenceLayerIcons;

export function IntelligenceBadge({ layer, size = 18, className = '' }: { layer: keyof typeof IntelligenceLayerIcons; size?: number; className?: string }) {
  const Icon = IntelligenceLayerIcons[layer] || WorkerIcon;
  const colors: Record<string, string> = {
    brain: 'text-pink',
    thinker: 'text-primary',
    executor: 'text-accent',
    worker: 'text-success',
    temp_worker: 'text-warning',
  };
  return <Icon size={size} className={`${colors[layer] || 'text-muted'} ${className}`} />;
}
