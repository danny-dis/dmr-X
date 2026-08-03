import {
  AlertTriangle,
  ChevronDown,
  Lock,
  PlugZap,
  RefreshCw,
  SearchX,
  ServerCrash,
  Timer,
} from 'lucide-react';
import * as React from 'react';

import { Button } from './Button';
import { Card } from './Card';

import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*  Error interpretation                                                      */
/* -------------------------------------------------------------------------- */

export interface InterpretedError {
  /** Short, human title. Never a raw status code. */
  title: string;
  /** What the user can actually do about it. */
  description: string;
  icon: React.ReactNode;
  /** Whether retrying could plausibly succeed. */
  retryable: boolean;
  /** Raw detail for the disclosure panel. */
  detail: string | null;
}

function bodyMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const candidates = [b.message, b.error, b.detail];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (c && typeof c === 'object') {
      const m = (c as Record<string, unknown>).message;
      if (typeof m === 'string' && m.trim()) return m.trim();
    }
  }
  return null;
}

/**
 * Turns an unknown thrown value into a message a human can act on.
 *
 * The gateway returns real messages in the body for most 4xx responses, so we
 * prefer those over our generic copy — but we always keep the generic
 * *description* since it's the part that says what to do next.
 */
export function interpretError(error: unknown): InterpretedError {
  const detail =
    error instanceof ApiError
      ? [`${error.status || 'network'} — ${error.message}`, bodyMessage(error.body)]
          .filter(Boolean)
          .join('\n')
      : error instanceof Error
        ? error.message
        : error != null
          ? String(error)
          : null;

  const status = error instanceof ApiError ? error.status : null;
  const serverMsg = error instanceof ApiError ? bodyMessage(error.body) : null;

  // status 0 is what ApiError uses for "never reached the server".
  if (status === 0 || status === null) {
    return {
      title: "Can't reach the gateway",
      description:
        'The request never made it to the server. Check that the DMR-X gateway is running and reachable, then try again.',
      icon: <PlugZap />,
      retryable: true,
      detail,
    };
  }

  if (status === 401) {
    return {
      title: 'Not signed in',
      description:
        'Your admin API key is missing or no longer valid. Add a valid key in Settings to continue.',
      icon: <Lock />,
      retryable: false,
      detail,
    };
  }

  if (status === 403) {
    return {
      title: 'Not allowed',
      description:
        serverMsg ?? 'This API key does not have permission to view or change this resource.',
      icon: <Lock />,
      retryable: false,
      detail,
    };
  }

  if (status === 404) {
    return {
      title: 'Not found',
      description:
        serverMsg ??
        'This resource no longer exists. It may have been deleted, or the endpoint is unavailable in this build.',
      icon: <SearchX />,
      retryable: false,
      detail,
    };
  }

  if (status === 408 || status === 504) {
    return {
      title: 'Timed out',
      description:
        'The gateway took too long to respond. It may be under load or waiting on a slow provider.',
      icon: <Timer />,
      retryable: true,
      detail,
    };
  }

  if (status === 429) {
    return {
      title: 'Rate limited',
      description:
        serverMsg ?? 'Too many requests in a short window. Wait a moment before retrying.',
      icon: <Timer />,
      retryable: true,
      detail,
    };
  }

  if (status >= 500) {
    return {
      title: 'The gateway hit an error',
      description:
        serverMsg ??
        'Something failed server-side. Retrying may work; if it keeps happening, check the gateway logs.',
      icon: <ServerCrash />,
      retryable: true,
      detail,
    };
  }

  return {
    title: serverMsg ? 'Request failed' : "That didn't work",
    description: serverMsg ?? 'The request was rejected. Check the details below and try again.',
    icon: <AlertTriangle />,
    retryable: true,
    detail,
  };
}

/* -------------------------------------------------------------------------- */
/*  ErrorState                                                                */
/* -------------------------------------------------------------------------- */

export interface ErrorStateProps {
  error: unknown;
  /**
   * Retry handler. Omitted, or a non-retryable error, hides the button.
   *
   * Returns `unknown` rather than `void | Promise<void>` so a react-query
   * `refetch` (which resolves to a `QueryObserverResult`) can be passed
   * directly. The result is awaited and discarded.
   */
  onRetry?: () => unknown;
  /** Overrides the interpreted title. */
  title?: string;
  /** Overrides the interpreted description. */
  description?: React.ReactNode;
  /** Extra actions rendered beside Retry. */
  action?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * The standard way to render a failed data load.
 *
 * Pages should never dead-end on a blank screen or a skeleton that never
 * resolves — every fetch that can fail renders this instead.
 */
export function ErrorState({
  error,
  onRetry,
  title,
  description,
  action,
  size = 'md',
  className,
}: ErrorStateProps) {
  const [showDetail, setShowDetail] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);
  const info = React.useMemo(() => interpretError(error), [error]);

  const handleRetry = async () => {
    if (!onRetry) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  const showRetry = Boolean(onRetry) && info.retryable;

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'sm' && 'py-6 gap-2',
        size === 'md' && 'py-10 gap-3',
        size === 'lg' && 'py-16 gap-4',
        className
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-2xl border border-danger/25 bg-danger-soft text-danger',
          size === 'sm' && 'size-10 [&_svg]:size-5',
          size === 'md' && 'size-14 [&_svg]:size-7',
          size === 'lg' && 'size-20 [&_svg]:size-10'
        )}
      >
        {info.icon}
      </div>

      <div className="flex max-w-md flex-col gap-1">
        <h3
          className={cn(
            'font-semibold text-fg',
            size === 'sm' ? 'text-sm' : size === 'md' ? 'text-base' : 'text-lg'
          )}
        >
          {title ?? info.title}
        </h3>
        <p className={cn('leading-relaxed text-fg-muted', size === 'sm' ? 'text-xs' : 'text-sm')}>
          {description ?? info.description}
        </p>
      </div>

      {(showRetry || action) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {showRetry && (
            <Button
              variant="secondary"
              size={size === 'sm' ? 'sm' : 'md'}
              onClick={handleRetry}
              loading={retrying}
              leftIcon={retrying ? undefined : <RefreshCw />}
            >
              Try again
            </Button>
          )}
          {action}
        </div>
      )}

      {info.detail && (
        <div className="mt-1 w-full max-w-md">
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            aria-expanded={showDetail}
            className="mx-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-subtle transition-colors hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ChevronDown
              className={cn('size-3 transition-transform', showDetail && 'rotate-180')}
            />
            {showDetail ? 'Hide details' : 'Show details'}
          </button>
          {showDetail && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 p-3 text-left font-mono text-[11px] leading-relaxed text-fg-muted">
              {info.detail}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function ErrorStateCard(props: ErrorStateProps) {
  return (
    <Card padding="none" className="border-danger/20">
      <ErrorState {...props} />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  InlineError — for form/section-level failures                             */
/* -------------------------------------------------------------------------- */

export interface InlineErrorProps {
  error: unknown;
  onRetry?: () => unknown;
  className?: string;
}

/** Compact single-line variant for failures inside a card or form section. */
export function InlineError({ error, onRetry, className }: InlineErrorProps) {
  const info = React.useMemo(() => interpretError(error), [error]);
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5',
        className
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{info.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{info.description}</p>
      </div>
      {onRetry && info.retryable && (
        <Button variant="ghost" size="sm" onClick={onRetry} className="shrink-0">
          Retry
        </Button>
      )}
    </div>
  );
}
