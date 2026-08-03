import { Ban, CheckCircle2, Wrench } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { StatusPill, type StatusKind } from '@/components/primitives/StatusPill';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { useAgentSteps } from '@/lib/queries/agents';

/** Steps recorded while the run loop is still going, rather than settled. */
const TERMINAL_STEP_STATUSES = new Set(['completed', 'error']);

function stepStatusKind(status: string | null): StatusKind {
  if (status === 'completed') return 'healthy';
  if (status === 'error') return 'offline';
  if (status && !TERMINAL_STEP_STATUSES.has(status)) return 'pending';
  return 'unknown';
}

/**
 * Per-turn run trace.
 *
 * Reads `session_steps`, which the agent loop has always written on every turn
 * — allowed and blocked tool calls, token and cost deltas, budget state — but
 * which had no read path over HTTP, so the detail that explains *why* a run
 * behaved as it did was recorded and then discarded.
 *
 * Blocked calls are given equal prominence to allowed ones: "the agent tried
 * to call bash and was refused" is usually the answer to why a run failed.
 *
 * A run still in progress keeps appending steps, so this polls while the last
 * recorded step looks unsettled — that in-progress state is a normal, expected
 * condition, never rendered as an error.
 */
export function RunTrace({ instanceId, conversationId }: { instanceId: string; conversationId?: string }) {
  const { data, isLoading, error, refetch } = useAgentSteps(instanceId, conversationId);
  const steps = data?.items ?? [];
  const lastStatus = steps.length > 0 ? steps[steps.length - 1].status : null;
  const inProgress = lastStatus != null && !TERMINAL_STEP_STATUSES.has(lastStatus);

  React.useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => void refetch(), 3000);
    return () => clearInterval(timer);
  }, [inProgress, refetch]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Run trace</CardTitle>
        {inProgress && <StatusPill status="pending" label="Running" size="sm" />}
      </CardHeader>
      <CardContent>
        <DataState
          data={data?.items}
          isLoading={isLoading}
          error={error}
          onRetry={refetch}
          skeletonRows={4}
          empty={{
            icon: <Wrench className="size-8" />,
            title: 'No run steps recorded',
            description: 'Turn-level detail appears here once this instance runs.',
          }}
        >
          {(items) => (
            <ol className="space-y-2" aria-live="polite" aria-atomic="false">
              {items.map((step, i) => (
                <li
                  key={`${step.conversationId}-${step.turn}-${i}`}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-2xs tabular-nums text-fg-muted">
                      {step.turn}
                    </span>
                    <StatusPill
                      status={stepStatusKind(step.status)}
                      label={step.status ?? 'unknown'}
                      size="sm"
                      pulse={false}
                    />
                    {step.budgetStatus && step.budgetStatus !== 'within' && (
                      <Badge tone="warning" variant="soft" size="sm">
                        budget {step.budgetStatus}
                      </Badge>
                    )}
                    <span className="ml-auto text-2xs tabular-nums text-fg-subtle">
                      {formatNumber(step.tokenDelta)} tok · {formatCurrency(step.costDelta)}
                    </span>
                  </div>

                  {(step.allowedToolCalls.length > 0 || step.blockedToolCalls.length > 0) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {step.allowedToolCalls.map((tool, j) => (
                        <span
                          key={`a-${j}`}
                          className="inline-flex items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 font-mono text-2xs text-success"
                        >
                          <CheckCircle2 className="size-3" />
                          {tool}
                        </span>
                      ))}
                      {step.blockedToolCalls.map((tool, j) => (
                        <span
                          key={`b-${j}`}
                          title="Not in the agent's allowed-tools list"
                          className="inline-flex items-center gap-1 rounded bg-danger/10 px-1.5 py-0.5 font-mono text-2xs text-danger"
                        >
                          <Ban className="size-3" />
                          {tool}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </DataState>
      </CardContent>
    </Card>
  );
}
