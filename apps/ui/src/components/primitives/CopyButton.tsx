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
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
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
