import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
  /** Optional label rendered above the trigger. */
  label?: string;
  /** Optional helper text rendered below the trigger. */
  description?: string;
}

function MultiSelectTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>) {
  return (
    <PopoverPrimitive.Trigger
      className={cn(
        'flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border bg-surface-2',
        'border-border px-3 py-1.5 text-sm text-fg outline-none transition-colors',
        'focus:border-primary/40 focus:ring-2 focus:ring-primary/20',
        'data-[placeholder]:text-fg-subtle',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
      {/* NOTE: @radix-ui/react-popover exposes no `Icon` part (unlike
          react-select), so the chevron is rendered directly. Wrapping it
          in a non-existent `PopoverPrimitive.Icon` element was a hard
          build-breaking import error that prevented the entire UI bundle
          from compiling. */}
      <ChevronDown className="size-3.5 shrink-0 text-fg-muted" />
    </PopoverPrimitive.Trigger>
  );
}
MultiSelectTrigger.displayName = PopoverPrimitive.Trigger.displayName;

function MultiSelectContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        className={cn(
          'z-50 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-lg',
          'border border-border bg-surface-1 shadow-2xl',
          'data-[state=open]:animate-fade-in',
          className
        )}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
MultiSelectContent.displayName = PopoverPrimitive.Content.displayName;

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results.',
  className,
  disabled,
  label,
  description,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const selectedSet = React.useMemo(() => new Set(value), [value]);
  const selectedOptions = React.useMemo(
    () => options.filter(o => selectedSet.has(o.value)),
    [options, selectedSet]
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      o =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.description ?? '').toLowerCase().includes(q)
    );
  }, [options, query]);

  const toggle = (v: string) => {
    if (selectedSet.has(v)) {
      onChange(value.filter(x => x !== v));
    } else {
      onChange([...value, v]);
    }
  };

  const triggerLabel = (
    <span className="flex flex-1 flex-wrap gap-1.5">
      {selectedOptions.length === 0 ? (
        <span className="text-fg-subtle">{placeholder}</span>
      ) : (
        selectedOptions.map(o => (
          <span
            key={o.value}
            className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
          >
            {o.label}
          </span>
        ))
      )}
    </span>
  );

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <label className="text-sm font-medium">{label}</label>}
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <MultiSelectTrigger disabled={disabled}>
          {triggerLabel}
        </MultiSelectTrigger>
        <MultiSelectContent align="start">
          <div className="flex items-center gap-2 border-b border-border px-3" cmdk-input-wrapper="">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 w-full bg-transparent text-xs outline-none placeholder:text-fg-subtle"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-xs text-fg-muted">{emptyText}</p>
            ) : (
              filtered.map(o => {
                const checked = selectedSet.has(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(o.value)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none',
                      'transition-colors hover:bg-surface-2 focus-visible:bg-surface-2',
                      'data-[selected=true]:bg-surface-2'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-md border',
                        checked
                          ? 'border-primary bg-primary text-white'
                          : 'border-border bg-surface-2'
                      )}
                    >
                      {checked && <Check className="size-3" />}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-xs font-medium text-fg">{o.label}</span>
                      {o.description && (
                        <span className="truncate text-[11px] text-fg-muted">
                          {o.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {selectedOptions.length > 0 && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-fg-muted outline-none hover:bg-surface-2 hover:text-fg"
              >
                Clear selection ({selectedOptions.length})
              </button>
            </div>
          )}
        </MultiSelectContent>
      </PopoverPrimitive.Root>
      {description && (
        <p className="text-[11px] text-fg-muted leading-relaxed">{description}</p>
      )}
    </div>
  );
}

export { MultiSelectTrigger, MultiSelectContent };
