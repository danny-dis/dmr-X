import { CheckCircle2, XCircle, AlertTriangle, Info, Filter, Cpu, Network, Zap, Wrench, User } from 'lucide-react';
import * as React from 'react';

import { formatDuration, timeAgo } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ApiTelemetryEvent } from '@/types/api';

const ICON_FOR = {
  request: <Network className="size-3.5" />,
  routing: <Zap className="size-3.5" />,
  model: <Cpu className="size-3.5" />,
  tool: <Wrench className="size-3.5" />,
  tenant: <User className="size-3.5" />,
  system: <Info className="size-3.5" />,
};

export interface TelemetryEventRowProps {
  event: ApiTelemetryEvent;
  className?: string;
}

export function TelemetryEventRow({ event, className }: TelemetryEventRowProps) {
  const ok = event.status === 'ok' || event.status == null;
  const Icon = ICON_FOR[event.kind] ?? <Info className="size-3.5" />;
  return (
    <div
      className={cn(
        'flex items-start gap-2 px-2 py-1.5 font-mono text-[11px] leading-relaxed',
        'hover:bg-surface-2/50 transition-colors rounded',
        className
      )}
    >
      <span className="text-fg-subtle tabular-nums w-14 shrink-0">
        {event.at ? new Date(event.at).toLocaleTimeString('en-US', { hour12: false }) : ''}
      </span>
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center mt-0.5',
          ok ? 'text-success' : 'text-danger'
        )}
      >
        {ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
      </span>
      <span className="text-fg-muted shrink-0">{event.kind}</span>
      {event.tenant && (
        <span className="text-fg shrink-0">· {event.tenant}</span>
      )}
      {event.model && (
        <span className="text-accent shrink-0 font-sans">/ {event.model}</span>
      )}
      {event.latencyMs != null && (
        <span className="text-fg-muted shrink-0 tabular-nums">· {formatDuration(event.latencyMs)}</span>
      )}
      {event.message && (
        <span className="text-fg-muted truncate flex-1 min-w-0">— {event.message}</span>
      )}
    </div>
  );
}
