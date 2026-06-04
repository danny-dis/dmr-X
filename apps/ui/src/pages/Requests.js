import * as React from 'react';
import { Workflow, Search, Activity, Download } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card } from '@/components/primitives/Card';
import { Input } from '@/components/primitives/Input';
import { Button } from '@/components/primitives/Button';
import { Toggle } from '@/components/primitives/Toggle';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Pagination } from '@/components/primitives/Pagination';
import { TelemetryEventRow } from '@/components/domain/TelemetryEventRow';
import { useApiData, useDebounce } from '@/hooks';
import { useLiveStore } from '@/store/useLiveStore';
import { useUIStore } from '@/store/useUIStore';
import { Admin } from '@/lib/admin';
export function RequestsPage() {
    const [query, setQuery] = React.useState('');
    const [kindFilter, setKindFilter] = React.useState(null);
    const [statusFilter, setStatusFilter] = React.useState('all');
    const [page, setPage] = React.useState(1);
    const debounced = useDebounce(query, 200);
    const pageSize = 50;
    const liveMode = useUIStore((s) => s.liveMode);
    const events = useApiData(() => Admin.listTelemetry({ limit: 200 }), [], { refetchInterval: liveMode ? 3000 : false });
    const liveEvents = useLiveStore((s) => s.events);
    const all = liveMode ? [...liveEvents, ...(events.data ?? [])] : (events.data ?? []);
    const filtered = all.filter((e) => {
        if (debounced && !`${e.kind} ${e.tenant} ${e.model} ${e.message}`.toLowerCase().includes(debounced.toLowerCase()))
            return false;
        if (kindFilter && e.kind !== kindFilter)
            return false;
        if (statusFilter === 'ok' && e.status === 'error')
            return false;
        if (statusFilter === 'error' && e.status !== 'error')
            return false;
        return true;
    });
    const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
    const counts = filtered.reduce((acc, e) => {
        acc[e.kind] = (acc[e.kind] ?? 0) + 1;
        return acc;
    }, {});
    return (<PageContainer size="wide">
      <PageHeader title="Requests" description="Live stream of all requests routed through the gateway" icon={<Workflow className="size-5"/>} actions={<>
            <Toggle pressed={liveMode} onPressedChange={useUIStore.getState().setLiveMode}>
              <Activity className="size-3"/>
              {liveMode ? 'Live' : 'Paused'}
            </Toggle>
            <Button variant="secondary" size="sm">
              <Download className="size-3"/>
              Export
            </Button>
          </>}/>

      <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-2">
        {['request', 'routing', 'model', 'tool', 'system'].map((k) => (<button key={k} onClick={() => setKindFilter(kindFilter === k ? null : k)} className={`rounded-lg border px-3 py-2 text-left transition-colors ${kindFilter === k
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-surface-1 text-fg-muted hover:bg-surface-2'}`}>
            <div className="text-[10px] uppercase tracking-wider">{k}</div>
            <div className="text-lg font-semibold tabular-nums">{counts[k] ?? 0}</div>
          </button>))}
      </div>

      <Card padding="none" className="mt-3">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <div className="flex-1 max-w-sm">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by tenant, model, message…" prefix={<Search className="size-3.5"/>} size="sm"/>
          </div>
          <div className="flex items-center gap-1">
            {['all', 'ok', 'error'].map((s) => (<button key={s} onClick={() => setStatusFilter(s)} className={`h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors ${statusFilter === s
                ? s === 'error'
                    ? 'bg-danger/10 text-danger border border-danger/20'
                    : s === 'ok'
                        ? 'bg-success/10 text-success border border-success/20'
                        : 'bg-surface-2 text-fg border border-border'
                : 'text-fg-muted hover:bg-surface-2'}`}>
                {s}
              </button>))}
          </div>
        </div>

        <div className="p-2 min-h-[400px]">
          {events.isLoading ? (<div className="flex flex-col gap-1.5 p-2">
              {Array.from({ length: 12 }).map((_, i) => (<Skeleton key={i} className="h-5 w-full"/>))}
            </div>) : paged.length > 0 ? (<div className="flex flex-col">
              {paged.map((e) => (<TelemetryEventRow key={e.id} event={e}/>))}
            </div>) : (<EmptyState title="No requests yet" description="Send a request through the gateway to see live events here." size="md"/>)}
        </div>

        {filtered.length > pageSize && (<div className="border-t border-border px-3 py-2.5">
            <Pagination page={page} totalPages={Math.ceil(filtered.length / pageSize)} onPageChange={setPage} total={filtered.length} pageSize={pageSize}/>
          </div>)}
      </Card>
    </PageContainer>);
}
//# sourceMappingURL=Requests.js.map