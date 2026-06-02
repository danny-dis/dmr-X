import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  invalid?: boolean;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, prefix, suffix, size = 'md', type = 'text', ...props }, ref) => {
    const sizeClass = {
      sm: 'h-7 text-xs px-2.5',
      md: 'h-9 text-sm px-3',
      lg: 'h-11 text-sm px-4',
    }[size];
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border bg-surface-2 transition-colors',
          'focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/20',
          invalid
            ? 'border-danger/40 ring-1 ring-danger/20'
            : 'border-border',
          sizeClass,
          props.disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
      >
        {prefix && (
          <span className="text-fg-muted shrink-0 flex items-center [&_svg]:size-3.5">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          type={type}
          className={cn(
            'flex-1 bg-transparent outline-none placeholder:text-fg-subtle min-w-0',
            'text-fg'
          )}
          {...props}
        />
        {suffix && (
          <span className="text-fg-muted shrink-0 flex items-center [&_svg]:size-3.5">
            {suffix}
          </span>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';
