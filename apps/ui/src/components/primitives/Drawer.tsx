import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

const Drawer = DialogPrimitive.Root;
const DrawerTrigger = DialogPrimitive.Trigger;
const DrawerClose = DialogPrimitive.Close;
const DrawerPortal = DialogPrimitive.Portal;

const overlayStyles = cn(
  'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out'
);

const drawerContentVariants = cva(
  'fixed z-50 bg-surface-1 border shadow-2xl flex flex-col data-[state=open]:animate-slide-in data-[state=closed]:animate-slide-out',
  {
    variants: {
      side: {
        right:
          'right-0 top-0 bottom-0 h-full w-full max-w-md border-l border-border rounded-l-2xl',
        left:
          'left-0 top-0 bottom-0 h-full w-full max-w-md border-r border-border rounded-r-2xl',
        top: 'top-0 left-0 right-0 max-h-[85vh] border-b border-border rounded-b-2xl',
        bottom: 'bottom-0 left-0 right-0 max-h-[85vh] border-t border-border rounded-t-2xl',
      },
      size: {
        sm: '',
        md: '',
        lg: '',
        xl: '',
        full: '',
      },
    },
    compoundVariants: [
      { side: 'right', size: 'sm', className: 'max-w-sm' },
      { side: 'right', size: 'md', className: 'max-w-md' },
      { side: 'right', size: 'lg', className: 'max-w-xl' },
      { side: 'right', size: 'xl', className: 'max-w-3xl' },
      { side: 'right', size: 'full', className: 'max-w-[90vw]' },
      { side: 'left', size: 'sm', className: 'max-w-sm' },
      { side: 'left', size: 'md', className: 'max-w-md' },
      { side: 'left', size: 'lg', className: 'max-w-xl' },
      { side: 'left', size: 'xl', className: 'max-w-3xl' },
      { side: 'left', size: 'full', className: 'max-w-[90vw]' },
    ],
    defaultVariants: {
      side: 'right',
      size: 'md',
    },
  }
);

export interface DrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof drawerContentVariants> {
  showClose?: boolean;
}

export const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(({ className, side, size, showClose = true, children, ...props }, ref) => (
  <DrawerPortal>
    <DialogPrimitive.Overlay className={overlayStyles} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(drawerContentVariants({ side, size }), className)}
      {...props}
    >
      {children}
      {showClose && (
        <DialogPrimitive.Close
          className={cn(
            'absolute right-4 top-4 rounded-md p-1.5 text-fg-muted',
            'hover:text-fg hover:bg-surface-2 transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
          )}
          aria-label="Close"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DrawerPortal>
));
DrawerContent.displayName = 'DrawerContent';

export const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col gap-1.5 p-5 border-b border-border',
      className
    )}
    {...props}
  />
);

export const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base font-semibold text-fg', className)}
    {...props}
  />
));
DrawerTitle.displayName = 'DrawerTitle';

export const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-xs text-fg-muted leading-relaxed', className)}
    {...props}
  />
));
DrawerDescription.displayName = 'DrawerDescription';

export const DrawerBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex-1 overflow-y-auto p-5', className)}
    {...props}
  />
);

export const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex items-center justify-end gap-2 p-4 border-t border-border',
      className
    )}
    {...props}
  />
);

export { Drawer, DrawerTrigger, DrawerClose, DrawerPortal };
