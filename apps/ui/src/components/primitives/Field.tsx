import * as React from 'react';

import { cn } from '@/lib/utils';

export const Field = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    orientation?: 'vertical' | 'horizontal';
  }
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex gap-3',
      orientation === 'vertical' ? 'flex-col' : 'flex-row items-center',
      className
    )}
    {...props}
  />
));
Field.displayName = 'Field';

export const FieldLabel = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }
>(({ className, children, required, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      'text-xs font-medium text-fg flex items-center gap-1',
      className
    )}
    {...props}
  >
    {children}
    {required && <span className="text-danger">*</span>}
  </label>
));
FieldLabel.displayName = 'FieldLabel';

export const FieldDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-[11px] text-fg-muted leading-relaxed', className)}
    {...props}
  />
));
FieldDescription.displayName = 'FieldDescription';

export const FieldError = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-[11px] text-danger leading-relaxed', className)}
    {...props}
  />
));
FieldError.displayName = 'FieldError';
