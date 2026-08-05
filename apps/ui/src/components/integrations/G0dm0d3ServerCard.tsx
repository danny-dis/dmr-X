/**
 * G0dm0d3ServerCard — manage the auto-installed G0DM0D3 server.
 *
 * Polls GET /v1/godmode/server/status and exposes Install / Start / Stop
 * actions. The OpenRouter key is reused from the gateway — we never collect
 * a new key here. Running third-party code from a pinned GitHub repo is
 * surfaced with a prominent warning.
 *
 * Also reports how the pinned commit relates to upstream
 * `elder-plinius/G0DM0D3` (see `UpstreamSection`). DMR-X installs from its own
 * fork at a pinned SHA, which a nightly workflow moves forward — so "am I
 * running current code?" is a real question with a non-obvious answer, and the
 * card is where the user asks it.
 */

import {
  AlertCircle,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  GitFork,
  Info,
  Power,
  RefreshCw,
  Square,
} from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { SkeletonText } from '@/components/primitives/Skeleton';
import { toast } from '@/components/primitives/Toast';
import { useApiData, type UseApiDataResult } from '@/hooks/useApiData';
import { fetchAuthenticated } from '@/lib/api';
import { cn } from '@/lib/utils';

export type GodmodeServerStatus =
  | 'not_installed'
  | 'stopped'
  | 'installing'
  | 'running'
  | 'error';

interface ServerStatusResponse {
  status: GodmodeServerStatus;
  running: boolean;
  installed?: boolean;
  url?: string;
  runtime?: string;
  health?: { status?: string } | string;
  pid?: number;
  containerId?: string;
}

interface ServerConfigResponse {
  baseUrl?: string;
  hasApiKey?: boolean;
  openrouterConfigured?: boolean;
  repo?: string;
  ref?: string;
}

/** GET /v1/godmode/server/updates — fork vs upstream sync health. */
export interface GodmodeUpdatesResponse {
  repo: string;
  upstream: string;
  pinnedRef: string;
  installedRef: string | null;
  forkHead: string | null;
  upstreamHead: string | null;
  behindUpstream: number | null;
  pinnedIsForkHead: boolean;
  checkedAt: string;
  error?: string;
}

const STATUS_META: Record<
  GodmodeServerStatus,
  { label: string; tone: 'muted' | 'warning' | 'success' | 'danger'; dot: string }
> = {
  not_installed: { label: 'Not installed', tone: 'muted', dot: 'bg-fg-subtle' },
  stopped: { label: 'Stopped', tone: 'muted', dot: 'bg-fg-subtle' },
  installing: { label: 'Installing', tone: 'warning', dot: 'bg-warning animate-pulse' },
  running: { label: 'Running', tone: 'success', dot: 'bg-success' },
  error: { label: 'Error', tone: 'danger', dot: 'bg-danger' },
};

/** Shortened, human-readable form of a pinned commit SHA / branch name. */
function shortRef(ref: string | undefined): string {
  if (!ref) return 'unpinned';
  return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}

/** repo URL → "owner/name" for compact display. */
function repoSlug(repo: string | undefined): string {
  if (!repo) return 'unknown/unknown';
  const m = repo.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : repo;
}

type UpstreamTone = 'success' | 'warning' | 'info' | 'muted';

interface UpstreamVerdict {
  tone: UpstreamTone;
  icon: typeof CheckCircle2;
  label: string;
  detail: string;
}

/**
 * Collapse four commit SHAs into the one sentence the user actually needs.
 *
 * "Fork trails upstream" and "our pin trails the fork" are genuinely different
 * problems — the first waits on the nightly sync workflow, the second waits on
 * a ref-bump PR being merged — so they get different wording rather than a
 * single vague "out of date".
 */
