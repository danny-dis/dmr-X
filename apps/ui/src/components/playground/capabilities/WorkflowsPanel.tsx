import * as React from 'react';
import { Workflow, Plus, Trash2, Play, ArrowDownUp } from 'lucide-react';

import { Admin } from '@/lib/admin';
import { Badge, Button, Input, Textarea, Switch } from '@/components/primitives';
import type { CapabilityTab } from '@/lib/playgroundCaps';

import { EmptyHint, JsonView, PanelError } from './PanelShell';

interface Step {
  tool: string;
  input: string;
  dependsOn: string;
}

interface StepResult {
  id: string;
  tool: string;
  status: string;
  result?: unknown;
  error?: string;
}

export function WorkflowsPanel({ tab }: { tab: CapabilityTab }) {
  const [name, setName] = React.useState('my-workflow');
  const [parallel, setParallel] = React.useState(false);
  const [steps, setSteps] = React.useState<Step[]>([{ tool: '', input: '{}', dependsOn: '' }]);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<{ id: string; status: string; steps: StepResult[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function updateStep(i: number, patch: Partial<Step>) {
    setSteps((s) => s.map((step, idx) => (idx === i ? { ...step, ...patch } : step)));
  }
  function addStep() {
    setSteps((s) => [...s, { tool: '', input: '{}', dependsOn: '' }]);
  }
  function removeStep(i: number) {
    setSteps((s) => s.filter((_, idx) => idx !== i));
  }

  async function run() {
    if (running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const payload = {
        name: name.trim() || 'workflow',
        parallel,
        steps: steps
          .filter((s) => s.tool.trim())
          .map((s) => ({
            tool: s.tool.trim(),
            input: safeParse(s.input),
            ...(s.dependsOn.trim() ? { dependsOn: s.dependsOn.split(',').map((x) => x.trim()).filter(Boolean) } : {}),
          })),
      };
      const res = await Admin.runWorkflow(payload as any);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex h-full gap-4">
      <div className="flex w-[22rem] shrink-0 flex-col gap-3">
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">Workflow name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-1 px-3 py-2">
            <span className="flex items-center gap-2 text-xs text-fg-muted"><ArrowDownUp className="size-3.5" /> Run steps in parallel</span>
            <Switch checked={parallel} onCheckedChange={setParallel} />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
          {steps.map((s, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface-1 p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <Badge tone="muted" size="sm" variant="soft" className="font-mono">step-{i + 1}</Badge>
                <button onClick={() => removeStep(i)} className="text-fg-subtle hover:text-destructive" aria-label="Remove step">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <Input value={s.tool} onChange={(e) => updateStep(i, { tool: e.target.value })} placeholder="tool name (e.g. dmrx_web_search)" className="mb-1.5" />
              <Textarea value={s.input} onChange={(e) => updateStep(i, { input: e.target.value })} rows={3} className="mb-1.5 font-mono text-xs" placeholder="{ &quot;query&quot;: &quot;...&quot; }" />
              <Input value={s.dependsOn} onChange={(e) => updateStep(i, { dependsOn: e.target.value })} placeholder="dependsOn: step-1,step-2" className="text-xs" />
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={addStep} className="w-full"><Plus className="size-3.5" /> Add step</Button>
        </div>

        <Button onClick={run} disabled={running || steps.every((s) => !s.tool.trim())} className="w-full">
          <Play className="size-4" /> {running ? 'Executing…' : 'Execute workflow'}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? <PanelError error={error} /> : result ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone={result.status === 'completed' ? 'success' : 'warning'} size="sm" variant="soft">{result.status}</Badge>
              <span className="font-mono text-xs text-fg-muted">{result.id}</span>
            </div>
            {result.steps.map((r) => (
              <div key={r.id} className="rounded-lg border border-border bg-surface-1 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-xs text-fg">{r.id} · {r.tool}</span>
                  <Badge tone={r.status === 'success' ? 'success' : r.status === 'error' ? 'danger' : 'muted'} size="sm" variant="soft">{r.status}</Badge>
                </div>
                {r.error ? <p className="text-xs text-destructive">{r.error}</p> : <JsonView value={r.result} />}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border">
            <EmptyHint>Compose workflow steps (each is a registered MCP tool call) and execute them.</EmptyHint>
          </div>
        )}
      </div>
    </div>
  );
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? v : {};
  } catch {
    return {};
  }
}
