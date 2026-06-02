import * as React from 'react';
import { ChevronRight, Zap, Brain, Bot, Wrench, Cog, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/primitives/Badge';
import { StatusPill } from '@/components/primitives/StatusPill';
import type { ApiRouteDecision } from '@/types/api';
import { formatDuration, timeAgo } from '@/lib/formatters';
import { IntelligenceBadge } from '@/icons/IntelligenceLayer';
import { ModalityBadge } from '@/icons/Modality';

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
        <IntelligenceBadge layer={decision.intelligenceLayer ?? 'brain'} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="font-medium text-fg truncate">{decision.tenantId ?? 'anon'}</span>
            <span className="text-fg-subtle">→</span>
            <span className="text-fg-muted truncate">{decision.provider}</span>
            <span className="text-fg-subtle">/</span>
            <span className="text-fg font-mono text-xs truncate">{decision.model}</span>
          </div>
          {decision.reasoning && expanded && (
            <p className="text-[11px] text-fg-muted mt-0.5 line-clamp-1">{decision.reasoning}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {decision.modality && <ModalityBadge modality={decision.modality} size="sm" />}
      </div>

      <div className="hidden md:flex items-center gap-3 text-[11px] text-fg-muted shrink-0">
        <span className="flex items-center gap-1 tabular-nums">
          <Clock className="size-3" />
          {formatDuration(decision.latencyMs ?? 0)}
        </span>
        {decision.tokens != null && (
          <span className="tabular-nums">{decision.tokens.toLocaleString()} tok</span>
        )}
        {decision.cost != null && (
          <span className="tabular-nums">${decision.cost.toFixed(4)}</span>
        )}
        <StatusPill
          status={decision.success ? 'online' : 'offline'}
          label={decision.success ? 'OK' : 'ERR'}
          size="sm"
          pulse={false}
        />
      </div>

      <span className="text-fg-subtle tabular-nums text-[10px] shrink-0 w-12 text-right">
        {decision.at ? timeAgo(decision.at) : ''}
      </span>

      {onClick && (
        <ChevronRight className="size-3.5 text-fg-subtle group-hover:text-fg-muted transition-colors shrink-0" />
      )}
    </div>
  );
}
