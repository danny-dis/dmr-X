import * as React from 'react';
import { Network, Send, RefreshCw } from 'lucide-react';

import { Admin } from '@/lib/admin';
import { apiPost } from '@/lib/admin';
import { Badge, Button, Card, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives';
import type { CapabilityTab } from '@/lib/playgroundCaps';

import { EmptyHint, JsonView, PanelError, PanelLoading, useAsync } from './PanelShell';

interface ModelEntry {
  id: string;
  name?: string;
  provider?: string;
  context_window?: number;
  [k: string]: unknown;
}
interface Decision {
  id?: string;
  requestId?: string;
  provider?: string;
  model?: string;
  latency_ms?: number;
  cost?: number;
  cost_usd?: number;
  fallback?: boolean;
  chosenAt?: string;
  createdAt?: string;
  [k: string]: unknown;
}

export function RoutingPanel({ tab }: { tab: CapabilityTab }) {
  const models = useAsync<ModelEntry[]>(() => Admin.listModels() as unknown as Promise<ModelEntry[]>, []);
  const decisions = useAsync<Decision[]>(() => Admin.listRouteDecisions() as unknown as Promise<Decision[]>, []);
  const [prompt, setPrompt] = React.useState('Explain routing in one sentence.');
  const [model, setModel] = React.useState('auto');
  const [probing, setProbing] = React.useState(false);
  const [lastDecision, setLastDecision] = React.useState<Decision | null>(null);
  const [probeError, setProbeError] = React.useState<string | null>(null);

  async function probe() {
    if (probing) return;
    setProbing(true);
    setProbeError(null);
    setLastDecision(null);
    try {
      await apiPost('/chat/completions', {
        model: model === 'auto' ? undefined : model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        max_tokens: 64,
      });
      const fresh = await Admin.listRouteDecisions();
      const sorted = [...(fresh as unknown as Decision[])].sort((a, b) => {
        const ta = new Date(b.chosenAt ?? b.createdAt ?? 0).getTime();
        const tb = new Date(a.chosenAt ?? a.createdAt ?? 0).getTime();
        return ta - tb;
      });
      setLastDecision(sorted[0] ?? null);
      decisions.refetch();
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  }

  const modelList = Array.isArray(models.data) ? (models.data as ModelEntry[]) : [];
  const decisionList = Array.isArray(decisions.data) ? (decisions.data as Decision[]) : [];

  return (
    <div className="flex h-full gap-4">
      <div className="flex w-96 shrink-0 flex-col gap-3">
        <Card className="space-y-3 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-fg"><Network className="size-4 text-primary" /> Run a routed request</h3>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">Model</span>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger><SelectValue placeholder="Auto (router decides)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">auto — let the router decide</SelectItem>
                {modelList.map((m) => <SelectItem key={m.id} value={m.id}>{m.name ?? m.id}{m.provider ? ` · ${m.provider}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">Prompt</span>
            <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <Button onClick={probe} disabled={probing} className="w-full"><Send className="size-4" /> {probing ? 'Routing…' : 'Send & capture decision'}</Button>
          {probeError ? <p className="text-xs text-destructive">{probeError}</p> : null}
          {lastDecision ? (
            <div className="space-y-2 rounded-lg border border-border bg-surface-1 p-3">
              <div className="text-xs font-semibold text-fg">Routing decision</div>
              <DecisionRow d={lastDecision} />
            </div>
          ) : null}
        </Card>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg">Routing Log {decisionList.length ? <Badge tone="muted" size="sm" variant="soft">{decisionList.length}</Badge> : null}</h3>
          <Button size="sm" variant="ghost" onClick={decisions.refetch}><RefreshCw className="size-3.5" /> Refresh</Button>
        </div>
        {decisions.loading ? <PanelLoading /> : decisions.error ? <PanelError error={decisions.error} /> : decisionList.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border"><EmptyHint>No routing decisions yet — run a routed request.</EmptyHint></div>
        ) : (
          <div className="space-y-2">
            {decisionList.map((d, i) => (
              <div key={d.id ?? i} className="rounded-lg border border-border bg-surface-1 p-3">
                <DecisionRow d={d} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DecisionRow({ d }: { d: Decision }) {
  const cost = d.cost_usd ?? d.cost;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="info" size="sm" variant="soft">{d.provider ?? '—'}</Badge>
      <span className="font-mono text-xs text-fg">{d.model ?? '—'}</span>
      {typeof d.latency_ms === 'number' ? <Badge tone="muted" size="sm" variant="soft">{d.latency_ms} ms</Badge> : null}
      {typeof cost === 'number' ? <Badge tone="muted" size="sm" variant="soft">${cost.toFixed(5)}</Badge> : null}
      {d.fallback ? <Badge tone="warning" size="sm" variant="soft">fallback</Badge> : null}
      {d.requestId ? <span className="font-mono text-[10px] text-fg-subtle">{d.requestId}</span> : null}
    </div>
  );
}
