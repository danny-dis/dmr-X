import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { HealthDot } from '@/icons/Status';
import { cn } from '@/lib/utils';

export type StatusKind =
  | 'online'
  | 'healthy'
  | 'degraded'
  | 'warning'
  | 'offline'
  | 'unknown'
  | 'pending'
  | 'active';

const statusConfig: Record<
  StatusKind,
  { color: string; bg: string; text: string; border: string; label: string }
> = {
  online: {
    color: '#34D399',
    bg: 'bg-success/10',
    text: 'text-success',
    border: 'border-success/20',
    label: 'Online',
  },
  healthy: {
    color: '#34D399',
    bg: 'bg-success/10',
    text: 'text-success',
    border: 'border-success/20',
    label: 'Healthy',
  },
  degraded: {
    color: '#FBBF24',
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
    label: 'Degraded',
  },
  warning: {
    color: '#FBBF24',
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
    label: 'Warning',
  },
  offline: {
    color: '#F87171',
    bg: 'bg-danger/10',
    text: 'text-danger',
    border: 'border-danger/20',
    label: 'Offline',
  },
  unknown: {
    color: '#6B7080',
    bg: 'bg-surface-2',
    text: 'text-fg-muted',
    border: 'border-border',
    label: 'Unknown',
  },
  pending: {
    color: '#22D3EE',
    bg: 'bg-accent/10',
    text: 'text-accent',
    border: 'border-accent/20',
    label: 'Pending',
  },
  active: {
    color: '#7C5CFF',
    bg: 'bg-primary/10',
    text: 'text-primary',
    border: 'border-primary/20',
    label: 'Active',
  },
};

const sizeStyles = cva(
  'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
  {
    variants: {
      size: {
        sm: 'h-5 px-2 text-[10px] uppercase tracking-wider',
        md: 'h-6 px-2.5 text-xs',
        lg: 'h-7 px-3 text-sm',
      },
    },
    defaultVariants: { size: 'md' },
  }
);

export interface StatusPillProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>,
    VariantProps<typeof sizeStyles> {
  status: StatusKind;
  label?: string;
  pulse?: boolean;
  showDot?: boolean;
}

export const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  (
    { className, status, size, label, pulse = true, showDot = true, ...props },
    ref
  ) => {
    const s = statusConfig[status];
    const shouldPulse =
      pulse && (status === 'online' || status === 'healthy' || status === 'active' || status === 'pending');
    return (
      <span
        ref={ref}
        className={cn(
          sizeStyles({ size }),
          s.bg,
          s.text,
          s.border,
          className
        )}
        {...props}
      >
        {showDot && (
          shouldPulse ? (
            <HealthDot size={size === 'sm' ? 6 : size === 'lg' ? 10 : 8} color={s.color} />
          ) : (
            <span
              className="inline-block rounded-full"
              style={{
                width: size === 'sm' ? 6 : size === 'lg' ? 10 : 8,
                height: size === 'sm' ? 6 : size === 'lg' ? 10 : 8,
                background: s.color,
              }}
              aria-hidden
            />
          )
        )}
        {label ?? s.label}
      </span>
    );
  }
);
StatusPill.displayName = 'StatusPill';
