import { Bell, Activity, FileText, AlertCircle, CheckCircle2, Download, Pause, Play } from 'lucide-react';
import * as React from 'react';

import { AlertCard } from '@/components/domain/AlertCard';
import { AuditEventRow } from '@/components/domain/AuditEventRow';
import { TelemetryEventRow } from '@/components/domain/TelemetryEventRow';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
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

  const activeData = tab === 'alerts' ? alerts.data : tab === 'audit' ? audit.data : telemetryEvents;
  const activeIsLoading =
    tab === 'alerts'
      ? alerts.isLoading
      : tab === 'audit'
        ? audit.isLoading
        : telemetryQuery.isLoading && telemetryEvents.length === 0;

  const handleExport = React.useCallback(() => {
    if (!activeData || activeData.length === 0) {
      toast.warning('Nothing to export', { description: `No ${tab} data available` });
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
      toast.success('Export ready', { description: `${activeData.length} ${tab} → JSON` });
    } catch (err) {
      toast.error('Export failed', {
        description: err instanceof Error ? err.message : String(err),
      });
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
            disabled={activeIsLoading || !activeData || activeData.length === 0}
          >
            <Download className="size-3" />
            Export {tab}
          </Button>
        }
      />

      <div className="mt-5">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="alerts">
              <AlertCircle className="size-3" />
              Alerts
              <Badge tone="muted" size="sm">{alerts.data?.length ?? 0}</Badge>
            </TabsTrigger>
            <TabsTrigger value="audit">
              <FileText className="size-3" />
              Audit
              <Badge tone="muted" size="sm">{audit.data?.length ?? 0}</Badge>
            </TabsTrigger>
            <TabsTrigger value="telemetry">
              <Activity className="size-3" />
              Telemetry
              <Badge tone={liveBadge.tone} size="sm">{liveBadge.label}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="alerts">
            {alerts.isLoading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : alerts.data && alerts.data.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {alerts.data.map((a) => (
                  <AlertCard
                    key={a.id}
                    alert={a}
                    onAcknowledge={() => {
                      ackMutation.mutate(a.id, {
                        onSuccess: () =>
                          toast.info('Acknowledged', {
                            description: 'Action is in-memory only and will not persist across refreshes.',
                          }),
                        onError: (err) =>
                          toast.error('Failed to acknowledge', {
                            description: err instanceof Error ? err.message : String(err),
                          }),
                      });
                    }}
                    onResolve={() => {
                      resolveMutation.mutate(a.id, {
                        onSuccess: () =>
                          toast.info('Resolved', {
                            description: 'Action is in-memory only and will not persist across refreshes.',
                          }),
                        onError: (err) =>
                          toast.error('Failed to resolve', {
                            description: err instanceof Error ? err.message : String(err),
                          }),
                      });
                    }}
                  />
                ))}
              </div>
            ) : (
              <Card padding="none" className="border-dashed">
                <EmptyState
                  icon={<CheckCircle2 className="size-5 text-success" />}
                  title="No alerts"
                  description="All systems are operating within normal parameters."
                />
              </Card>
            )}
          </TabsContent>

          <TabsContent value="audit">
            <Card padding="none">
              {audit.isLoading ? (
                <div className="p-3 flex flex-col gap-1.5">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : audit.data && audit.data.length > 0 ? (
                <div className="p-1 max-h-[700px] overflow-y-auto">
                  {audit.data.map((e) => (
                    <AuditEventRow key={e.id} event={e} />
                  ))}
                </div>
              ) : (
                <EmptyState title="No audit events" description="System activity will appear here." />
              )}
            </Card>
          </TabsContent>

          <TabsContent value="telemetry">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-2xs text-fg-subtle">
                {paused
                  ? 'Live tail paused — the stream keeps running elsewhere in the app, but this list stops updating.'
                  : 'Streaming live from the gateway.'}
              </p>
              <Button variant="outline" size="sm" onClick={() => setPaused(!paused)}>
                {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
                {paused ? 'Resume' : 'Pause'}
              </Button>
            </div>
            <Card padding="none">
              {activeIsLoading ? (
                <div className="p-3 flex flex-col gap-1.5">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-full" />
                  ))}
                </div>
              ) : telemetryEvents.length > 0 ? (
                <div className="p-1 max-h-[700px] overflow-y-auto font-mono">
                  {telemetryEvents.map((e) => (
                    <TelemetryEventRow key={e.id} event={e} />
                  ))}
                </div>
              ) : (
                <EmptyState title="No telemetry" description="Send a request to see live events." />
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}
