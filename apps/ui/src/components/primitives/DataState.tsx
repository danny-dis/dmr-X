import * as React from 'react';

import { EmptyState, type EmptyStateProps } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Skeleton } from './Skeleton';

/* -------------------------------------------------------------------------- */
/*  DataState                                                                 */
/* -------------------------------------------------------------------------- */

export interface DataStateProps<T> {
  /** The fetched value. `null`/`undefined` while loading or on failure. */
  data: T | null | undefined;
  /** True while the first (or a refetched) load is in flight. */
  isLoading: boolean;
  /** Non-null when the load failed. */
  error?: unknown;
  /**
   * Re-runs the fetch. Wired to the error state's Try again button.
   *
   * Returns `unknown` so a react-query `refetch` (resolving to a
   * `QueryObserverResult`) can be passed straight through — pages use both
   * `useApiData` and react-query, and neither should need a wrapper lambda.
   */
  onRetry?: () => unknown;

  /** Custom loading UI. Defaults to `skeletonRows` stacked bars. */
  loading?: React.ReactNode;
  /** Number of default skeleton rows. Ignored when `loading` is given. */
  skeletonRows?: number;

  /**
   * Treats a successful-but-empty result as an empty state.
   * Arrays are empty by length; anything else by `== null`.
   */
  empty?: EmptyStateProps;
  /** Overrides the default emptiness check. */
  isEmpty?: (data: T) => boolean;

  children: (data: T) => React.ReactNode;
}

function defaultIsEmpty(data: unknown): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  return false;
}

/**
 * Renders exactly one of loading / error / empty / content.
 *
 * This exists so no page has to re-derive the ordering by hand — errors are
 * checked before data, and an empty success never falls through to a
 * component that assumes a non-empty list.
 */
export function DataState<T>({
  data,
  isLoading,
  error,
  onRetry,
  loading,
  skeletonRows = 3,
  empty,
  isEmpty,
  children,
}: DataStateProps<T>) {
  // Error wins over a stale `data` from a previous successful load: showing
  // known-stale content with no indication it failed to refresh is worse than
  // saying so.
  if (error != null) {
    return <ErrorState error={error} onRetry={onRetry} />;
  }

  if (isLoading && data == null) {
    return (
      <>
        {loading ?? (
          <div className="space-y-3">
            {Array.from({ length: skeletonRows }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        )}
      </>
    );
  }

  if (data == null) {
    // Settled, no error, still nothing — treat as empty rather than crashing
    // the children render with a null.
    return empty ? <EmptyState {...empty} /> : null;
  }

  const emptyCheck = isEmpty ?? defaultIsEmpty;
  if (empty && emptyCheck(data)) {
    return <EmptyState {...empty} />;
  }

  return <>{children(data)}</>;
}
