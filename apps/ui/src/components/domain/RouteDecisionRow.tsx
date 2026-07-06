import { ChevronRight, Clock, Target, List } from 'lucide-react';
import * as React from 'react';

import { StatusPill } from '@/components/primitives/StatusPill';
import { formatDuration, timeAgo } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ApiRouteDecision } from '@/types/api';

const DECISION_REASON_LABELS: Record<string, string> = {
  capability_match: 'Model capabilities matched task requirements',
  cost_optimize: 'Cost optimization selected this provider',
  latency_optimize: 'Low latency provider chosen',
  quality_target: 'Quality target matched this tier',
  fallback: 'Primary provider unavailable, using fallback',
  cache_hit: 'Response served from cache',
  bandit_explore: 'Thompson Sampling exploring this model',
  bandit_exploit: 'Thompson Sampling exploiting best performer',
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
            <p className="text-[11px] text-fg-muted mt-0.5 line-clamp-1" title={DECISION_REASON_LABELS[decision.decision_reason] ?? decision.decision_reason}>
              {decision.decision_reason}
            </p>
          )}
          {decision.fallback_chain && decision.fallback_chain.length > 0 && expanded && (
            <div className="flex items-center gap-1 mt-1">
              <List className="size-3 text-fg-subtle" />
              <span className="text-[10px] text-fg-subtle truncate" title={`Fallback chain: ${decision.fallback_chain.join(' → ')}`}>
                {decision.fallback_chain.slice(0, 3).join(' → ')}{decision.fallback_chain.length > 3 ? '...' : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="hidden md:flex items-center gap-3 text-[11px] text-fg-muted shrink-0">
        {decision.confidence != null && (
          <span className="flex items-center gap-1 tabular-nums" title="Routing confidence score">
            <Target className="size-3" />
            {(decision.confidence * 100).toFixed(0)}%
          </span>
        )}
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
