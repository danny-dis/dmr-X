import * as React from 'react';
import { Send, Sparkles, RotateCcw, Save, Cpu, Brain } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card } from '@/components/primitives/Card';
import { Button } from '@/components/primitives/Button';
import { Input } from '@/components/primitives/Input';
import { Textarea } from '@/components/primitives/Textarea';
import { Badge } from '@/components/primitives/Badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/primitives/Tabs';
import { Skeleton } from '@/components/primitives/Skeleton';
import { ModalityBadge } from '@/icons/Modality';
import { IntelligenceBadge } from '@/icons/IntelligenceLayer';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatDuration, formatNumber, formatTokens, timeAgo } from '@/lib/formatters';
import type { ApiModel, ApiProvider } from '@/types/api';

const SAMPLES = [
  {
    label: 'Chat completion',
    body: { model: 'free', messages: [{ role: 'user', content: 'Explain quantum entanglement in one paragraph.' }] },
  },
  {
    label: 'Image generation',
    body: { model: 'dall-e-3', prompt: 'A serene mountain landscape at sunset, oil painting style' },
  },
  {
    label: 'Embeddings',
    body: { model: 'text-embedding-3-small', input: 'DMR-X is a universal AI routing gateway.' },
  },
  {
    label: 'Code completion',
    body: { model: 'claude-sonnet-4', messages: [{ role: 'user', content: 'Write a TypeScript debounce function.' }] },
  },
];

export function PlaygroundPage() {
  const [tab, setTab] = React.useState('chat');
  const [model, setModel] = React.useState('free');
  const [prompt, setPrompt] = React.useState(SAMPLES[0].body.messages[0].content);
  const [response, setResponse] = React.useState<{
    text: string;
    meta?: { latency: number; tokens: number; provider: string; cost: number };
  } | null>(null);
  const [loading, setLoading] = React.useState(false);

  const models = useApiData<ApiModel[]>(() => Admin.listModels(), [], { refetchInterval: 60_000 });
  const providers = useApiData<ApiProvider[]>(() => Admin.listProviders(), [], { refetchInterval: 60_000 });

  const onSend = async () => {
    setLoading(true);
    setResponse(null);
    const start = performance.now();
    try {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? data.text ?? JSON.stringify(data, null, 2);
      setResponse({
        text,
        meta: {
          latency: performance.now() - start,
          tokens: data.usage?.total_tokens ?? 0,
          provider: data.provider ?? 'auto',
          cost: data.cost ?? 0,
        },
      });
    } catch (e) {
      setResponse({ text: `Error: ${(e as Error).message}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Playground"
        description="Test any model through the router — see real-time routing decisions"
        icon={<Sparkles className="size-5" />}
        actions={
          <Button variant="ghost" size="sm" onClick={() => { setPrompt(''); setResponse(null); }}>
            <RotateCcw className="size-3" />
            Reset
          </Button>
        }
      />

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card padding="md" className="lg:col-span-2">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="image">Image</TabsTrigger>
              <TabsTrigger value="embed">Embed</TabsTrigger>
              <TabsTrigger value="code">Code</TabsTrigger>
            </TabsList>
            <TabsContent value={tab} className="mt-3 flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Model</label>
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">free (auto-route)</SelectItem>
                      <SelectItem value="free-fast">free-fast</SelectItem>
                      <SelectItem value="free-smart">free-smart</SelectItem>
                      <SelectItem value="free-agentic">free-agentic</SelectItem>
                      <SelectItem value="free-coding">free-coding</SelectItem>
                      {(models.data ?? []).slice(0, 20).map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name} <span className="text-fg-subtle ml-1">· {m.provider}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Layer</label>
                  <Select defaultValue="auto">
                    <SelectTrigger>
                      <SelectValue placeholder="auto" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto</SelectItem>
                      <SelectItem value="brain">Brain</SelectItem>
                      <SelectItem value="thinker">Thinker</SelectItem>
                      <SelectItem value="executor">Executor</SelectItem>
                      <SelectItem value="worker">Worker</SelectItem>
                      <SelectItem value="temp_worker">Temp Worker</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Prompt</label>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={6}
                  placeholder="Type your prompt…"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] text-fg-muted">
                  <span>{prompt.length} chars</span>
                  <span>·</span>
                  <span>~{Math.ceil(prompt.length / 4)} tokens</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm">
                    <Save className="size-3" />
                    Save preset
                  </Button>
                  <Button onClick={onSend} loading={loading} disabled={!prompt}>
                    <Send className="size-3" />
                    Send
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </Card>

        <Card padding="md">
          <h3 className="text-sm font-semibold text-fg mb-2">Samples</h3>
          <p className="text-[10px] text-fg-muted mb-3">Click to load</p>
          <div className="flex flex-col gap-1.5">
            {SAMPLES.map((s) => (
              <button
                key={s.label}
                onClick={() => {
                  setPrompt(s.body.messages?.[0]?.content ?? s.body.prompt ?? s.body.input ?? '');
                }}
                className="text-left rounded-lg border border-border bg-surface-2 px-2.5 py-2 hover:border-border-strong hover:bg-surface-3 transition-colors"
              >
                <div className="text-xs font-medium text-fg">{s.label}</div>
                <div className="text-[10px] text-fg-muted truncate mt-0.5">
                  {s.body.messages?.[0]?.content ?? s.body.prompt ?? s.body.input}
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-3">
        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-fg">Response</h3>
            {response?.meta && (
              <div className="flex items-center gap-3 text-[10px]">
                <span className="text-fg-muted">
                  <span className="text-fg-subtle">latency</span>{' '}
                  <span className="text-fg font-mono">{formatDuration(response.meta.latency)}</span>
                </span>
                <span className="text-fg-muted">
                  <span className="text-fg-subtle">tokens</span>{' '}
                  <span className="text-fg font-mono">{formatTokens(response.meta.tokens)}</span>
                </span>
                <span className="text-fg-muted">
                  <span className="text-fg-subtle">cost</span>{' '}
                  <span className="text-fg font-mono">${response.meta.cost.toFixed(4)}</span>
                </span>
                <Badge tone="primary" size="sm">{response.meta.provider}</Badge>
              </div>
            )}
          </div>
          {loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ) : response ? (
            <pre className="text-sm text-fg leading-relaxed whitespace-pre-wrap font-sans">
              {response.text}
            </pre>
          ) : (
            <div className="py-12 text-center text-fg-subtle text-sm">
              Send a prompt to see the response
            </div>
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
