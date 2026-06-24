import { Check, Copy } from 'lucide-react';
import * as React from 'react';

import { Button } from './Button';

import { cn } from '@/lib/utils';


export interface CopyButtonProps {
  value: string;
  label?: string;
  copiedLabel?: string;
  size?: 'sm' | 'icon-sm' | 'icon';
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
  className?: string;
}

export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  size = 'icon-sm',
  variant = 'ghost',
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <Button
      size={size}
      variant={variant}
      onClick={onClick}
      className={cn(className)}
      leftIcon={
        copied ? <Check className="text-success" /> : <Copy />
      }
      aria-label={label}
    >
      {size === 'icon' || size === 'icon-sm' ? null : copied ? copiedLabel : label}
    </Button>
  );
}
