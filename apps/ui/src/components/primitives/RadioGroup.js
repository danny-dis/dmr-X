import * as React from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { cn } from '@/lib/utils';
export const RadioGroup = React.forwardRef(({ className, ...props }, ref) => (<RadioGroupPrimitive.Root ref={ref} className={cn('grid gap-2', className)} {...props}/>));
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;
export const RadioGroupItem = React.forwardRef(({ className, ...props }, ref) => (<RadioGroupPrimitive.Item ref={ref} className={cn('aspect-square size-4 rounded-full border border-border bg-surface-2 text-primary', 'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', 'disabled:cursor-not-allowed disabled:opacity-50', 'data-[state=checked]:border-primary', className)} {...props}>
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
      <span className="size-2 rounded-full bg-primary"/>
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>));
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;
//# sourceMappingURL=RadioGroup.js.map