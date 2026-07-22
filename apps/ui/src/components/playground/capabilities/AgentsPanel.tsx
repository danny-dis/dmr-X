import * as React from 'react';
import { Bot, Play, Plus, RefreshCw, Store, CalendarClock, Send, Square } from 'lucide-react';

import { Admin } from '@/lib/admin';
import { Badge, Button, Card, Input, Textarea } from '@/components/primitives';
import { cn } from '@/lib/utils';
import type { CapabilityTab } from '@/lib/playgroundCaps';

import { EmptyHint, PanelError, PanelLoading, useAsync } from './PanelShell';

/** A gateway agent definition (from GET /v1/agents). */
interface AgentDef {
  id: string;
  name?: string;
  description?: string;
  status?: string;
  [k: string]: unknown;
}

/** A deployed agent instance (from GET /v1/agents/:id/instances). */
interface AgentInstance {
  id: string;
  agentDefinitionId?: string;
  status?: string;
  [k: string]: unknown;
}

interface TraceEvent {
  type: string;
  [k: string]: unknown;
}

function AgentRunner({ instanceId, agentName }: { instanceId: string; agentName?: string }) {
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Array<{ role: string; content: string }>>([]);
  const [draft, setDraft] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [trace, setTrace] = React.useState<TraceEvent[]>([]);
  const [finalAnswer, setFinalAnswer] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [trace, finalAnswer, messages]);

  async function run(message: string) {
    if (!message.trim() || running) return;
    const next = [...messages, { role: 'user', content: message }];
    setMessages(next);
    setDraft('');
    setRunning(true);
    setTrace([]);
    setFinalAnswer('');

    try {
      const body: Record<string, unknown> = { messages: next, stream: true, maxSteps: 12, maxTokens: 4000 };
      const url = sessionId ? `/api/v1/agents/${sessionId}/chat` : `/api/v1/agents/${instanceId}/chat`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok || !resp.body) {
        const err = await resp.text().catch(() => resp.statusText);
        throw new Error(`HTTP ${resp.status}: ${err.slice(0, 260)}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split('\n\n');
        buf = blocks.pop() ?? '';
        for (const blk of blocks) {
          let eventType = 'message';
          let payload = '';
          for (const line of blk.split('\n')) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            else if (line.startsWith('data:')) payload = line.slice(5).trim();
          }
          if (!payload || payload === '[DONE]') continue;
          try {
            const data = JSON.parse(payload);
            const convoId = data.resolvedConversationId ?? data.conversationId;
            if (convoId && !sessionId) setSessionId(convoId);
            setTrace((t) => [...t, { type: eventType, ...data }]);
            if ((eventType === 'turn' || eventType === 'assistant' || eventType === 'agent_start') && data.message?.content) {
              setFinalAnswer((a) => a + data.message.content);
            }
          } catch {
            /* ignore malformed */
          }
        }
      }
    } catch (err) {
      setTrace((t) => [...t, { type: 'error', message: err instanceof Error ? err.message : String(err) }]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Badge tone={sessionId ? 'success' : 'muted'} size="sm" variant="soft">
            {sessionId ? `session ${sessionId.slice(0, 8)}…` : 'new session'}
          </Badge>
          <button
            onClick={() => { setSessionId(null); setMessages([]); setTrace([]); setFinalAnswer(''); }}
            className="underline underline-offset-2 hover:text-fg"
          >
            reset
          </button>
        </div>
        <Button size="sm" variant="ghost" onClick={() => run('Run a quick self-test task.')} disabled={running}>
          <Play className="size-3.5" /> Self-test
        </Button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-auto rounded-lg border border-border bg-surface-1 p-3">
        {messages.length === 0 && trace.length === 0 ? (
          <EmptyHint>Send a message to start the agentic run. Reusing the session lets you resume.</EmptyHint>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={cn('rounded-md px-2 py-1 text-xs', m.role === 'user' ? 'bg-primary/10 text-fg' : 'bg-surface-2 text-fg-muted')}>
            <span className="font-semibold uppercase opacity-60">{m.role}</span> {m.content}
          </div>
        ))}
        {finalAnswer ? <div className="whitespace-pre-wrap text-sm text-fg">{finalAnswer}</div> : null}
        {trace.map((e, i) => (
          <EventRow key={i} e={e} />
        ))}
      </div>

      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(draft); }}
          placeholder="Task for the agent…  (⌘/Ctrl+Enter to send)"
          className="min-h-[44px] flex-1"
          rows={2}
        />
        <Button onClick={() => run(draft)} disabled={running || !draft.trim()}>
          {running ? <Square className="size-3.5 animate-pulse" /> : <Send className="size-3.5" />}
          {running ? 'Running' : 'Send'}
        </Button>
      </div>
    </div>
  );
}

function EventRow({ e }: { e: TraceEvent }) {
  const tone =
    e.type === 'error' ? 'danger' :
    e.type === 'tool_calls' || e.type === 'tool_results' ? 'info' :
    e.type === 'delegation' ? 'warning' : 'muted';
  const summary = React.useMemo(() => {
    if (e.type === 'agent_start') return `agent_start · ${e.agentName ?? ''} · ${e.model ?? ''}`;
    if (e.type === 'turn') return `turn ${typeof e.turn === 'number' ? e.turn : ''} · ${e.model ?? ''}`;
    if (e.type === 'tool_calls') return `tool_calls: ${(Array.isArray((e as any).calls) ? (e as any).calls : (e.message as any)?.tool_calls ?? []).map((c: any) => c?.function?.name).filter(Boolean).join(', ')}`;
    if (e.type === 'tool_results') return `tool_results: ${(Array.isArray(e.results) ? e.results : []).map((r: any) => r?.tool_name ?? r?.name).filter(Boolean).join(', ')}`;
    if (e.type === 'delegation') return `delegation → ${e.agentName ?? e.agentId ?? ''}`;
    if (e.type === 'error') return `error: ${e.message ?? ''}`;
    if (e.type === 'message') return ((e.message as any)?.content as string) ?? JSON.stringify(e).slice(0, 120);
    return JSON.stringify(e).slice(0, 120);
  }, [e]);
  return (
    <div className="flex items-start gap-2 text-xs">
      <Badge tone={tone as any} size="sm" variant="soft" className="font-mono">{e.type}</Badge>
      <code className="text-fg-muted">{summary}</code>
    </div>
  );
}

export function AgentsPanel({ tab }: { tab: CapabilityTab }) {
  const [tab2, setTab2] = React.useState<'library' | 'create' | 'marketplace' | 'schedule'>('library');
  const [selected, setSelected] = React.useState<AgentDef | null>(null);
  const [runInstance, setRunInstance] = React.useState<AgentInstance | null>(null);
  const [createName, setCreateName] = React.useState('');
  const [createDesc, setCreateDesc] = React.useState('');
  const [createSystem, setCreateSystem] = React.useState('');
  const [cron, setCron] = React.useState('0 * * * *');
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const list = useAsync<AgentDef[]>(() => Admin.listAgents() as Promise<AgentDef[]>, [tab2]);
  const marketplace = useAsync<AgentDef[]>(() => Admin.listAgentMarketplace() as Promise<AgentDef[]>, []);

  // Resolve a runnable instance for the selected agent.
  const instances = useAsync<AgentInstance[]>(
    () => (selected ? Admin.listAgentInstances(selected.id) : Promise.resolve([])) as Promise<AgentInstance[]>,
    [selected?.id, selected?.name],
  );

  React.useEffect(() => {
    if (!selected) { setRunInstance(null); return; }
    const active = (instances.data ?? []).find((i) => i.status === 'active') ?? (instances.data ?? [])[0];
    setRunInstance(active ?? null);
  }, [selected, instances.data]);

  async function ensureInstance(): Promise<string | null> {
    if (!selected) return null;
    if (runInstance) return runInstance.id;
    // No instance yet — deploy one.
    try {
      const inst = await Admin.deployAgent(selected.id);
      const id = (inst as any)?.id ?? (inst as any)?.instanceId;
      if (id) { setRunInstance({ id, status: 'active' }); return id; }
    } catch (e) {
      setNotice(`Deploy failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
  }

  async function handleCreate() {
    if (!createName.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await Admin.createAgent({ name: createName.trim(), description: createDesc, systemPrompt: createSystem });
      setNotice(`Created agent ${(res as any)?.id ?? ''}.`);
      setCreateName('');
      setCreateDesc('');
      setCreateSystem('');
      setTab2('library');
      list.refetch();
    } catch (e) {
      setNotice(`Create failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSchedule() {
    if (!selected || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await Admin.scheduleAgent(selected.id, { cron });
      setNotice(`Scheduled "${selected.name}" on "${cron}".`);
    } catch (e) {
      setNotice(`Schedule failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full gap-4">
      <div className="flex w-72 shrink-0 flex-col gap-3">
        <div className="flex gap-1">
          {(['library', 'create', 'schedule', 'marketplace'] as const).map((t) => (
            <Button key={t} size="sm" variant={tab2 === t ? 'secondary' : 'ghost'} onClick={() => setTab2(t)} className="capitalize">
              {t === 'library' ? <Bot className="size-3" /> : t === 'create' ? <Plus className="size-3" /> : t === 'schedule' ? <CalendarClock className="size-3" /> : <Store className="size-3" />}
              {t}
            </Button>
          ))}
        </div>

        {tab2 === 'library' ? (
          <div className="min-h-0 flex-1 space-y-2 overflow-auto">
            {list.loading ? <PanelLoading /> : list.error ? <PanelError error={list.error} onRetry={list.refetch} /> : (list.data ?? []).length === 0 ? <EmptyHint>No agents yet. Use “create” to add one, or start a run with the seeded agents.</EmptyHint> : (list.data ?? []).map((a) => (
              <button key={a.id} onClick={() => setSelected(a)} className={cn('w-full rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40', selected?.id === a.id ? 'border-primary/50 bg-primary/5' : 'bg-surface-1')}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-fg">{a.name ?? a.id}</span>
                  <Badge tone="muted" size="sm" variant="soft" className="font-mono">{a.id.slice(0, 6)}</Badge>
                </div>
                {a.description ? <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">{a.description}</p> : null}
              </button>
            ))}
          </div>
        ) : null}

        {tab2 === 'create' ? (
          <div className="space-y-2">
            <Field label="Name"><Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Research Assistant" /></Field>
            <Field label="Description"><Input value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder="What it does" /></Field>
            <Field label="System prompt"><Textarea value={createSystem} onChange={(e) => setCreateSystem(e.target.value)} rows={4} placeholder="You are a helpful research agent…" /></Field>
            <Button onClick={handleCreate} disabled={busy || !createName.trim()} className="w-full"><Plus className="size-4" /> Create agent</Button>
          </div>
        ) : null}

        {tab2 === 'schedule' ? (
          <div className="space-y-2">
            {selected ? (
              <>
                <p className="text-xs text-fg-muted">Scheduling <span className="font-medium text-fg">{selected.name}</span></p>
                <Field label="Cron expression"><Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 * * * *" /></Field>
                <Button onClick={handleSchedule} disabled={busy} className="w-full"><CalendarClock className="size-4" /> Schedule run</Button>
              </>
            ) : <EmptyHint>Select an agent from the library first.</EmptyHint>}
          </div>
        ) : null}

        {tab2 === 'marketplace' ? (
          <div className="min-h-0 flex-1 space-y-2 overflow-auto">
            {marketplace.loading ? <PanelLoading /> : (marketplace.data ?? []).length === 0 ? <EmptyHint>Marketplace empty.</EmptyHint> : (marketplace.data ?? []).map((a, i) => (
              <div key={a.id ?? i} className="rounded-lg border border-border bg-surface-1 p-3">
                <span className="text-sm font-medium text-fg">{a.name ?? 'Unknown'}</span>
                {a.description ? <p className="mt-1 text-xs text-fg-subtle">{a.description}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        {selected ? (
          <Card className="flex h-full flex-col p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-fg">{selected.name}</h3>
                <p className="text-xs text-fg-subtle">{selected.description ?? 'No description'}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={list.refetch}><RefreshCw className="size-3.5" /> Refresh</Button>
            </div>
            <div className="mb-2 flex items-center gap-2 text-xs text-fg-muted">
              <Badge tone={runInstance ? 'success' : 'warning'} size="sm" variant="soft">
                {runInstance ? `instance ${runInstance.id.slice(0, 8)}…` : 'no active instance'}
              </Badge>
              {!runInstance && !instances.loading ? (
                <button className="underline underline-offset-2 hover:text-fg" onClick={() => ensureInstance()}>deploy one</button>
              ) : null}
            </div>
            <div className="min-h-0 flex-1">
              {runInstance ? (
                <AgentRunner instanceId={runInstance.id} agentName={selected.name} />
              ) : (
                <EmptyHint>{instances.loading ? 'Loading instances…' : 'Deploy an instance to run this agent.'}</EmptyHint>
              )}
            </div>
          </Card>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border">
            <EmptyHint>Select an agent to run, resume, or schedule it.</EmptyHint>
          </div>
        )}
        {notice ? <p className="mt-2 text-xs text-fg-muted">{notice}</p> : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
