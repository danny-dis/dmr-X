import * as React from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
export const Accordion = AccordionPrimitive.Root;
export const AccordionItem = React.forwardRef(({ className, ...props }, ref) => (<AccordionPrimitive.Item ref={ref} className={cn('border-b border-border', className)} {...props}/>));
AccordionItem.displayName = 'AccordionItem';
export const AccordionTrigger = React.forwardRef(({ className, children, ...props }, ref) => (<AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger ref={ref} className={cn('flex flex-1 items-center justify-between py-3 text-sm font-medium text-fg transition-all', '[&[data-state=open]>svg]:rotate-180 hover:text-primary', className)} {...props}>
      {children}
      <ChevronDown className="size-4 text-fg-muted shrink-0 transition-transform duration-200"/>
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>));
AccordionTrigger.displayName = 'AccordionTrigger';
export const AccordionContent = React.forwardRef(({ className, children, ...props }, ref) => (<AccordionPrimitive.Content ref={ref} className="overflow-hidden text-sm text-fg-muted data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down" {...props}>
    <div className={cn('pb-3 pt-0', className)}>{children}</div>
  </AccordionPrimitive.Content>));
AccordionContent.displayName = 'AccordionContent';
//# sourceMappingURL=Accordion.js.map