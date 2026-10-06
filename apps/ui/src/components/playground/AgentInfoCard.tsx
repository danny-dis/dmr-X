/**
 * AgentInfoCard — shows agent instance details in agent mode.
 *
 * Displays the selected agent's name, model tier, status, execution count,
 * and cost. Tools and skills are shown if available in the instance data.
 */

import * as React from 'react';
import {
  Bot,
  Activity,
  DollarSign,
  Clock,
  Wrench,
  Brain,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/primitives/Badge';
import type { AgentInstanceDetail } from '@/lib/queries/agents';

interface AgentInfoCardProps {
  instance: AgentInstanceDetail;
}

export function AgentInfoCard({ instance }: AgentInfoCardProps) {
  const [expanded, setExpanded] = React.useState(false);

  const name = instance.definitionHumanName || instance.definitionName || instance.id;
  const description = instance.definitionDescription;
  const modelTier = instance.definitionModelTier;
  const executionCount = instance.executionCount;
  const cost24h = instance.costCents24h;
  const lastExecution = instance.lastExecutionAt;

  return (
    <div className="mb-3 rounded-lg border border-border bg-surface-2/50 p-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <span className="text-sm font-medium text-fg">{name}</span>
          <Badge
            tone={instance.status === 'active' ? 'success' : 'muted'}
            size="sm"
          >
            {instance.status}
          </Badge>
        </div>
        {expanded ? (
          <ChevronUp className="size-4 text-fg-muted" />
        ) : (
          <ChevronDown className="size-4 text-fg-muted" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {description && (
            <p className="text-xs text-fg-muted">{description}</p>
          )}

          <div className="grid grid-cols-2 gap-2">
            {modelTier && (
              <div className="flex items-center gap-1.5 text-xs">
                <Brain className="size-3 text-accent" />
                <span className="text-fg-muted">Tier:</span>
                <span className="font-mono text-fg">{modelTier}</span>
              </div>
            )}

            <div className="flex items-center gap-1.5 text-xs">
              <Activity className="size-3 text-success" />
              <span className="text-fg-muted">Runs:</span>
              <span className="font-mono text-fg">{executionCount}</span>
            </div>

            {cost24h > 0 && (
              <div className="flex items-center gap-1.5 text-xs">
                <DollarSign className="size-3 text-warning" />
                <span className="text-fg-muted">24h cost:</span>
                <span className="font-mono text-fg">${(cost24h / 100).toFixed(2)}</span>
              </div>
            )}

            {lastExecution && (
              <div className="flex items-center gap-1.5 text-xs">
                <Clock className="size-3 text-fg-muted" />
                <span className="text-fg-muted">Last run:</span>
                <span className="font-mono text-fg">
                  {new Date(lastExecution).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {instance.configOverride && Object.keys(instance.configOverride).length > 0 && (
            <div className="mt-2">
              <div className="mb-1 flex items-center gap-1.5 text-xs text-fg-muted">
                <Wrench className="size-3" />
                <span>Config overrides</span>
              </div>
              <pre className="overflow-x-auto rounded-md border border-border bg-surface-1 p-2 font-mono text-[10px] text-fg-muted">
                {JSON.stringify(instance.configOverride, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
