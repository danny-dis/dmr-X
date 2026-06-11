import {
  Sparkles,
  Send,
  RotateCcw,
  Settings2,
  ChevronDown,
  MessageSquare,
  Image as ImageIcon,
  Type,
  Volume2,
  Mic,
  ArrowUpDown,
  ShieldAlert,
  Terminal,
  Brain,
  Zap,
  Clock,
  DollarSign,
  Search,
  Plus,
  Save,
  Trash2,
  ChevronRight,
  Info,
  ThumbsUp,
  ThumbsDown,
  Copy,
  Check,
} from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card } from '@/components/primitives/Card';
import { Button } from '@/components/primitives/Button';
import { Input } from '@/components/primitives/Input';
import { Textarea } from '@/components/primitives/Textarea';
import { Badge } from '@/components/primitives/Badge';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Slider } from '@/components/primitives/Slider';
import { Switch } from '@/components/primitives/Switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/primitives/Tabs';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { apiPost } from '@/lib/api';
import { formatDuration, formatTokens } from '@/lib/formatters';
import { toast } from '@/components/primitives/Toast';
import { cn } from '@/lib/utils';
import type { ApiModel } from '@/types/api';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type PlaygroundMode = 'chat' | 'image' | 'embed' | 'tts' | 'stt' | 'rerank' | 'moderate' | 'agent';

interface PlaygroundResponse {
  id: string; // requestId
  text: string;
  audioUrl?: string;
  meta?: {
    latency: number;
    tokens: number;
    provider: string;
    model: string;
    cost: number;
    routingDecision?: string;
  };
  feedback?: 'up' | 'down' | null;
  copied?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Presets                                                                   */
/* -------------------------------------------------------------------------- */

const SAMPLES: Record<PlaygroundMode, { label: string; prompt: string }[]> = {
  chat: [
    { label: 'Explain', prompt: 'Explain quantum entanglement in one paragraph.' },
    { label: 'Code', prompt: 'Write a TypeScript debounce function.' },
    { label: 'Poem', prompt: 'Write a haiku about a lonely satellite.' },
  ],
  image: [
    { label: 'Cyberpunk', prompt: 'A futuristic Tokyo street at night, neon signs, rainy reflections, cinematic lighting, 8k' },
    { label: 'Oil Painting', prompt: 'A serene mountain lake at sunset, thick brushstrokes, impressionist style' },
  ],
  embed: [
    { label: 'Sentence', prompt: 'DMR-X is a universal AI routing gateway.' },
  ],
  tts: [
    { label: 'Greeting', prompt: 'Hello and welcome to the DMR-X universal AI gateway.' },
  ],
  stt: [],
  rerank: [
    { label: 'Docs', prompt: 'How does the routing algorithm work?' },
  ],
  moderate: [
    { label: 'Check', prompt: 'This is a test message to check content moderation.' },
  ],
  agent: [
    { label: 'Research', prompt: 'Find the current weather in New York and compare it with London.' },
  ],
};

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function PlaygroundPage() {
  const [mode, setMode] = React.useState<PlaygroundMode>('chat');
  const [model, setModel] = React.useState('free');
  const [prompt, setPrompt] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [responses, setResponses] = React.useState<PlaygroundResponse[]>([]);

  // Config
  const [temperature, setTemperature] = React.useState(0.7);
  const [maxTokens, setMaxTokens] = React.useState<number | undefined>(undefined);
  const [stream, setStream] = React.useState(true);
  const [showConfig, setShowConfig] = React.useState(false);

  // Data
  const models = useApiData<ApiModel[]>(() => Admin.listModels(), [], { refetchInterval: 60_000 });

  const filteredModels = React.useMemo(() => {
    const all = models.data ?? [];
    switch (mode) {
      case 'image': return all.filter(m => m.modality === 'diffusion');
      case 'embed': return all.filter(m => m.modality === 'embedding');
      case 'tts': return all.filter(m => m.modality === 'audio_tts');
      case 'stt': return all.filter(m => m.modality === 'audio_stt');
      case 'rerank': return all.filter(m => m.modality === 'reranking');
      default: return all.filter(m => m.modality === 'llm');
    }
  }, [models.data, mode]);

  const onSend = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    const start = performance.now();

    try {
      let endpoint = '/chat/completions';
      let body: any = { model, stream: false }; // Disable streaming for simplicity in this helper call

      if (mode === 'chat') {
        body.messages = [{ role: 'user', content: prompt }];
        body.temperature = temperature;
        if (maxTokens) body.max_tokens = maxTokens;
      } else if (mode === 'image') {
        endpoint = '/images/generations';
        body.prompt = prompt;
      } else if (mode === 'tts') {
        endpoint = '/audio/speech';
        body.input = prompt;
        body.voice = 'alloy';
      } else if (mode === 'embed') {
        endpoint = '/embeddings';
        body.input = prompt;
      } else if (mode === 'rerank') {
        endpoint = '/rerank';
        body.query = prompt;
        body.documents = ['Example doc 1', 'Example doc 2'];
      }

      if (mode === 'tts') {
        // Special case for audio blob
        const RAW_BASE = (import.meta.env.VITE_API_BASE ?? '') as string;
        const res = await fetch(`${RAW_BASE}/v1${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('dmrx_token') || import.meta.env.VITE_ADMIN_API_KEY || ''}`
          },
          body: JSON.stringify(body),
        });
        const requestId = res.headers.get('x-request-id') || crypto.randomUUID();
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setResponses(prev => [{
          id: requestId,
          text: 'Audio generated successfully.',
          audioUrl: url,
          meta: {
            latency: performance.now() - start,
            tokens: 0,
            provider: model,
            model: model,
            cost: 0
          }
        }, ...prev]);
      } else {
        const data: any = await apiPost(endpoint, body);

        let text = '';
        if (mode === 'chat') text = data.choices?.[0]?.message?.content ?? data.text;
        else if (mode === 'image') text = data.data?.[0]?.url || data.data?.[0]?.b64_json;
        else if (mode === 'embed') text = `Vector: [${data.data?.[0]?.embedding?.slice(0, 5).join(', ')}...] (${data.data?.[0]?.embedding?.length} dims)`;
        else text = JSON.stringify(data, null, 2);

        setResponses(prev => [{
          id: data.id || crypto.randomUUID(),
          text,
          meta: {
            latency: performance.now() - start,
            tokens: data.usage?.total_tokens ?? 0,
            provider: data.provider ?? 'auto',
            model: data.model ?? model,
            cost: data.cost ?? 0,
            routingDecision: data.routing_decision
          }
        }, ...prev]);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleFeedback = async (requestId: string, rating: number) => {
    try {
      await Admin.submitFeedback({ requestId, rating });
      setResponses(prev => prev.map(r => r.id === requestId ? { ...r, feedback: rating === 1 ? 'up' : 'down' } : r));
      toast.success('Feedback recorded');
    } catch (e) {
      toast.error('Failed to submit feedback');
    }
  };

  const handleCopy = async (requestId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      await Admin.submitFeedback({ requestId, implicitSignals: { copied: true } });
      setResponses(prev => prev.map(r => r.id === requestId ? { ...r, copied: true } : r));
      setTimeout(() => {
        setResponses(prev => prev.map(r => r.id === requestId ? { ...r, copied: false } : r));
      }, 2000);
      toast.success('Copied to clipboard');
    } catch (e) {
      // ignore
    }
  };

