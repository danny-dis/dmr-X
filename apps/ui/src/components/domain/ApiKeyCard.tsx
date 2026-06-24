import { Eye, EyeOff, KeyRound, Calendar, Activity, Trash2, Lock } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { CopyButton } from '@/components/primitives/CopyButton';
import { StatusPill } from '@/components/primitives/StatusPill';
import { maskKey, timeAgo } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ApiKey } from '@/types/api';

export interface ApiKeyCardProps {
  apiKey: ApiKey;
  onRevoke?: (id: string) => void;
  /** True while the user has clicked revoke and is in the "click again to confirm" state. */
  revoking?: boolean;
  className?: string;
}

export function ApiKeyCard({ apiKey, onRevoke, revoking, className }: ApiKeyCardProps) {
  const [revealed, setRevealed] = React.useState(false);
  // Track which key the user has currently set as dmrx_tenant_token so we
  // can highlight it in the list. The marker is set by CreateApiKeyDialog
  // on successful create; we also listen for cross-tab changes.
  const [activeKeyId, setActiveKeyId] = React.useState<string | null>(() => {
    try {
      return localStorage.getItem('dmrx_active_key_id');
    } catch {
      return null;
    }
  });
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'dmrx_active_key_id') {
        setActiveKeyId(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const isActive = apiKey.is_active !== 0;
  const isCurrentActive = apiKey.id === activeKeyId;
  // The plaintext key is only present on the create response — list responses omit it.
  const hasPlaintext = !!apiKey.key && apiKey.key.length > 0;
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-border bg-surface-1 p-3 transition-opacity',
        revoking && 'opacity-60',
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
              {apiKey.tenant_name ?? apiKey.tenant_id}
            </p>
          </div>
          {isCurrentActive && (
            <Badge tone="success" size="sm">Active</Badge>
          )}
        </div>
        <StatusPill
          status={isActive ? 'online' : 'offline'}
          label={isActive ? 'Active' : 'Revoked'}
          size="sm"
          pulse={isActive}
        />
      </div>

      {hasPlaintext ? (
        <div className="flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1.5">
          <code className="font-mono text-[11px] text-fg-muted flex-1 truncate">
            {revealed ? apiKey.key : maskKey(apiKey.key!)}
          </code>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Hide key' : 'Reveal key'}
          >
            {revealed ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
          </Button>
          <CopyButton value={apiKey.key!} />
        </div>
      ) : (
        <div
          className="flex items-center gap-2 rounded-md border border-dashed border-border bg-surface-2/40 px-2 py-1.5"
          title="The full key is only shown once at creation. If you lost it, revoke and create a new one."
        >
          <Lock className="size-3 text-fg-subtle shrink-0" />
          <span className="text-[11px] text-fg-muted">
            Key hidden — only shown once at creation
          </span>
        </div>
      )}

      {apiKey.scopes && apiKey.scopes.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-fg-muted">Scopes:</span>
          {apiKey.scopes.map((scope) => (
            <Badge key={scope} tone="neutral" size="sm">
              {scope}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-fg-muted">
        <div className="flex items-center gap-3">
          {apiKey.created_at && (
            <span className="flex items-center gap-1">
              <Calendar className="size-2.5" />
              {timeAgo(apiKey.created_at)}
            </span>
          )}
          {apiKey.last_used_at && (
            <span className="flex items-center gap-1">
              <Activity className="size-2.5" />
              {timeAgo(apiKey.last_used_at)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onRevoke && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => onRevoke(apiKey.id)}
              aria-label="Delete key"
              title={revoking ? 'Click again to confirm revoke' : 'Revoke key'}
              className={cn(revoking && 'text-danger')}
            >
              <Trash2 className="size-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
