import { AlertCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
import { timeAgo } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ApiAlert } from '@/types/api';

const ICON_FOR = {
  error: <AlertCircle className="size-3.5" />,
  critical: <AlertCircle className="size-3.5" />,
  warning: <AlertTriangle className="size-3.5" />,
  info: <Info className="size-3.5" />,
  success: <CheckCircle2 className="size-3.5" />,
};

const TONE_FOR = {
  error: 'danger' as const,
  critical: 'danger' as const,
  warning: 'warning' as const,
  info: 'info' as const,
  success: 'success' as const,
};

export interface AlertCardProps {
  alert: ApiAlert;
  onAcknowledge?: (id: string) => void;
  onResolve?: (id: string) => void;
  className?: string;
}

export function AlertCard({ alert, onAcknowledge, onResolve, className }: AlertCardProps) {
  const severity = alert.severity ?? 'info';
  const tone = TONE_FOR[severity];
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3',
        tone === 'danger' && 'border-danger/20 bg-danger/[0.04]',
        tone === 'warning' && 'border-warning/20 bg-warning/[0.04]',
        tone === 'info' && 'border-info/20 bg-info/[0.04]',
        tone === 'success' && 'border-success/20 bg-success/[0.04]',
        className
      )}
    >
      <div
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
          tone === 'info' && 'text-info',
          tone === 'success' && 'text-success'
        )}
      >
        {ICON_FOR[severity]}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-fg truncate">{alert.title}</h4>
          <Badge tone={tone} size="sm">{severity}</Badge>
          {alert.acknowledgedAt && (
            <Badge tone="muted" size="sm">ack</Badge>
          )}
          {alert.resolvedAt && (
            <Badge tone="success" size="sm">resolved</Badge>
          )}
        </div>
        {alert.message && (
          <p className="text-[11px] text-fg-muted mt-0.5 line-clamp-2">{alert.message}</p>
        )}
        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-fg-subtle">
          {alert.source && <span>src: {alert.source}</span>}
          {alert.at && <span>{timeAgo(alert.at)}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {onAcknowledge && !alert.acknowledgedAt && (
          <button
            onClick={() => onAcknowledge(alert.id)}
            className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[10px] text-fg-muted hover:text-fg hover:bg-surface-3"
          >
            Ack
          </button>
        )}
        {onResolve && !alert.resolvedAt && (
          <button
            onClick={() => onResolve(alert.id)}
            className="rounded-md border border-success/30 bg-success/10 px-2 py-1 text-[10px] text-success hover:bg-success/20"
          >
            Resolve
          </button>
        )}
      </div>
    </div>
  );
}
