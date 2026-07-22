import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { Badge } from '@/components/primitives';
import { cn } from '@/lib/utils';

interface PanelShellProps {
  title: string;
  icon?: React.ReactNode;
  description?: string;
  endpoints?: string[];
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Shared chrome for the platform-capability Playground panels. */
export function PanelShell({ title, icon, description, endpoints, actions, children, className }: PanelShellProps) {
  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {icon ? <span className="text-fg-muted">{icon}</span> : null}
            <h2 className="text-sm font-semibold text-fg">{title}</h2>
            {endpoints?.length ? (
              <Badge tone="muted" size="sm" variant="soft" className="font-mono">
                {endpoints.length} endpoint{endpoints.length === 1 ? '' : 's'}
              </Badge>
            ) : null}
          </div>
          {description ? <p className="mt-0.5 text-xs text-fg-subtle">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
    </div>
  );
}

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Minimal data-fetching helper for the capability panels. Call fn when
 * `deps` change (or via the returned refetch). Keeps error/loading local.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList): AsyncState<T> & { refetch: () => void } {
  const [state, setState] = React.useState<AsyncState<T>>({ data: null, loading: true, error: null });
  const fnRef = React.useRef(fn);
  fnRef.current = fn;

  const run = React.useCallback(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ data: null, loading: false, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  React.useEffect(run, [run]);
  return { ...state, refetch: run };
}

export function PanelLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-fg-muted">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function PanelError({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      <p className="font-medium">Request failed</p>
      <p className="mt-1 font-mono text-xs text-destructive/80">{error}</p>
      {onRetry ? (
        <button onClick={onRetry} className="mt-2 text-xs underline underline-offset-2 hover:opacity-80">
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-fg-subtle">{children}</p>;
}

/** Pretty-print a JSON-ish value for result panels. */
export function JsonView({ value }: { value: unknown }) {
  const text = React.useMemo(() => {
    try {
      return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);
  return (
    <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-surface-1 p-3 font-mono text-xs text-fg-muted">
      {text}
    </pre>
  );
}
