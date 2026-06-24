import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap border',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-2 text-fg-muted border-border',
        primary:
          'bg-primary/10 text-primary border-primary/20',
        success:
          'bg-success/10 text-success border-success/20',
        warning:
          'bg-warning/10 text-warning border-warning/20',
        danger:
          'bg-danger/10 text-danger border-danger/20',
        info: 'bg-accent/10 text-accent border-accent/20',
        muted: 'bg-surface-2/60 text-fg-subtle border-border/60',
      },
      size: {
        sm: 'h-5 px-2 text-[10px] tracking-wide uppercase',
        md: 'h-6 px-2.5 text-xs',
        lg: 'h-7 px-3 text-sm',
      },
      variant: {
        solid: '',
        outline: 'bg-transparent',
        soft: '',
        secondary: 'bg-surface-2 text-fg-muted border-border',
      },
    },
    compoundVariants: [
      {
        tone: 'primary',
        variant: 'outline',
        className: 'bg-transparent',
      },
    ],
    defaultVariants: {
      tone: 'neutral',
      size: 'md',
      variant: 'soft',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  icon?: React.ReactNode;
  uppercase?: boolean;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    { className, tone, size, variant, icon, uppercase, children, ...props },
    ref
  ) => (
    <span
      ref={ref}
      className={cn(
        badgeVariants({ tone, size, variant }),
        uppercase && 'uppercase tracking-wider',
        className
      )}
      {...props}
    >
      {icon && <span className="flex items-center">{icon}</span>}
      {children}
    </span>
  )
);
Badge.displayName = 'Badge';