  return (
    <PageContainer size="wide" className="h-[calc(100dvh-64px)] overflow-hidden flex flex-col">
      <div className="shrink-0">
        <PageHeader
          title="Playground"
          description="Test any model through the universal router"
          icon={<Sparkles className="size-5" />}
        />
      </div>

      <div className="flex-1 mt-5 flex gap-4 min-h-0">
        {/* Sidebar Controls */}
        <Card padding="none" className="w-80 shrink-0 flex flex-col shadow-sm">
          <div className="p-4 border-b border-border flex flex-col gap-4">
            <div>
              <label className="text-[10px] text-fg-muted mb-1.5 block uppercase tracking-wider font-semibold">Mode</label>
              <div className="grid grid-cols-2 gap-1.5">
                {(['chat', 'image', 'embed', 'tts', 'rerank', 'moderate'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors border',
                      mode === m
                        ? 'bg-primary/10 border-primary/20 text-primary'
                        : 'bg-surface-2 border-transparent text-fg-muted hover:bg-surface-3 hover:text-fg'
                    )}
                  >
                    {m === 'chat' && <MessageSquare className="size-3.5" />}
                    {m === 'image' && <ImageIcon className="size-3.5" />}
                    {m === 'embed' && <ArrowUpDown className="size-3.5" />}
                    {m === 'tts' && <Volume2 className="size-3.5" />}
                    {m === 'rerank' && <Zap className="size-3.5" />}
                    {m === 'moderate' && <ShieldAlert className="size-3.5" />}
                    <span className="capitalize">{m}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-fg-muted mb-1.5 block uppercase tracking-wider font-semibold">Model</label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">free (auto-route)</SelectItem>
                  {filteredModels.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} <span className="text-fg-subtle opacity-60 ml-1">· {m.provider}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Configuration</span>
                <Button variant="ghost" size="icon-sm" onClick={() => setShowConfig(!showConfig)}>
                  <Settings2 className="size-3" />
                </Button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-fg-muted">Temperature</span>
                    <span className="text-fg font-mono">{temperature}</span>
                  </div>
                  <Slider
                    value={[temperature]}
                    onValueChange={v => setTemperature(v[0] ?? 0.7)}
                    max={2}
                    step={0.1}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-fg-muted">Stream response</span>
                  <Switch checked={stream} onCheckedChange={setStream} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <span className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">Samples</span>
              <div className="flex flex-col gap-1.5">
                {SAMPLES[mode].map(s => (
                  <button
                    key={s.label}
                    onClick={() => setPrompt(s.prompt)}
                    className="text-left p-2.5 rounded-lg bg-surface-2 border border-border/50 hover:bg-surface-3 transition-colors group"
                  >
                    <div className="text-[11px] font-medium text-fg mb-0.5">{s.label}</div>
                    <div className="text-[10px] text-fg-subtle truncate">{s.prompt}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-border bg-surface-2/50">
            <Button className="w-full" onClick={onSend} loading={loading} disabled={!prompt.trim()}>
              <Send className="size-3.5" />
              Run Request
            </Button>
          </div>
        </Card>

        {/* Main Area */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <Card padding="none" className="shrink-0 bg-surface-1 shadow-sm overflow-hidden">
            <div className="p-3">
              <Textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder={`Enter ${mode} prompt...`}
                className="min-h-[120px] bg-transparent border-none resize-none focus:ring-0 text-sm p-0 shadow-none"
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    void onSend();
                  }
                }}
              />
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/40">
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setPrompt('')} className="h-7 text-xs">
                    <RotateCcw className="size-3" />
                    Reset
                  </Button>
                </div>
                <div className="text-[10px] text-fg-subtle">
                  Press <Kbd>⌘</Kbd>+<Kbd>Enter</Kbd> to run
                </div>
              </div>
            </div>
          </Card>

          {/* Results Stream */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar">
            {responses.length === 0 && !loading && (
              <div className="h-full flex flex-col items-center justify-center text-center p-12 opacity-40">
                <div className="size-16 rounded-3xl bg-surface-2 flex items-center justify-center mb-4">
                  <Terminal className="size-8" />
                </div>
                <h3 className="text-sm font-semibold text-fg">Ready for input</h3>
                <p className="text-xs text-fg-muted mt-1 max-w-[200px]">
                  Configure your request and hit run to see the universal router in action.
                </p>
              </div>
            )}

            {loading && (
              <Card padding="md" className="animate-pulse">
                <div className="flex items-center gap-2 mb-4">
                  <Skeleton className="size-8 rounded-lg" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-3 w-full mb-2" />
                <Skeleton className="h-3 w-5/6" />
              </Card>
            )}

            {responses.map((res, i) => (
              <Card key={res.id} padding="none" className="overflow-hidden group shadow-sm border-border/60">
                <div className="bg-surface-2/50 px-4 py-2 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge tone="primary" size="sm">{res.meta?.provider}</Badge>
                    <span className="text-[11px] font-mono text-fg-muted">{res.meta?.model}</span>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-fg-subtle">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {formatDuration(res.meta?.latency ?? 0)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Zap className="size-3" />
                      {formatTokens(res.meta?.tokens ?? 0)}
                    </span>
                    <span className="flex items-center gap-1">
                      <DollarSign className="size-3" />
                      {res.meta?.cost.toFixed(4)}
                    </span>
                  </div>
                </div>

                <div className="p-4">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1">
                      {res.audioUrl ? (
                        <audio controls src={res.audioUrl} className="w-full h-8" />
                      ) : mode === 'image' && res.text.startsWith('http') ? (
                        <img src={res.text} className="rounded-lg max-h-[400px] object-contain bg-black mx-auto" />
                      ) : (
                        <div className="text-sm text-fg leading-relaxed whitespace-pre-wrap font-sans">
                          {res.text}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex flex-col gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button 
                        variant="ghost" 
                        size="icon-sm" 
                        onClick={() => handleCopy(res.id, res.text)}
                        className={cn(res.copied && 'text-primary')}
                      >
                        {res.copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon-sm" 
                        onClick={() => handleFeedback(res.id, 1)}
                        className={cn(res.feedback === 'up' && 'text-success bg-success/10')}
                      >
                        <ThumbsUp className="size-3" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon-sm" 
                        onClick={() => handleFeedback(res.id, -1)}
                        className={cn(res.feedback === 'down' && 'text-destructive bg-destructive/10')}
                      >
                        <ThumbsDown className="size-3" />
                      </Button>
                    </div>
                  </div>

                  {res.meta?.routingDecision && (
                    <div className="mt-4 pt-3 border-t border-border/60 flex items-start gap-2">
                      <Info className="size-3 text-primary mt-0.5 shrink-0" />
                      <div className="text-[10px] text-fg-muted leading-tight italic">
                        Routing Decision: {res.meta.routingDecision}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded border border-border bg-surface-2 px-1 font-mono text-[10px] font-medium text-fg shadow-sm">
      {children}
    </kbd>
  );
}
