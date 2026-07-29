import { Ban, CheckCircle2, Wrench } from 'lucide-react';

import { Badge } from '@/components/primitives/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useAgentSteps } from '@/lib/queries/agents';

const usd = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });

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
 */
export function RunTrace({ instanceId, conversationId }: { instanceId: string; conversationId?: string }) {
  const { data, isLoading } = useAgentSteps(instanceId, conversationId);
  const steps = data?.items ?? [];

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  if (steps.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState
            icon={<Wrench className="size-6" />}
            title="No run steps recorded"
            description="Turn-level detail appears here after this instance runs."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run trace</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2">
          {steps.map((step, i) => (
            <li
              key={`${step.conversationId}-${step.turn}-${i}`}
              className="rounded-lg border border-border p-3"
            >
              <div className="flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-2xs tabular-nums text-fg-muted">
                  {step.turn}
                </span>
                <Badge
                  tone={step.status === 'completed' ? 'success' : step.status === 'error' ? 'danger' : 'neutral'}
                  variant="soft"
                  size="sm"
                >
                  {step.status ?? 'unknown'}
                </Badge>
                {step.budgetStatus && step.budgetStatus !== 'within' && (
                  <Badge tone="warning" variant="soft" size="sm">
                    budget {step.budgetStatus}
                  </Badge>
                )}
                <span className="ml-auto text-2xs tabular-nums text-fg-subtle">
                  {step.tokenDelta.toLocaleString()} tok · {usd.format(step.costDelta)}
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
      </CardContent>
    </Card>
  );
}
