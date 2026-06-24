import * as React from 'react';

import { cn } from '@/lib/utils';

export function Kbd({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center min-w-5 h-5 px-1.5',
        'rounded-md border border-border bg-surface-2',
        'font-mono text-[10px] text-fg-muted',
        'shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.3)]',
        className
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}

export function KbdGroup({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('inline-flex items-center gap-0.5', className)}
      {...props}
    >
      {children}
    </span>
  );
}
