import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '@/lib/utils';
const toneClass = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    accent: 'bg-accent',
};
const sizeClass = {
    sm: 'h-1',
    md: 'h-1.5',
    lg: 'h-2.5',
};
export const Progress = React.forwardRef(({ className, value, tone = 'primary', size = 'md', ...props }, ref) => (<ProgressPrimitive.Root ref={ref} className={cn('relative w-full overflow-hidden rounded-full bg-surface-2', sizeClass[size], className)} {...props}>
    <ProgressPrimitive.Indicator className={cn('h-full transition-transform duration-500 ease-out', toneClass[tone])} style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}/>
  </ProgressPrimitive.Root>));
Progress.displayName = 'Progress';
//# sourceMappingURL=Progress.js.map