import { Copy, Check } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface CodeProps extends React.HTMLAttributes<HTMLElement> {
  inline?: boolean;
  copyable?: boolean;
  /**
   * Optional language identifier for syntax labelling (e.g. "json", "bash").
   * The component doesn't apply highlighting itself; this is metadata that
   * downstream tools (or `data-language` selectors) can pick up.
   */
  language?: string;
}

export const Code = React.forwardRef<HTMLElement, CodeProps>(
  ({ className, inline = true, copyable = false, language, children, ...props }, ref) => {
    const [copied, setCopied] = React.useState(false);
    const text = typeof children === 'string' ? children : '';

    const onCopy = async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // ignore
      }
    };

    if (inline) {
      return (
        <code
          ref={ref}
          className={cn(
            'rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg',
            className
          )}
          data-language={language}
          {...props}
        >
          {children}
        </code>
      );
    }

    return (
      <div className="relative group/code">
        <pre
          className={cn(
            'overflow-x-auto rounded-xl border border-border bg-surface-2 p-3',
            'font-mono text-[11px] leading-relaxed text-fg',
            className
          )}
          data-language={language}
        >
          <code ref={ref} {...props}>
            {children}
          </code>
        </pre>
        {copyable && (
          <button
            onClick={onCopy}
            className={cn(
              'absolute right-2 top-2 rounded-md p-1.5 bg-surface-1/80 border border-border',
              'text-fg-muted opacity-0 transition-opacity hover:text-fg',
              'group-hover/code:opacity-100'
            )}
            aria-label="Copy code"
          >
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          </button>
        )}
      </div>
    );
  }
);
Code.displayName = 'Code';
