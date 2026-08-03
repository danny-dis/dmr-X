// ---------------------------------------------------------------------------
// Shared query option types
// ---------------------------------------------------------------------------
//
// Several endpoints (providers, models, ...) are polled by more than one page
// at different cadences — e.g. Dashboard revalidates on focus only, while
// Providers/Fusion Panel/Routing poll every 30s and the command palette every
// 60s while open. Rather than forking the query per cadence, the hook takes
// this as an optional per-call override on top of its own defaults, so the
// cache entry (and any in-flight request) stays shared via the query key.
export interface PollOptions {
  refetchInterval?: number | false;
  enabled?: boolean;
}
