import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-150 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-white shadow-[0_0_0_1px_rgba(124,92,255,0.4),0_8px_24px_-12px_rgba(124,92,255,0.6)] hover:bg-primary-hover hover:shadow-[0_0_0_1px_rgba(124,92,255,0.5),0_12px_28px_-12px_rgba(124,92,255,0.7)] active:scale-[0.98]',
        secondary:
          'bg-surface-2 text-fg border border-border hover:bg-surface-3 hover:border-border-strong active:scale-[0.98]',
        ghost:
          'text-fg-muted hover:text-fg hover:bg-surface-2 active:scale-[0.98]',
        outline:
          'border border-border bg-transparent text-fg hover:bg-surface-2 hover:border-border-strong',
        danger:
          'bg-danger text-white shadow-[0_0_0_1px_rgba(248,113,113,0.4),0_8px_24px_-12px_rgba(248,113,113,0.6)] hover:bg-danger-hover active:scale-[0.98]',
        link: 'text-primary underline-offset-4 hover:underline px-0',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs rounded-md',
        md: 'h-9 px-3.5 text-sm rounded-lg',
        lg: 'h-11 px-5 text-sm rounded-lg',
        icon: 'size-9 rounded-lg',
        'icon-sm': 'size-7 rounded-md',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      leftIcon,
      rightIcon,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';

    if (asChild) {
      return (
        <Comp
          ref={ref}
          className={cn(buttonVariants({ variant, size }), className)}
          {...props}
        >
          {children}
        </Comp>
      );
    }

    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          leftIcon
        )}
        {children}
        {!loading && rightIcon}
      </Comp>
    );
  }
);
Button.displayName = 'Button';

export { buttonVariants };
