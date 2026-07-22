import * as React from 'react';
import { Wrench, Play } from 'lucide-react';

import { Admin, apiPost } from '@/lib/admin';
import { Badge, Button, Card, Input, Textarea } from '@/components/primitives';
import { cn } from '@/lib/utils';
import type { CapabilityTab } from '@/lib/playgroundCaps';

import { EmptyHint, JsonView, PanelError, PanelLoading, useAsync } from './PanelShell';

interface McpTool {
  name?: string;
  id?: string;
  description?: string;
  namespace?: string;
  schema?: Record<string, unknown> | string;
  inputSchema?: Record<string, unknown> | string;
  [k: string]: unknown;
}

export function McpToolsPanel({ tab }: { tab: CapabilityTab }) {
  const list = useAsync<McpTool[]>(() => Admin.listMcpTools() as Promise<McpTool[]>, []);
  const [selected, setSelected] = React.useState<McpTool | null>(null);
  const [args, setArgs] = React.useState('{}');
  const [executing, setExecuting] = React.useState(false);
  const [result, setResult] = React.useState<unknown>(null);
  const [execError, setExecError] = React.useState<string | null>(null);

  function selectTool(t: McpTool) {
    setSelected(t);
    setResult(null);
    setExecError(null);
    const schema = (t.schema ?? t.inputSchema) as Record<string, unknown> | string | undefined;
    if (schema && typeof schema === 'object' && Array.isArray((schema as any).required)) {
      const init: Record<string, unknown> = {};
      for (const key of (schema as any).required as string[]) init[key] = '';
      setArgs(JSON.stringify(init, null, 2));
    } else {
      setArgs('{}');
    }
  }

  async function execute() {
    if (!selected || executing) return;
    setExecuting(true);
    setExecError(null);
    setResult(null);
    try {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(args || '{}');
      } catch {
        throw new Error('Arguments must be valid JSON.');
      }
      const res = await apiPost('/admin/mcp/tools/execute', {
        tool_call: { function: { name: selected.name ?? selected.id ?? '', arguments: JSON.stringify(parsed) } },
      });
      setResult(res);
    } catch (e) {
      setExecError(e instanceof Error ? e.message : String(e));
    } finally {
      setExecuting(false);
    }
  }

  const items = Array.isArray(list.data) ? (list.data as McpTool[]) : [];
  const toolName = selected?.name ?? selected?.id ?? '';

  return (
    <div className="flex h-full gap-4">
      <div className="flex w-80 shrink-0 flex-col gap-3">
        <div className="min-h-0 flex-1 space-y-2 overflow-auto">
          {list.loading ? <PanelLoading /> : list.error ? <PanelError error={list.error} onRetry={list.refetch} /> : items.length === 0 ? <EmptyHint>No MCP tools registered.</EmptyHint> : items.map((t) => (
            <button key={t.name ?? t.id ?? JSON.stringify(t)} onClick={() => selectTool(t)} className={cn('w-full rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40', selected?.name === t.name ? 'border-primary/50 bg-primary/5' : 'bg-surface-1')}>
              <div className="flex items-center gap-2">
                <Wrench className="size-3.5 text-fg-muted" />
                <span className="font-mono text-xs font-medium text-fg">{t.name ?? t.id}</span>
              </div>
              {t.description ? <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">{t.description}</p> : null}
              {t.namespace ? <Badge tone="muted" size="sm" variant="soft" className="mt-1">{t.namespace}</Badge> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {selected ? (
          <div className="space-y-3">
            <Card className="p-4">
              <div className="mb-1 flex items-center gap-2">
                <Wrench className="size-4 text-primary" />
                <span className="font-mono text-sm font-semibold text-fg">{toolName}</span>
              </div>
              {selected.description ? <p className="text-xs text-fg-subtle">{selected.description}</p> : null}
              {selected.schema || selected.inputSchema ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-fg-muted">Input schema</summary>
                  <JsonView value={typeof (selected.schema ?? selected.inputSchema) === 'string' ? (selected.schema ?? selected.inputSchema) : (selected.schema ?? selected.inputSchema)} />
                </details>
              ) : null}
              <label className="mt-3 block space-y-1">
                <span className="text-xs font-medium text-fg-muted">Arguments (JSON)</span>
                <Textarea value={args} onChange={(e) => setArgs(e.target.value)} rows={5} className="font-mono text-xs" />
              </label>
              <Button onClick={execute} disabled={executing} className="mt-2"><Play className="size-4" /> {executing ? 'Executing…' : 'Execute tool'}</Button>
            </Card>
            {execError ? <PanelError error={execError} /> : result ? <JsonView value={result} /> : <EmptyHint>Execute to see the result.</EmptyHint>}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border">
            <EmptyHint>Select a tool to inspect its schema and execute it.</EmptyHint>
          </div>
        )}
      </div>
    </div>
  );
}
