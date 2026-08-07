import { Hammer, Play, RotateCcw, Code as CodeIcon, Terminal, Coins } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent } from '@/components/primitives/Card';
import { Code } from '@/components/primitives/Code';
import { DataState } from '@/components/primitives/DataState';
import { EmptyState } from '@/components/primitives/EmptyState';
import { InlineError, interpretError } from '@/components/primitives/ErrorState';
import { Input } from '@/components/primitives/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Slider } from '@/components/primitives/Slider';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/primitives/Tabs';
import { Textarea } from '@/components/primitives/Textarea';
import { toast } from '@/components/primitives/Toast';
import { api } from '@/lib/admin';
import { useModels } from '@/lib/queries/models';
import { cn } from '@/lib/utils';

const DEFAULT_MESSAGES = JSON.stringify([{ role: 'user', content: "What's the weather in Tokyo?" }], null, 2);

const DEFAULT_TOOLS = JSON.stringify([
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City name',
          },
        },
        required: ['location'],
      },
    },
  },
], null, 2);

const META_MODELS = [
  { id: 'auto', displayName: 'auto' },
  { id: 'auto-fast', displayName: 'auto-fast' },
  { id: 'auto-smart', displayName: 'auto-smart' },
  { id: 'auto-agentic', displayName: 'auto-agentic' },
  { id: 'auto-coding', displayName: 'auto-coding' },
];

type RequestStatus = 'idle' | 'loading' | 'success' | 'error';

