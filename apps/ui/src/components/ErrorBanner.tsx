import { X } from 'lucide-react';

interface ErrorBannerProps {
  error: string | null;
  onDismiss?: () => void;
}

export function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  if (!error) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-[#FF4D6A]/10 border border-[#FF4D6A]/30 rounded-lg">
      <div className="flex-1 text-xs text-[#FF4D6A]">
        {error}
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="p-1 text-[#FF4D6A]/60 hover:text-[#FF4D6A] transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