function upstreamVerdict(u: GodmodeUpdatesResponse): UpstreamVerdict {
  const upstreamLabel = repoSlug(u.upstream);
  if (u.error || u.upstreamHead === null || u.forkHead === null) {
    return {
      tone: 'muted',
      icon: AlertCircle,
      label: 'Could not check for updates',
      detail: u.error ?? 'GitHub did not return the current commit.',
    };
  }
  if (u.behindUpstream !== null && u.behindUpstream > 0) {
    return {
      tone: 'warning',
      icon: AlertTriangle,
      label: `${u.behindUpstream} commit${u.behindUpstream === 1 ? '' : 's'} behind upstream`,
      detail: `The fork has not been synced with ${upstreamLabel} yet.`,
    };
  }
  if (!u.pinnedIsForkHead) {
    return {
      tone: 'info',
      icon: Info,
      label: 'Pinned commit is behind the fork',
      detail: 'The fork is current, but DMR-X still installs an older commit.',
    };
  }
  return {
    tone: 'success',
    icon: CheckCircle2,
    label: `Up to date with ${upstreamLabel}`,
    detail: 'The pinned commit matches the fork, and the fork matches upstream.',
  };
}

const TONE_TEXT: Record<UpstreamTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  info: 'text-primary',
  muted: 'text-fg-muted',
};

/**
 * Upstream-tracking state for the fork DMR-X installs from.
 *
 * Split out of the card body because it has its own independent fetch, its own
 * error surface, and its own refresh control — inlining it made the card's
 * render impossible to follow.
 */
