import { Bell, Activity, FileText, AlertCircle, CheckCircle2, Download, Pause, Play } from 'lucide-react';
import * as React from 'react';

import { AlertCard } from '@/components/domain/AlertCard';
import { AuditEventRow } from '@/components/domain/AuditEventRow';
import { TelemetryEventRow } from '@/components/domain/TelemetryEventRow';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { interpretError } from '@/components/primitives/ErrorState';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { toast } from '@/components/primitives/Toast';
import {
  useAcknowledgeAlert,
  useAlerts,
  useAuditEvents,
  useResolveAlert,
  useTelemetryEvents,
} from '@/lib/queries/observability';
import { useLiveStore } from '@/store/useLiveStore';
import type { ApiTelemetryEvent } from '@/types/api';

export function ObservabilityPage() {
  const [tab, setTab] = React.useState('alerts');
  const [exporting, setExporting] = React.useState(false);

  const alerts = useAlerts();
  const audit = useAuditEvents();
  // Slow-poll fallback for the telemetry tab's first paint — the live tail
  // below is fed by the one SSE subscription mounted in the app shell, not a
  // per-page poll.
  const telemetryQuery = useTelemetryEvents();
  const liveEvents = useLiveStore((s) => s.events);
  const paused = useLiveStore((s) => s.paused);
  const setPaused = useLiveStore((s) => s.setPaused);
  const connection = useLiveStore((s) => s.connection);

  const ackMutation = useAcknowledgeAlert();
  const resolveMutation = useResolveAlert();

  // Live tail merged with the initial poll snapshot, de-duped by id.
  const telemetryEvents = React.useMemo<ApiTelemetryEvent[]>(() => {
    const merged = [...liveEvents, ...(telemetryQuery.data ?? [])];
    return Array.from(new Map(merged.map((e) => [e.id, e])).values());
  }, [liveEvents, telemetryQuery.data]);

  // Still loading the very first snapshot: no live events pushed yet and the
  // fallback poll hasn't settled. Once either has data, or the poll settles
  // with nothing, this stops being "loading" and becomes real content or an
  // empty state — never a permanent skeleton.
  const telemetryLoading = telemetryQuery.isLoading && telemetryEvents.length === 0;
  const telemetryData = telemetryLoading ? null : telemetryEvents;
  // A failed background poll shouldn't blank out telemetry we already have
  // from the live stream — only surface it as an error when there's nothing
  // else to show.
  const telemetryError = telemetryEvents.length === 0 ? telemetryQuery.error : null;

  const activeData = tab === 'alerts' ? alerts.data : tab === 'audit' ? audit.data : telemetryEvents;

  const handleExport = React.useCallback(() => {
    if (!activeData || activeData.length === 0) {
      toast.warning('Nothing to export', { description: `No ${tab} data available.` });
      return;
    }
    setExporting(true);
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const payload = {
        kind: tab,
        exportedAt: new Date().toISOString(),
        count: activeData.length,
        items: activeData,
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dmrx-${tab}-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Export ready', { description: `${activeData.length} ${tab} exported to JSON.` });
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setExporting(false);
    }
  }, [activeData, tab]);

  const liveBadge = paused
    ? { tone: 'muted' as const, label: 'paused' }
    : connection === 'open'
      ? { tone: 'success' as const, label: 'live' }
      : { tone: 'warning' as const, label: connection === 'connecting' ? 'connecting' : 'reconnecting' };

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Observability"
        description="Alerts · Audit log · Live telemetry stream"
        icon={<Bell className="size-5" />}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            loading={exporting}
            disabled={!activeData || activeData.length === 0}
            leftIcon={<Download className="size-3" aria-hidden />}
          >
            Export {tab}
          </Button>
        }
      />

      <div className="mt-5">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="alerts">
              <AlertCircle className="size-3" aria-hidden />
              Alerts
              <Badge tone="muted" size="sm">{alerts.data?.length ?? 0}</Badge>
            </TabsTrigger>
            <TabsTrigger value="audit">
              <FileText className="size-3" aria-hidden />
              Audit
              <Badge tone="muted" size="sm">{audit.data?.length ?? 0}</Badge>
            </TabsTrigger>
            <TabsTrigger value="telemetry">
              <Activity className="size-3" aria-hidden />
              Telemetry
              <Badge tone={liveBadge.tone} size="sm">{liveBadge.label}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="alerts">
            <DataState
              data={alerts.data}
              isLoading={alerts.isLoading}
              error={alerts.error}
              onRetry={alerts.refetch}
              skeletonRows={3}
              empty={{
                icon: <CheckCircle2 className="size-5 text-success" aria-hidden />,
                title: 'No alerts',
                description: 'All systems are operating within normal parameters.',
              }}
            >
              {(list) => (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {list.map((a) => (
                    <AlertCard
                      key={a.id}
                      alert={a}
                      onAcknowledge={() => {
                        ackMutation.mutate(a.id, {
                          onSuccess: () =>
                            toast.info('Acknowledged', {
                              description: 'Action is in-memory only and will not persist across refreshes.',
                            }),
                          onError: (err) => {
                            const e = interpretError(err);
                            toast.error(e.title, { description: e.description });
                          },
                        });
                      }}
                      onResolve={() => {
                        resolveMutation.mutate(a.id, {
                          onSuccess: () =>
                            toast.info('Resolved', {
                              description: 'Action is in-memory only and will not persist across refreshes.',
                            }),
                          onError: (err) => {
                            const e = interpretError(err);
                            toast.error(e.title, { description: e.description });
                          },
                        });
                      }}
                    />
                  ))}
                </div>
              )}
            </DataState>
          </TabsContent>

          <TabsContent value="audit">
            <Card padding="none">
              <DataState
                data={audit.data}
                isLoading={audit.isLoading}
                error={audit.error}
                onRetry={audit.refetch}
                loading={
                  <div className="p-3 flex flex-col gap-1.5">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                }
                empty={{
                  icon: <FileText className="size-8" aria-hidden />,
                  title: 'No audit events',
                  description: 'System activity will appear here as it happens.',
                }}
              >
                {(list) => (
                  <div className="p-1 max-h-[700px] overflow-y-auto">
                    {list.map((e) => (
                      <AuditEventRow key={e.id} event={e} />
                    ))}
                  </div>
                )}
              </DataState>
            </Card>
          </TabsContent>

          <TabsContent value="telemetry">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-2xs text-fg-subtle">
                {paused
                  ? 'Live tail paused — the stream keeps running elsewhere in the app, but this list stops updating.'
                  : 'Streaming live from the gateway.'}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPaused(!paused)}
                leftIcon={paused ? <Play className="size-3" aria-hidden /> : <Pause className="size-3" aria-hidden />}
              >
                {paused ? 'Resume' : 'Pause'}
              </Button>
            </div>
            <Card padding="none">
              <div aria-live="polite" aria-label="Live telemetry events">
                <DataState
                  data={telemetryData}
                  isLoading={telemetryLoading}
                  error={telemetryError}
                  onRetry={telemetryQuery.refetch}
                  loading={
                    <div className="p-3 flex flex-col gap-1.5">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <Skeleton key={i} className="h-4 w-full" />
                      ))}
                    </div>
                  }
                  empty={{
                    icon: <Activity className="size-8" aria-hidden />,
                    title: connection === 'open' ? 'Connected, no events yet' : 'No telemetry',
                    description:
                      connection === 'open'
                        ? 'Send a request through the gateway to see live events appear here.'
                        : paused
                          ? 'The live tail is paused. Resume it to see new events as they arrive.'
                          : 'Waiting to connect to the gateway stream.',
                  }}
                >
                  {(list) => (
                    <div className="p-1 max-h-[700px] overflow-y-auto font-mono">
                      {list.map((e) => (
                        <TelemetryEventRow key={e.id} event={e} />
                      ))}
                    </div>
                  )}
                </DataState>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}