export function ToolsPage() {
  const [mode, setMode] = React.useState<'execute' | 'loop'>('execute');
  const [model, setModel] = React.useState('auto');
  const [costFilter, setCostFilter] = React.useState<'all' | 'free'>('all');
  const [messagesText, setMessagesText] = React.useState(DEFAULT_MESSAGES);
  const [toolsText, setToolsText] = React.useState(DEFAULT_TOOLS);
  const [maxSteps, setMaxSteps] = React.useState(10);
  const [temperature, setTemperature] = React.useState(0.7);
  const [response, setResponse] = React.useState<unknown>(null);
  const [status, setStatus] = React.useState<RequestStatus>('idle');
  const [error, setError] = React.useState<unknown>(null);
  const [latency, setLatency] = React.useState<number | null>(null);
  const [messagesParseError, setMessagesParseError] = React.useState<string | null>(null);
  const [toolsParseError, setToolsParseError] = React.useState<string | null>(null);

  const models = useModels({ modality: 'llm' });

  const allModelOptions = React.useMemo(() => {
    const llmModels = (models.data ?? []).map((m) => ({
      id: m.id,
      displayName: m.displayName ?? m.name,
    }));
    return [...META_MODELS, ...llmModels];
  }, [models.data]);

  function validateJson(value: string, setErrorFn: (err: string | null) => void) {
    try {
      JSON.parse(value);
      setErrorFn(null);
    } catch (e) {
      setErrorFn((e as Error).message);
    }
  }

  async function onSubmit() {
    setStatus('loading');
    setError(null);
    setResponse(null);
    setLatency(null);

    let parsedMessages: unknown;
    let parsedTools: unknown;
    try {
      parsedMessages = JSON.parse(messagesText);
    } catch (e) {
      setMessagesParseError((e as Error).message);
      setStatus('idle');
      return;
    }
    try {
      parsedTools = JSON.parse(toolsText);
    } catch (e) {
      setToolsParseError((e as Error).message);
      setStatus('idle');
      return;
    }
    setMessagesParseError(null);
    setToolsParseError(null);

    const endpoint = mode === 'execute' ? '/v1/tools/execute' : '/v1/tools/loop';
    const body: Record<string, unknown> = {
      model,
      messages: parsedMessages,
      tools: parsedTools,
      temperature,
      stream: false,
    };
    if (mode === 'loop') {
      body.max_steps = maxSteps;
    }

    const start = performance.now();
    try {
      const data = await api<unknown>(endpoint, {
        method: 'POST',
        body,
        headers: costFilter === 'free' ? { 'x-cost-filter': 'free' } : {},
      });
      setLatency(performance.now() - start);
      setResponse(data);
      setStatus('success');
    } catch (e) {
      setLatency(performance.now() - start);
      setError(e);
      setStatus('error');
      const interpreted = interpretError(e);
      toast.error(interpreted.title, { description: interpreted.description });
    }
  }

  function reset() {
    setResponse(null);
    setError(null);
    setStatus('idle');
    setLatency(null);
    setMessagesParseError(null);
    setToolsParseError(null);
  }

  const toolResults = React.useMemo(() => {
    if (!response || typeof response !== 'object') return null;
    const r = response as Record<string, unknown>;
    // Some agentic backends nest tool outputs at different paths depending
    // on whether a single step or multi-step trace is returned. Check both.
    const direct = r.tool_results as unknown[] | undefined;
    if (Array.isArray(direct)) return direct;
    const steps = r.steps as unknown[] | undefined;
    const nested = steps?.[0] as Record<string, unknown> | undefined;
    const nestedResults = nested?.tool_results as unknown[] | undefined;
    return Array.isArray(nestedResults) ? nestedResults : null;
  }, [response]);

  const stepsCount = React.useMemo(() => {
    if (!response || typeof response !== 'object') return null;
    const r = response as Record<string, unknown>;
    if (Array.isArray(r.steps)) return (r.steps as unknown[]).length;
    return null;
  }, [response]);

  return (
    <PageContainer>
      <PageHeader
        title="Tools"
        description="Test tool execution and multi-turn tool loops"
        icon={<Hammer className="size-5" />}
      />

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Left column — Configuration */}
        <Card padding="md" className="lg:col-span-1">
          <CardContent className="flex flex-col gap-4 px-0">
            {/* Model selector */}
            <div>
              <label htmlFor="tools-model-select" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Model</label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger id="tools-model-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {allModelOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {models.error && (
                <InlineError error={models.error} onRetry={models.refetch} className="mt-2" />
              )}
            </div>

            {/* Cost Filter — only visible for meta-model aliases */}
            {model.startsWith('auto') && (
              <div>
                <span id="tools-cost-filter-label" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Cost Filter</span>
                <div
                  role="group"
                  aria-labelledby="tools-cost-filter-label"
                  className="flex items-center gap-1 rounded-md border border-border bg-surface-2 p-0.5"
                >
                  <button
                    type="button"
                    aria-pressed={costFilter === 'all'}
                    onClick={() => setCostFilter('all')}
                    className={cn(
                      'flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors',
                      costFilter === 'all' ? 'bg-primary text-primary-foreground' : 'text-fg-muted hover:text-fg'
                    )}
                  >
                    <Coins className="size-2.5" aria-hidden />
                    All providers
                  </button>
                  <button
                    type="button"
                    aria-pressed={costFilter === 'free'}
                    onClick={() => setCostFilter('free')}
                    className={cn(
                      'flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors',
                      costFilter === 'free' ? 'bg-primary text-primary-foreground' : 'text-fg-muted hover:text-fg'
                    )}
                  >
                    Free only
                  </button>
                </div>
              </div>
            )}

            {/* Mode selector */}
            <div>
              <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Mode</label>
              <Tabs value={mode} onValueChange={(v) => setMode(v as 'execute' | 'loop')}>
                <TabsList className="w-full">
                  <TabsTrigger value="execute" className="flex-1">Execute</TabsTrigger>
                  <TabsTrigger value="loop" className="flex-1">Loop</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Max steps (loop only) */}
            {mode === 'loop' && (
              <div>
                <label htmlFor="tools-max-steps" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Max Steps</label>
                <Input
                  id="tools-max-steps"
                  type="number"
                  value={String(maxSteps)}
                  onChange={(e) => setMaxSteps(Number(e.target.value))}
                  min={1}
                />
              </div>
            )}

            {/* Messages */}
            <div>
              <label htmlFor="tools-messages" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Messages (JSON array)</label>
              <Textarea
                id="tools-messages"
                value={messagesText}
                onChange={(e) => {
                  setMessagesText(e.target.value);
                  validateJson(e.target.value, setMessagesParseError);
                }}
                rows={8}
                invalid={!!messagesParseError}
                aria-invalid={!!messagesParseError}
                aria-describedby={messagesParseError ? 'tools-messages-error' : undefined}
                className="font-mono text-xs"
              />
              {messagesParseError && (
                <p id="tools-messages-error" className="text-[10px] text-danger mt-0.5">{messagesParseError}</p>
              )}
            </div>

            {/* Tools */}
            <div>
              <label htmlFor="tools-tools" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Tools (JSON array)</label>
              <Textarea
                id="tools-tools"
                value={toolsText}
                onChange={(e) => {
                  setToolsText(e.target.value);
                  validateJson(e.target.value, setToolsParseError);
                }}
                rows={8}
                invalid={!!toolsParseError}
                aria-invalid={!!toolsParseError}
                aria-describedby={toolsParseError ? 'tools-tools-error' : undefined}
                className="font-mono text-xs"
              />
              {toolsParseError && (
                <p id="tools-tools-error" className="text-[10px] text-danger mt-0.5">{toolsParseError}</p>
              )}
            </div>

            {/* Temperature */}
            <div>
              <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Temperature</label>
              <div className="flex items-center gap-3">
                <Slider
                  value={[temperature]}
                  min={0}
                  max={2}
                  step={0.05}
                  onValueChange={(v) => setTemperature(v[0] ?? 0.7)}
                  className="flex-1"
                />
                <span className="text-xs text-fg-muted tabular-nums w-8 text-right" aria-live="polite">
                  {temperature.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Execute button */}
            <Button
              size="sm"
              className="w-full mt-2"
              onClick={onSubmit}
              loading={status === 'loading'}
              leftIcon={<Play className="size-3" aria-hidden />}
            >
              Execute
            </Button>
          </CardContent>
        </Card>

        {/* Right column — Results */}
        <Card padding="md" className="lg:col-span-2">
          <CardContent className="px-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-fg">Response</h3>
                {status === 'loading' && (
                  <Badge tone="info" size="sm">Executing...</Badge>
                )}
                {status === 'success' && (
                  <Badge tone="success" size="sm">Success</Badge>
                )}
                {status === 'error' && (
                  <Badge tone="danger" size="sm">Error</Badge>
                )}
                {latency !== null && (
                  <span className="text-[10px] text-fg-muted tabular-nums">
                    {latency.toFixed(0)}ms
                  </span>
                )}
                {stepsCount !== null && (
                  <span className="text-[10px] text-fg-muted tabular-nums">
                    {stepsCount} step{stepsCount > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {(status === 'success' || status === 'error') && (
                <Button size="sm" variant="secondary" onClick={reset}>
                  <RotateCcw className="size-3" aria-hidden />
                  Reset
                </Button>
              )}
            </div>

            <DataState
              data={response}
              isLoading={status === 'loading'}
              error={status === 'error' ? error : null}
              onRetry={onSubmit}
              skeletonRows={4}
              empty={{
                icon: <Terminal className="size-8" />,
                title: 'Ready',
                description: 'Configure the request and press Execute to see the response.',
              }}
            >
              {(data) => (
                <Tabs defaultValue="response" className="w-full">
                  <TabsList>
                    <TabsTrigger value="response">
                      <CodeIcon className="size-3" aria-hidden />
                      Response
                    </TabsTrigger>
                    <TabsTrigger value="tool-results" disabled={!toolResults}>
                      <Terminal className="size-3" aria-hidden />
                      Tool Results
                    </TabsTrigger>
                    <TabsTrigger value="raw">
                      <CodeIcon className="size-3" aria-hidden />
                      Raw
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="response" className="max-h-[500px] overflow-auto">
                    <Code copyable inline={false}>
                      {JSON.stringify(data, null, 2)}
                    </Code>
                  </TabsContent>

                  <TabsContent value="tool-results" className="max-h-[500px] overflow-auto">
                    {toolResults ? (
                      <Code copyable inline={false}>
                        {JSON.stringify(toolResults, null, 2)}
                      </Code>
                    ) : (
                      <EmptyState
                        title="No tool results"
                        description="The response does not contain any tool results."
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="raw" className="max-h-[500px] overflow-auto">
                    <Code copyable inline={false}>
                      {JSON.stringify(data, null, 2)}
                    </Code>
                  </TabsContent>
                </Tabs>
              )}
            </DataState>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
