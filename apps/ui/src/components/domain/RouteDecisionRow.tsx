import { ChevronRight, Zap, Brain, Bot, Wrench, Cog, Clock } from 'lucide-react';
import * as React from 'react';

import { formatDuration, timeAgo } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ApiRouteDecision } from '@/types/api';

const INTEL_ICON = {
  brain: Brain,
  thinker: Zap,
  executor: Bot,
  worker: Wrench,
  temp_worker: Cog,
};

export interface RouteDecisionRowProps {
  decision: ApiRouteDecision;
  onClick?: (decision: ApiRouteDecision) => void;
  className?: string;
  expanded?: boolean;
}

export function RouteDecisionRow({ decision, onClick, className, expanded }: RouteDecisionRowProps) {
  return (
    <div
      onClick={() => onClick?.(decision)}
      className={cn(
        'group flex items-center gap-3 px-4 py-2.5 rounded-lg border border-transparent',
        'hover:border-border hover:bg-surface-2 transition-colors',
        onClick && 'cursor-pointer',
        className
      )}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="font-medium text-fg truncate">{decision.selected_provider}</span>
            <span className="text-fg-subtle">/</span>
            <span className="text-fg font-mono text-xs truncate">{decision.selected_model}</span>
          </div>
          {decision.decision_reason && expanded && (
            <p className="text-[11px] text-fg-muted mt-0.5 line-clamp-1">{decision.decision_reason}</p>
          )}
        </div>
      </div>

      <div className="hidden md:flex items-center gap-3 text-[11px] text-fg-muted shrink-0">
        <span className="flex items-center gap-1 tabular-nums">
          <Clock className="size-3" />
          {formatDuration(decision.latency ?? 0)}
        </span>
        {decision.input_tokens != null && (
          <span className="tabular-nums">{(decision.input_tokens + (decision.output_tokens ?? 0)).toLocaleString()} tok</span>
        )}
        {decision.cost != null && (
          <span className="tabular-nums">${decision.cost.toFixed(4)}</span>
        )}
        <StatusPill
          status={decision.status === 'success' ? 'online' : decision.status === 'fallback' ? 'warning' : 'offline'}
          label={decision.status.toUpperCase()}
          size="sm"
          pulse={false}
        />
      </div>

      <span className="text-fg-subtle tabular-nums text-[10px] shrink-0 w-12 text-right">
        {decision.timestamp ? timeAgo(decision.timestamp) : ''}
      </span>

      {onClick && (
        <ChevronRight className="size-3.5 text-fg-subtle group-hover:text-fg-muted transition-colors shrink-0" />
      )}
    </div>
  );
}
