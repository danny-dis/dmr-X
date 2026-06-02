import * as React from 'react';
import { Eye, EyeOff, Copy, RefreshCw, KeyRound, Calendar, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { CopyButton } from '@/components/primitives/CopyButton';
import { StatusPill } from '@/components/primitives/StatusPill';
import { maskKey, timeAgo } from '@/lib/formatters';
import type { ApiKey } from '@/types/api';

export interface ApiKeyCardProps {
  apiKey: ApiKey;
  onRotate?: (id: string) => void;
  onRevoke?: (id: string) => void;
  className?: string;
}

export function ApiKeyCard({ apiKey, onRotate, onRevoke, className }: ApiKeyCardProps) {
  const [revealed, setRevealed] = React.useState(false);
  const isActive = !apiKey.revokedAt;
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-border bg-surface-1 p-3',
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex size-8 items-center justify-center rounded-lg bg-surface-2 text-fg-muted">
            <KeyRound className="size-3.5" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-fg truncate">{apiKey.name}</h4>
            <p className="text-[10px] text-fg-muted truncate">
              {apiKey.tenantId}
            </p>
          </div>
        </div>
        <StatusPill
          status={isActive ? 'online' : 'offline'}
          label={isActive ? 'Active' : 'Revoked'}
          size="sm"
          pulse={isActive}
        />
      </div>

      <div className="flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1.5">
        <code className="font-mono text-[11px] text-fg-muted flex-1 truncate">
          {revealed ? apiKey.key : maskKey(apiKey.key)}
        </code>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? 'Hide key' : 'Reveal key'}
        >
          {revealed ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
        </Button>
        <CopyButton value={apiKey.key} />
      </div>

      <div className="flex items-center justify-between text-[10px] text-fg-muted">
        <div className="flex items-center gap-3">
          {apiKey.scopes?.length > 0 && (
            <span className="flex items-center gap-1">
              <Activity className="size-2.5" />
              {apiKey.scopes.length} scopes
            </span>
          )}
          {apiKey.lastUsedAt && (
            <span className="flex items-center gap-1">
              <Calendar className="size-2.5" />
              {timeAgo(apiKey.lastUsedAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onRotate && isActive && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => onRotate(apiKey.id)}
              aria-label="Rotate key"
            >
              <RefreshCw className="size-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
