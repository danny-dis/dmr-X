import * as React from 'react';

import { ErrorBoundary } from './ErrorBoundary';
import { ErrorState } from './ErrorState';
import { Skeleton } from './Skeleton';

/* -------------------------------------------------------------------------- */
/*  LazyTab                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Approximates the shape of a loaded tab — a heading, a stat row, a content
 * card — so arrival doesn't reflow the page the way a single centered bar does.
 */
export function TabLoader() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading section">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

function TabError() {
  return (
    <ErrorState
      // interpretError maps a plain Error to its "can't reach the gateway"
      // branch, which is the wrong story for a failed chunk fetch — hence the
      // explicit title/description.
      error={new Error('Tab module failed to load')}
      title="This section didn't load"
      description="The code for this tab couldn't be downloaded. Reloading usually fixes it."
      onRetry={() => window.location.reload()}
    />
  );
}

/**
 * Suspense + error boundary for a lazily-loaded tab panel.
 *
 * The boundary is the point: without it a failed chunk fetch (stale deploy,
 * network blip) escapes as an unhandled rejection and blanks the whole page
 * instead of just the panel that couldn't load. `ErrorBoundary`'s own default
 * fallback is full-viewport, which is wrong inside a panel, so this passes a
 * scoped one.
 */
export function LazyTab({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary fallback={<TabError />}>
      <React.Suspense fallback={<TabLoader />}>{children}</React.Suspense>
    </ErrorBoundary>
  );
}
