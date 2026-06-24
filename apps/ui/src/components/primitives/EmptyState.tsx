import * as React from 'react';

import { Card } from './Card';

import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  illustration?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function EmptyState({
  icon,
  illustration,
  title,
  description,
  action,
  size = 'md',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'sm' && 'py-6 gap-2',
        size === 'md' && 'py-10 gap-3',
        size === 'lg' && 'py-16 gap-4',
        className
      )}
    >
      {illustration ? (
        <div className="opacity-90">{illustration}</div>
      ) : icon ? (
        <div
          className={cn(
            'flex items-center justify-center rounded-2xl bg-surface-2 border border-border text-fg-muted',
            size === 'sm' && 'size-10',
            size === 'md' && 'size-14',
            size === 'lg' && 'size-20'
          )}
        >
          <span
            className={cn(
              size === 'sm' && '[&_svg]:size-5',
              size === 'md' && '[&_svg]:size-7',
              size === 'lg' && '[&_svg]:size-10'
            )}
          >
            {icon}
          </span>
        </div>
      ) : null}
      <div className="flex flex-col gap-1 max-w-sm">
        <h3
          className={cn(
            'font-semibold text-fg',
            size === 'sm' && 'text-sm',
            size === 'md' && 'text-base',
            size === 'lg' && 'text-lg'
          )}
        >
          {title}
        </h3>
        {description && (
          <p
            className={cn(
              'text-fg-muted leading-relaxed',
              size === 'sm' && 'text-xs',
              size === 'md' && 'text-sm',
              size === 'lg' && 'text-sm'
            )}
          >
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function EmptyStateCard(props: EmptyStateProps) {
  return (
    <Card padding="none" className="border-dashed">
      <EmptyState {...props} />
    </Card>
  );
}
