import { type SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (props: IconProps) => {
  const { size = 24, ...rest } = props;
  return { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...rest };
};

export function TextIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 5h14M12 5v14M8 19h8" />
    </svg>
  );
}

export function CodeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 5l-4 14" />
    </svg>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M21 16l-5-5-9 8" />
    </svg>
  );
}

export function AudioIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 11v2" />
    </svg>
  );
}

export function VideoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3" />
    </svg>
  );
}

export function EmbeddingIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="6" r="1.5" />
      <circle cx="18" cy="6" r="1.5" />
      <circle cx="6" cy="18" r="1.5" />
      <circle cx="18" cy="18" r="1.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M7.3 7.3L10.5 10.5M16.7 7.3L13.5 10.5M7.3 16.7L10.5 13.5M16.7 16.7L13.5 13.5" />
    </svg>
  );
}

export function MusicIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

export function RerankingIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 6h10M3 12h7M3 18h13" />
      <path d="M17 4l3 3-3 3" />
      <path d="M20 14l-3 3 3 3" />
    </svg>
  );
}

const ModalityIcons = {
  llm: TextIcon,
  text: TextIcon,
  code: CodeIcon,
  code_completion: CodeIcon,
  diffusion: ImageIcon,
  image: ImageIcon,
  audio_tts: AudioIcon,
  audio_stt: AudioIcon,
  audio_speech: AudioIcon,
  audio_transcription: AudioIcon,
  video: VideoIcon,
  music: MusicIcon,
  embedding: EmbeddingIcon,
  reranking: RerankingIcon,
  moderation: ShieldCheckIcon,
  image_upscaling: ImageIcon,
  image_inpainting: ImageIcon,
} as const;

function ShieldCheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l8 3v5c0 5-3.4 9-8 10-4.6-1-8-5-8-10V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

const modalityColors: Record<string, string> = {
  llm: 'text-primary',
  text: 'text-primary',
  code: 'text-accent',
  code_completion: 'text-accent',
  diffusion: 'text-pink',
  image: 'text-pink',
  audio_tts: 'text-warning',
  audio_stt: 'text-warning',
  audio_speech: 'text-warning',
  audio_transcription: 'text-warning',
  video: 'text-info',
  music: 'text-info',
  embedding: 'text-success',
  reranking: 'text-lime',
  moderation: 'text-danger',
  image_upscaling: 'text-pink',
  image_inpainting: 'text-pink',
};

export function ModalityBadge({ modality, size = 16, className = '' }: { modality: string; size?: number; className?: string }) {
  const Icon = (ModalityIcons as Record<string, any>)[modality] || TextIcon;
  const color = modalityColors[modality] || 'text-muted';
  return <Icon size={size} className={`${color} ${className}`} />;
}
