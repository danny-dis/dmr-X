import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';
export const Tabs = TabsPrimitive.Root;
const tabsListVariants = cva('inline-flex items-center gap-1', {
    variants: {
        variant: {
            default: 'h-9 rounded-lg bg-surface-1 border border-border p-1',
            pills: 'gap-2',
            underline: 'gap-4 border-b border-border',
        },
    },
    defaultVariants: { variant: 'default' },
});
export const TabsList = React.forwardRef(({ className, variant, ...props }, ref) => (<TabsPrimitive.List ref={ref} className={cn(tabsListVariants({ variant }), className)} {...props}/>));
TabsList.displayName = TabsPrimitive.List.displayName;
const tabsTriggerVariants = cva('inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50', {
    variants: {
        variant: {
            default: 'h-7 px-3 rounded-md text-fg-muted hover:text-fg data-[state=active]:bg-surface-3 data-[state=active]:text-fg data-[state=active]:shadow-[0_0_0_1px_rgba(255,255,255,0.04)]',
            pills: 'h-7 px-3 rounded-full text-fg-muted hover:text-fg hover:bg-surface-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border data-[state=active]:border-primary/20',
            underline: 'h-9 px-1 text-fg-muted hover:text-fg border-b-2 border-transparent data-[state=active]:text-fg data-[state=active]:border-primary',
        },
    },
    defaultVariants: { variant: 'default' },
});
export const TabsTrigger = React.forwardRef(({ className, variant, ...props }, ref) => (<TabsPrimitive.Trigger ref={ref} className={cn(tabsTriggerVariants({ variant }), className)} {...props}/>));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;
export const TabsContent = React.forwardRef(({ className, ...props }, ref) => (<TabsPrimitive.Content ref={ref} className={cn('mt-4 focus-visible:outline-none', className)} {...props}/>));
TabsContent.displayName = TabsPrimitive.Content.displayName;
//# sourceMappingURL=Tabs.js.map