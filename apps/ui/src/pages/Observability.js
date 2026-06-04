import * as React from 'react';
import { Bell, Activity, FileText, AlertCircle, CheckCircle2, Download } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card } from '@/components/primitives/Card';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Skeleton } from '@/components/primitives/Skeleton';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { AlertCard } from '@/components/domain/AlertCard';
import { AuditEventRow } from '@/components/domain/AuditEventRow';
import { TelemetryEventRow } from '@/components/domain/TelemetryEventRow';
import { useApiData } from '@/hooks/useApiData';
import { useUIStore } from '@/store/useUIStore';
import { Admin } from '@/lib/admin';
import { toast } from '@/components/primitives/Toast';
export function ObservabilityPage() {
    const [tab, setTab] = React.useState('alerts');
    const [exporting, setExporting] = React.useState(false);
    const liveMode = useUIStore((s) => s.liveMode);
    const alerts = useApiData(() => Admin.listAlerts(), [], { refetchInterval: 10000 });
    const audit = useApiData(() => Admin.listAudit({ limit: 100 }), [], { refetchInterval: 30000 });
    const telemetry = useApiData(() => Admin.listTelemetry({ limit: 200 }), [], { refetchInterval: liveMode ? 3000 : false });
    const activeData = tab === 'alerts' ? alerts.data : tab === 'audit' ? audit.data : telemetry.data;
    const activeIsLoading = tab === 'alerts' ? alerts.isLoading : tab === 'audit' ? audit.isLoading : telemetry.isLoading;
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
        }
        catch (err) {
            toast.error('Export failed', {
                description: err instanceof Error ? err.message : String(err),
            });
        }
        finally {
            setExporting(false);
        }
    }, [activeData, tab]);
    return (<PageContainer size="wide">
      <PageHeader title="Observability" description="Alerts · Audit log · Live telemetry stream" icon={<Bell className="size-5"/>} actions={<Button variant="secondary" size="sm" onClick={handleExport} loading={exporting} disabled={activeIsLoading || !activeData || activeData.length === 0}>
            <Download className="size-3"/>
            Export {tab}
          </Button>}/>

      <div className="mt-5">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="alerts">
              <AlertCircle className="size-3"/>
              Alerts
              <Badge tone="muted" size="sm">{alerts.data?.length ?? 0}</Badge>
            </TabsTrigger>
            <TabsTrigger value="audit">
              <FileText className="size-3"/>
              Audit
              <Badge tone="muted" size="sm">{audit.data?.length ?? 0}</Badge>
            </TabsTrigger>
            <TabsTrigger value="telemetry">
              <Activity className="size-3"/>
              Telemetry
              <Badge tone={liveMode ? 'success' : 'muted'} size="sm">{liveMode ? 'live' : 'paused'}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="alerts">
            {alerts.isLoading ? (<div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (<Skeleton key={i} className="h-16 w-full"/>))}
              </div>) : alerts.data && alerts.data.length > 0 ? (<div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {alerts.data.map((a) => (<AlertCard key={a.id} alert={a} onAcknowledge={() => Admin.acknowledgeAlert(a.id).then(() => toast.show('Acknowledged', { tone: 'success' }))} onResolve={() => Admin.resolveAlert(a.id).then(() => toast.show('Resolved', { tone: 'success' }))}/>))}
              </div>) : (<Card padding="none" className="border-dashed">
                <EmptyState icon={<CheckCircle2 className="size-5 text-success"/>} title="No alerts" description="All systems are operating within normal parameters."/>
              </Card>)}
          </TabsContent>

          <TabsContent value="audit">
            <Card padding="none">
              {audit.isLoading ? (<div className="p-3 flex flex-col gap-1.5">
                  {Array.from({ length: 8 }).map((_, i) => (<Skeleton key={i} className="h-10 w-full"/>))}
                </div>) : audit.data && audit.data.length > 0 ? (<div className="p-1 max-h-[700px] overflow-y-auto">
                  {audit.data.map((e) => (<AuditEventRow key={e.id} event={e}/>))}
                </div>) : (<EmptyState title="No audit events" description="System activity will appear here."/>)}
            </Card>
          </TabsContent>

          <TabsContent value="telemetry">
            <Card padding="none">
              {telemetry.isLoading ? (<div className="p-3 flex flex-col gap-1.5">
                  {Array.from({ length: 10 }).map((_, i) => (<Skeleton key={i} className="h-4 w-full"/>))}
                </div>) : telemetry.data && telemetry.data.length > 0 ? (<div className="p-1 max-h-[700px] overflow-y-auto font-mono">
                  {telemetry.data.map((e) => (<TelemetryEventRow key={e.id} event={e}/>))}
                </div>) : (<EmptyState title="No telemetry" description="Send a request to see live events."/>)}
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>);
}
//# sourceMappingURL=Observability.js.map