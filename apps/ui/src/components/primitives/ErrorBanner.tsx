import * as React from 'react';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BannerTone = 'error' | 'warning' | 'info' | 'success';

const toneStyles: Record<
  BannerTone,
  { bg: string; border: string; text: string; icon: React.ReactNode }
> = {
  error: {
    bg: 'bg-danger/[0.06]',
    border: 'border-danger/20',
    text: 'text-danger',
    icon: <AlertCircle className="size-4" />,
  },
  warning: {
    bg: 'bg-warning/[0.06]',
    border: 'border-warning/20',
    text: 'text-warning',
    icon: <AlertTriangle className="size-4" />,
  },
  info: {
    bg: 'bg-accent/[0.06]',
    border: 'border-accent/20',
    text: 'text-accent',
    icon: <Info className="size-4" />,
  },
  success: {
    bg: 'bg-success/[0.06]',
    border: 'border-success/20',
    text: 'text-success',
    icon: <AlertCircle className="size-4" />,
  },
};

export interface ErrorBannerProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: BannerTone;
  title?: string;
  dismissible?: boolean;
  onDismiss?: () => void;
  action?: React.ReactNode;
}

export function ErrorBanner({
  tone = 'error',
  title,
  dismissible = false,
  onDismiss,
  action,
  className,
  children,
  ...props
}: ErrorBannerProps) {
  const s = toneStyles[tone];
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3',
        s.bg,
        s.border,
        className
      )}
      {...props}
    >
      <span className={cn('mt-0.5 shrink-0', s.text)}>{s.icon}</span>
      <div className="flex-1 min-w-0">
        {title && (
          <div className={cn('text-sm font-semibold', s.text)}>{title}</div>
        )}
        {children && (
          <div
            className={cn(
              'text-xs leading-relaxed',
              title ? 'mt-0.5 text-fg-muted' : 'text-fg'
            )}
          >
            {children}
          </div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
      {dismissible && (
        <button
          onClick={onDismiss}
          className={cn(
            'shrink-0 rounded-md p-1 text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors'
          )}
          aria-label="Dismiss"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