function UpstreamSection({ updates }: { updates: UseApiDataResult<GodmodeUpdatesResponse> }) {
  const { data, error, isLoading, refetch } = updates;
  const [refreshing, setRefreshing] = React.useState(false);

  const check = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  // First load has nothing to show yet; a refresh keeps the previous answer on
  // screen so the section never blinks empty under the user's cursor.
  if (isLoading && !data) {
    return (
      <div className="rounded-lg border border-border bg-surface-2/40 px-3 py-2">
        <SkeletonText lines={2} />
      </div>
    );
  }

  if (!data) {
    return (
      <div
        role="status"
        className="rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs text-fg-muted"
      >
        {error?.message ?? 'Upstream status unavailable.'}
      </div>
    );
  }

  const verdict = upstreamVerdict(data);
  const VerdictIcon = verdict.icon;
  // The installed checkout only re-clones when its directory is deleted, so it
  // can lag a ref bump indefinitely. That is invisible without saying it.
  const drifted = data.installedRef !== null && data.installedRef !== data.pinnedRef;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        {/* aria-live so the verdict is announced when "Check again" resolves —
            otherwise the only feedback is a colour change. */}
        <div role="status" aria-live="polite" className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <GitFork className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
            <span className="text-xs font-medium text-fg">Upstream</span>
          </div>
          <div className={cn('flex items-start gap-1.5 text-xs', TONE_TEXT[verdict.tone])}>
            <VerdictIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {/* Text carries the state, not just the colour. */}
            <span className="font-medium">{verdict.label}</span>
          </div>
          <p className="text-xs text-fg-muted">{verdict.detail}</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void check()}
          loading={refreshing}
          aria-label="Check for G0DM0D3 updates"
          leftIcon={refreshing ? undefined : <RefreshCw className="size-3" aria-hidden />}
        >
          Check again
        </Button>
      </div>

      {drifted && (
        <p role="note" className="text-xs text-warning">
          The installed copy is at <code className="font-mono">{shortRef(data.installedRef ?? undefined)}</code>,
          not the pinned <code className="font-mono">{shortRef(data.pinnedRef)}</code>. Delete
          the install and re-install to pick the pinned commit up.
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-fg-subtle">
        <dt>Pinned</dt>
        <dd className="font-mono text-fg-muted">{shortRef(data.pinnedRef)}</dd>
        <dt>Fork</dt>
        <dd className="font-mono text-fg-muted">{shortRef(data.forkHead ?? undefined)}</dd>
        <dt>Upstream</dt>
        <dd className="truncate">
          <a
            href={data.upstream}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-fg-muted underline underline-offset-2 transition-colors hover:text-fg"
          >
            {repoSlug(data.upstream)}
          </a>
        </dd>
      </dl>
    </div>
  );
}

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

  const { data: config } = useApiData<ServerConfigResponse>(
    async () => {
      const res = await fetchAuthenticated('/v1/godmode/server/config');
      return (await res.json()) as ServerConfigResponse;
    },
    [],
    { refetchInterval: false }
  );

  // Deliberately NOT polled: each call costs the gateway up to three GitHub
  // API requests, and the commits it reports move at most once a night.
  const updates = useApiData<GodmodeUpdatesResponse>(
    async () => {
      const res = await fetchAuthenticated('/v1/godmode/server/updates');
      return (await res.json()) as GodmodeUpdatesResponse;
    },
    [],
    { refetchInterval: false }
  );

  const status: GodmodeServerStatus = data?.status ?? 'not_installed';
  const meta = STATUS_META[status];
  const url = data?.url;
  const notInstalled = status === 'not_installed';

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

  // Held in a ref so the "Copied" flag can be cancelled on unmount — the card
  // lives on a page the user can navigate away from mid-timeout.
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  const copyUrl = React.useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy URL');
    }
  }, [url]);

  const installing = status === 'installing';
  const running = status === 'running';
  const installed = data?.installed ?? !notInstalled;
  const repoLabel = repoSlug(config?.repo);
  const refLabel = shortRef(config?.ref);

  return (
    <Card variant="accent" padding="md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Boxes className="size-4 text-primary" />
            G0DM0D3 Server
          </CardTitle>
          {/* The dot is decorative — meta.label carries the state in text, so
              the status never depends on colour alone. */}
          <Badge tone={meta.tone} size="sm" role="status" aria-live="polite">
            <span className={cn('size-2 rounded-full', meta.dot)} aria-hidden />
            {meta.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Prominent third-party code warning */}
        <div
          role="note"
          className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3"
        >
          <AlertTriangle className="size-4 shrink-0 text-warning mt-0.5" aria-hidden />
          <p className="text-xs leading-relaxed text-warning">
            <strong>Heads up:</strong> Install clones and runs third-party code
            pinned to{' '}
            <code className="rounded bg-warning/15 px-1 py-0.5 font-mono">
              github.com/{repoLabel}
            </code>{' '}
            at commit <code className="font-mono">{refLabel}</code>. This is
            external software executed on your machine. Review the source before
            installing if you are unsure.
          </p>
        </div>

        {notInstalled ? (
          /* ── Not installed yet: single clear call to action ────────────── */
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-surface-2/30 px-4 py-6 text-center">
            <Boxes className="size-8 text-fg-subtle" />
            <div>
              <div className="text-sm font-medium text-fg">G0DM0D3 is not installed</div>
              <p className="mt-1 text-xs text-fg-muted">
                Install clones the pinned source and runs <code className="font-mono">bun install</code>.
                This can take a minute the first time.
              </p>
            </div>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void runAction('install')}
              disabled={busy !== null}
              loading={busy === 'install'}
              leftIcon={busy === 'install' ? undefined : <Download className="size-3" aria-hidden />}
            >
              Install G0DM0D3
            </Button>
          </div>
        ) : (
          <>
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
          </>
        )}

        {/* Upstream tracking — shown even before install, because "how far
            behind is the code I'm about to run" is exactly what a user wants
            to know at the moment they decide whether to install it. */}
        <UpstreamSection updates={updates} />

        {/* Actions */}
        {!notInstalled && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void runAction('start')}
            disabled={!installed || installing || running || busy !== null}
            loading={busy === 'start'}
            leftIcon={busy === 'start' ? undefined : <Power className="size-3" aria-hidden />}
          >
            Start
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => void runAction('stop')}
            disabled={!running || installing || busy !== null}
            loading={busy === 'stop'}
            leftIcon={busy === 'stop' ? undefined : <Square className="size-3" aria-hidden />}
          >
            Stop
          </Button>
        </div>
        )}
      </CardContent>
    </Card>
  );
}
