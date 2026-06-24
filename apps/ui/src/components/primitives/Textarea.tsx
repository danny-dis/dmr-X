import * as React from 'react';

import { cn } from '@/lib/utils';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, size = 'md', rows = 4, ...props }, ref) => {
    const sizeClass = {
      sm: 'text-xs px-2.5 py-1.5',
      md: 'text-sm px-3 py-2',
      lg: 'text-sm px-4 py-3',
    }[size];
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          'flex w-full rounded-lg border bg-surface-2 transition-colors resize-y',
          'placeholder:text-fg-subtle outline-none',
          'focus:border-primary/40 focus:ring-2 focus:ring-primary/20',
          invalid
            ? 'border-danger/40 ring-1 ring-danger/20'
            : 'border-border',
          sizeClass,
          props.disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';
