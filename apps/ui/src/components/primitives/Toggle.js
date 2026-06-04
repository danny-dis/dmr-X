import * as React from 'react';
import * as TogglePrimitive from '@radix-ui/react-toggle';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const toggleVariants = cva('inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50', {
    variants: {
        variant: {
            default: 'bg-transparent text-fg-muted hover:bg-surface-2 hover:text-fg data-[state=on]:bg-primary/10 data-[state=on]:text-primary data-[state=on]:border data-[state=on]:border-primary/20',
            outline: 'border border-border bg-transparent text-fg-muted hover:bg-surface-2 hover:text-fg data-[state=on]:border-primary/50 data-[state=on]:text-primary',
        },
        size: {
            sm: 'h-7 px-2.5',
            md: 'h-9 px-3',
            lg: 'h-10 px-4',
            icon: 'size-9',
        },
    },
    defaultVariants: { variant: 'default', size: 'md' },
});
export const Toggle = React.forwardRef(({ className, variant, size, ...props }, ref) => (<TogglePrimitive.Root ref={ref} className={cn(toggleVariants({ variant, size }), className)} {...props}/>));
Toggle.displayName = TogglePrimitive.Root.displayName;
//# sourceMappingURL=Toggle.js.map