import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './Button';
export function CopyButton({ value, label = 'Copy', copiedLabel = 'Copied', size = 'icon-sm', variant = 'ghost', className, }) {
    const [copied, setCopied] = React.useState(false);
    const onClick = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }
        catch {
            // ignore
        }
    };
    return (<Button size={size} variant={variant} onClick={onClick} className={cn(className)} leftIcon={copied ? <Check className="text-success"/> : <Copy />} aria-label={label}>
      {size === 'icon' || size === 'icon-sm' ? null : copied ? copiedLabel : label}
    </Button>);
}
//# sourceMappingURL=CopyButton.js.map