import * as React from 'react';
import { cn } from '@/lib/utils';

export function PageContainer({
  children,
  className,
  size = 'default',
}: {
  children: React.ReactNode;
  className?: string;
  size?: 'default' | 'wide' | 'narrow' | 'full';
}) {
  const sizeClass = {
    default: 'max-w-7xl',
    wide: 'max-w-[1600px]',
    narrow: 'max-w-4xl',
    full: 'max-w-none',
  }[size];

  return (
    <div className={cn('mx-auto w-full px-6 py-6', sizeClass, className)}>
      {children}
    </div>
  );
}
