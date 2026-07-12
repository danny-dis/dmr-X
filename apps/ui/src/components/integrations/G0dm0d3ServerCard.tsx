/**
 * G0dm0d3ServerCard — manage the auto-installed G0DM0D3 server.
 *
 * Polls GET /v1/godmode/server/status and exposes Install / Start / Stop
 * actions. The OpenRouter key is reused from the gateway — we never collect
 * a new key here. Running third-party code from a pinned GitHub repo is
 * surfaced with a prominent warning.
 */

import { AlertTriangle, Boxes, Copy, ExternalLink, Loader2, Power, Download, Square } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { fetchAuthenticated } from '@/lib/api';
import { cn } from '@/lib/utils';

export type GodmodeServerStatus =
  | 'stopped'
  | 'installing'
  | 'running'
  | 'error';

interface ServerStatusResponse {
  status: GodmodeServerStatus;
  url?: string;
  runtime?: string;
  health?: { status?: string } | string;
  pid?: number;
  containerId?: string;
}

const STATUS_META: Record<
  GodmodeServerStatus,
  { label: string; tone: 'muted' | 'warning' | 'success' | 'danger'; dot: string }
> = {
  stopped: { label: 'Stopped', tone: 'muted', dot: 'bg-fg-subtle' },
  installing: { label: 'Installing', tone: 'warning', dot: 'bg-warning animate-pulse' },
  running: { label: 'Running', tone: 'success', dot: 'bg-success' },
  error: { label: 'Error', tone: 'danger', dot: 'bg-danger' },
};

export function G0dm0d3ServerCard() {
  const [busy, setBusy] = React.useState<null | 'install' | 'start' | 'stop'>(null);
  const [copied, setCopied] = React.useState(false);

  const { data, refetch } = useApiData<ServerStatusResponse>(
    async () => {
      const res = await fetchAuthenticated('/v1/godmode/server/status');
      return (await res.json()) as ServerStatusResponse;
    },
    [],
    { refetchInterval: 3000 }
  );

  const status: GodmodeServerStatus = data?.status ?? 'stopped';
  const meta = STATUS_META[status];
  const url = data?.url;

  const runAction = React.useCallback(
    async (kind: 'install' | 'start' | 'stop') => {
      setBusy(kind);
      try {
        const res = await fetchAuthenticated(`/v1/godmode/server/${kind}`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `Failed: ${res.status}`);
        }
        const json = (await res.json().catch(() => ({}))) as { message?: string; url?: string };
        toast.success(
          `${kind[0]!.toUpperCase()}${kind.slice(1)} complete`,
          { description: json.message ?? json.url }
        );
        // Refresh status immediately, polling will keep it fresh.
        void refetch();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Request failed';
        toast.error(`Failed to ${kind}`, { description: message });
      } finally {
        setBusy(null);
      }
    },
    [refetch]
  );

  const copyUrl = React.useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy URL');
    }
  }, [url]);

  const installing = status === 'installing';
  const running = status === 'running';

  return (
    <Card variant="accent" padding="md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Boxes className="size-4 text-primary" />
            G0DM0D3 Server
          </CardTitle>
          <Badge tone={meta.tone} size="sm">
            <span className={cn('size-2 rounded-full', meta.dot)} />
            {meta.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Prominent third-party code warning */}
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <AlertTriangle className="size-4 shrink-0 text-amber-500 mt-0.5" />
          <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-400">
            <strong>Heads up:</strong> Install clones and runs third-party code
            pinned to{' '}
            <code className="rounded bg-amber-500/15 px-1 py-0.5 font-mono">
              github.com/elder-plinius/G0DM0D3
            </code>{' '}
            (branch <code className="font-mono">main</code>, depth 1). This is
            external software executed on your machine. Review the source before
            installing if you are unsure.
          </p>
        </div>

        {/* Reused OpenRouter key indicator */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2">
          <div className="flex items-center gap-2">
            <Power className="size-4 text-primary" />
            <span className="text-xs font-medium text-fg">OpenRouter key</span>
          </div>
          <Badge tone="info" size="sm">
            reused from gateway
          </Badge>
        </div>

        {/* Server URL */}
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs text-fg-muted">Server URL</div>
            {url ? (
              <div className="flex items-center gap-2">
                <code className="truncate font-mono text-xs text-fg">{url}</code>
                <button
                  onClick={copyUrl}
                  className="shrink-0 text-fg-muted transition-colors hover:text-fg"
                  title="Copy URL"
                  aria-label="Copy server URL"
                >
                  <Copy className="size-3.5" />
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="shrink-0 text-fg-muted transition-colors hover:text-fg"
                  title="Open"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
            ) : (
              <span className="text-xs text-fg-subtle">not available yet</span>
            )}
          </div>
          {copied && (
            <Badge tone="success" size="sm">
              Copied
            </Badge>
          )}
        </div>

        {/* Runtime info */}
        {data?.runtime && (
          <div className="text-xs text-fg-muted">
            Runtime: <span className="font-mono text-fg">{data.runtime}</span>
            {typeof data.health === 'object' && data.health?.status
              ? ` · health: ${data.health.status}`
              : ''}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => void runAction('install')}
            disabled={installing || running || busy !== null}
          >
            {busy === 'install' ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Download className="size-3" />
            )}
            Install
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void runAction('start')}
            disabled={installing || running || busy !== null}
          >
            {busy === 'start' ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Power className="size-3" />
            )}
            Start
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => void runAction('stop')}
            disabled={status === 'stopped' || installing || busy !== null}
          >
            {busy === 'stop' ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Square className="size-3" />
            )}
            Stop
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
