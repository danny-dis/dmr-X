import * as React from 'react';
import { ChevronRight, FileText, Brain, Wrench, User, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/formatters';
const ICON_FOR = {
    routing: <Brain className="size-3.5"/>,
    provider: <Globe className="size-3.5"/>,
    tenant: <User className="size-3.5"/>,
    tool: <Wrench className="size-3.5"/>,
    config: <FileText className="size-3.5"/>,
};
const TONE_FOR = {
    create: 'primary',
    update: 'warning',
    delete: 'danger',
    read: 'muted',
    success: 'success',
    error: 'danger',
};
export function AuditEventRow({ event, onClick, className }) {
    const tone = TONE_FOR[event.action] ?? 'muted';
    const icon = ICON_FOR[event.resource] ?? <FileText className="size-3.5"/>;
    return (<div onClick={() => onClick?.(event)} className={cn('flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-2 transition-colors', onClick && 'cursor-pointer', className)}>
      <div className={cn('flex size-7 shrink-0 items-center justify-center rounded-md', tone === 'primary' && 'bg-primary/10 text-primary', tone === 'success' && 'bg-success/10 text-success', tone === 'warning' && 'bg-warning/10 text-warning', tone === 'danger' && 'bg-danger/10 text-danger', tone === 'muted' && 'bg-surface-2 text-fg-muted')}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-fg-muted">{event.actor}</span>
          <span className="text-fg-subtle text-xs">{event.action}</span>
          <span className="text-fg">{event.resource}</span>
          {event.target && (<span className="font-mono text-[11px] text-fg-muted truncate">{event.target}</span>)}
        </div>
        {event.detail && (<p className="text-[10px] text-fg-subtle truncate">{event.detail}</p>)}
      </div>
      <span className="text-[10px] text-fg-subtle tabular-nums shrink-0 w-12 text-right">
        {event.at ? timeAgo(event.at) : ''}
      </span>
      {onClick && <ChevronRight className="size-3 text-fg-subtle shrink-0"/>}
    </div>);
}
//# sourceMappingURL=AuditEventRow.js.map