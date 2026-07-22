import * as React from 'react';
import { FolderClock, Save, Search, Trash2, Bot } from 'lucide-react';

import { Admin } from '@/lib/admin';
import { apiPost } from '@/lib/admin';
import { Badge, Button, Card, Input, Textarea } from '@/components/primitives';
import type { CapabilityTab } from '@/lib/playgroundCaps';

import { EmptyHint, JsonView, PanelError, PanelLoading, useAsync } from './PanelShell';

interface MemItem {
  id?: string;
  content?: string;
  namespace?: string;
  relevance?: number;
  score?: number;
  createdAt?: string;
  source?: string;
  [k: string]: unknown;
}

export function ContextPanel({ tab }: { tab: CapabilityTab }) {
  const [content, setContent] = React.useState('');
  const [namespace, setNamespace] = React.useState('playground-handoff');
  const [query, setQuery] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const list = useAsync<MemItem[]>(() => Admin.contextList(100) as Promise<MemItem[]>, []);

  async function save() {
    if (!content.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await Admin.contextSave({ content: content.trim(), namespace, source: 'playground' });
      setNotice('Saved to DMR-X context.');
      setContent('');
      list.refetch();
    } catch (e) {
      setNotice(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    if (!query.trim()) return list.refetch();
    try {
      const items = await Admin.contextSearch({ query: query.trim(), namespace, limit: 50 });
      // reflect search results inline by re-fetching list afterwards
      list.refetch();
      setNotice(`Searched “${query.trim()}”.`);
    } catch (e) {
      setNotice(`Search failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function del(id: string) {
    try {
      await Admin.contextDelete(id);
      list.refetch();
    } catch {
      /* ignore */
    }
  }

  // Export the current conversation/scratch to a brand-new agent run (pure REST).
  async function exportToAgent() {
    if (!content.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const created = await Admin.createAgent({ name: `Playground export ${new Date().toISOString().slice(11, 19)}`, systemPrompt: 'You are helping with the following handoff context:' });
      const agentId = (created as any)?.id ?? (created as any)?.agentId;
      if (!agentId) throw new Error('No agentId returned from createAgent');
      const inst = await Admin.deployAgent(agentId);
      const instanceId = (inst as any)?.id ?? (inst as any)?.instanceId;
      if (!instanceId) throw new Error('No instance returned from deployAgent');
      const res = await Admin.runAgentChat(instanceId, { messages: [{ role: 'user', content }], stream: false });
      void res;
      setNotice(`Exported to new agent run (${instanceId.slice(0, 8)}…).`);
    } catch (e) {
      setNotice(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const items = Array.isArray(list.data) ? (list.data as MemItem[]) : [];

  return (
    <div className="flex h-full gap-4">
      <div className="flex w-96 shrink-0 flex-col gap-3">
        <Card className="space-y-2 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-fg"><FolderClock className="size-4 text-primary" /> Save handoff</h3>
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} placeholder="Paste a conversation or notes to save into DMR-X context…" />
          <Input value={namespace} onChange={(e) => setNamespace(e.target.value)} placeholder="namespace" />
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy || !content.trim()} className="flex-1"><Save className="size-4" /> Save</Button>
            <Button onClick={exportToAgent} disabled={busy || !content.trim()} variant="secondary" className="flex-1"><Bot className="size-4" /> Export → Agent</Button>
          </div>
        </Card>
        <Card className="space-y-2 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-fg"><Search className="size-4 text-primary" /> Search memory</h3>
          <div className="flex gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="semantic query…" onKeyDown={(e) => e.key === 'Enter' && search()} />
            <Button variant="ghost" onClick={search}><Search className="size-4" /></Button>
          </div>
        </Card>
        {notice ? <p className="text-xs text-fg-muted">{notice}</p> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg">Saved context {items.length ? <Badge tone="muted" size="sm" variant="soft">{items.length}</Badge> : null}</h3>
          <Button size="sm" variant="ghost" onClick={list.refetch}>Refresh</Button>
        </div>
        {list.loading ? <PanelLoading /> : list.error ? <PanelError error={list.error} /> : items.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border"><EmptyHint>No saved context. Save a conversation to try handoff.</EmptyHint></div>
        ) : (
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={it.id ?? i} className="rounded-lg border border-border bg-surface-1 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {it.namespace ? <Badge tone="muted" size="sm" variant="soft">{it.namespace}</Badge> : null}
                    {typeof it.relevance === 'number' ? <Badge tone="info" size="sm" variant="soft">{(it.relevance * 100).toFixed(0)}%</Badge> : null}
                  </div>
                  {it.id ? <button onClick={() => del(it.id!)} className="text-fg-subtle hover:text-destructive"><Trash2 className="size-3.5" /></button> : null}
                </div>
                <p className="whitespace-pre-wrap text-xs text-fg-muted">{String(it.content ?? '').slice(0, 600)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
