import { CheckCircle2, XCircle } from 'lucide-react';

import type { McpTestResult } from '@/lib/queries/mcp';

/**
 * Outcome of a connection test.
 *
 * On success it lists the tools the server actually exposes — that is the
 * confirmation worth showing, because "connected" alone does not tell an
 * operator whether they wired up the server they meant to. On failure it shows
 * the upstream's own message rather than a generic one.
 */
export function TestResultPanel({ result }: { result: McpTestResult }) {
  if (!result.ok) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3">
        <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-danger">Could not connect</div>
          <p className="mt-0.5 break-words font-mono text-2xs text-fg-muted">{result.errorMessage}</p>
          <p className="mt-1.5 text-2xs text-fg-subtle">Failed after {result.latencyMs}ms. Nothing was saved.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-success/30 bg-success/5 p-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-4 text-success" />
        <span className="text-sm font-medium text-success">
          Connected — {result.toolCount} tool{result.toolCount === 1 ? '' : 's'}
        </span>
        <span className="ml-auto text-2xs text-fg-subtle">{result.latencyMs}ms</span>
      </div>
      {result.tools.length > 0 && (
        <div className="mt-2 max-h-32 overflow-y-auto">
          <div className="flex flex-wrap gap-1">
            {result.tools.map((t) => (
              <span
                key={t.name}
                title={t.description}
                className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-fg-muted"
              >
                {t.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
