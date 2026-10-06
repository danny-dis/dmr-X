/**
 * GodmodeView — full-page G0DM0D3 interface with Chat / Race / Synthesize tabs.
 *
 * Replaces the old design where godmode was "just another chat mode" with
 * settings crammed into the composer. G0DM0D3 is a multi-model racing and
 * synthesis platform — it deserves a dedicated view with:
 *   - Chat: regular godmode pipeline chat
 *   - Race: ULTRAPLINIAN multi-model racing with tier selection
 *   - Synthesize: CONSORTIUM hive-mind synthesis
 *   - Pipeline settings sidebar (AutoTune, Parseltongue, STM, Tier)
 */

import * as React from 'react';
import {
  Sparkles,
  Zap,
  Brain,
  Shield,
  Settings,
  Play,
  Square,
  Trophy,
  Users,
  ChevronDown,
  Check,
  AlertCircle,
  Loader2,
  Copy,
  RefreshCw,
  MessageSquare,
  Bot,
  Cpu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePlaygroundStore } from '@/store/usePlaygroundStore';
import { apiPost } from '@/lib/api';
import { Button } from '@/components/primitives/Button';
import { Badge } from '@/components/primitives/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Switch } from '@/components/primitives/Switch';
import { Textarea } from '@/components/primitives/Textarea';
import { toast } from '@/components/primitives/Toast';
import { MessageBubble } from './MessageBubble';
import { StreamingBubble } from './StreamingBubble';
import { useNavigate } from 'react-router';

// ─── Types ──────────────────────────────────────────────────────────────────

type GodmodeTab = 'chat' | 'race' | 'synthesize';

interface RaceResult {
  winner?: string;
  results?: Array<{
    model: string;
    provider: string;
    content: string;
    latencyMs: number;
    tokensInput?: number;
    tokensOutput?: number;
    cost?: number;
  }>;
  error?: string;
}

interface SynthesizeResult {
  synthesis?: string;
  contributions?: Array<{
    model: string;
    content: string;
  }>;
  error?: string;
}

// ─── Pipeline Settings Sidebar ──────────────────────────────────────────────

function PipelineSettings() {
  const config = usePlaygroundStore(s => s.config);
  const setConfig = usePlaygroundStore(s => s.setConfig);
  const godmode = config.godmode ?? {
    autotune: true,
    parseltongue: true,
    parseltongueTechnique: 'leetspeak',
    parseltongueIntensity: 'medium',
    stmModules: ['hedge_reducer', 'direct_mode'],
  };

  const [open, setOpen] = React.useState(true);

  return (
    <Card className="shrink-0">
      <CardHeader className="pb-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between"
        >
          <CardTitle className="flex items-center gap-2 text-sm">
            <Settings className="size-4 text-primary" />
            Pipeline Settings
          </CardTitle>
          <ChevronDown className={cn('size-4 text-fg-muted transition-transform', !open && '-rotate-90')} />
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4 pt-2">
          {/* Tier */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Zap className="size-3.5 text-warning" />
              <span className="text-xs font-medium">Tier</span>
            </div>
            <Select
              value={(godmode as any).tier ?? 'fast'}
              onValueChange={(value) => setConfig({ godmode: { ...godmode, tier: value } as any })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">Fast</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="smart">Smart</SelectItem>
                <SelectItem value="power">Power</SelectItem>
                <SelectItem value="ultra">Ultra</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-fg-muted">
              Model power for races and synthesis.
            </p>
          </div>

          {/* AutoTune */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="size-3.5 text-warning" />
              <div>
                <div className="text-xs font-medium">AutoTune</div>
                <div className="text-[10px] text-fg-muted">Adaptive parameters</div>
              </div>
            </div>
            <Switch
              checked={godmode.autotune}
              onCheckedChange={(checked) => setConfig({ godmode: { ...godmode, autotune: checked } })}
            />
          </div>

          {/* Parseltongue */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="size-3.5 text-success" />
                <div>
                  <div className="text-xs font-medium">Parseltongue</div>
                  <div className="text-[10px] text-fg-muted">Obfuscation</div>
                </div>
              </div>
              <Switch
                checked={godmode.parseltongue}
                onCheckedChange={(checked) => setConfig({ godmode: { ...godmode, parseltongue: checked } })}
              />
            </div>
            {godmode.parseltongue && (
              <div className="ml-5 grid grid-cols-2 gap-2">
                <Select
                  value={godmode.parseltongueTechnique}
                  onValueChange={(value) => setConfig({ godmode: { ...godmode, parseltongueTechnique: value } })}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="leetspeak">Leetspeak</SelectItem>
                    <SelectItem value="unicode">Unicode</SelectItem>
                    <SelectItem value="zwj">ZWJ</SelectItem>
                    <SelectItem value="mixedcase">Mixed Case</SelectItem>
                    <SelectItem value="phonetic">Phonetic</SelectItem>
                    <SelectItem value="random">Random</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={godmode.parseltongueIntensity}
                  onValueChange={(value) => setConfig({ godmode: { ...godmode, parseltongueIntensity: value as any } })}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="heavy">Heavy</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* STM Modules */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="size-3.5 text-purple-500" />
              <span className="text-xs font-medium">STM Modules</span>
            </div>
            <div className="ml-5 flex flex-wrap gap-1.5">
              {[
                { id: 'hedge_reducer', label: 'Hedge Reducer' },
                { id: 'direct_mode', label: 'Direct Mode' },
                { id: 'curiosity_bias', label: 'Curiosity Bias' },
                { id: 'casual_mode', label: 'Casual Mode' },
              ].map((mod) => (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => {
                    const current = godmode.stmModules;
                    const next = current.includes(mod.id)
                      ? current.filter((m) => m !== mod.id)
                      : [...current, mod.id];
                    setConfig({ godmode: { ...godmode, stmModules: next } });
                  }}
                  className={cn(
                    'rounded-md border px-2 py-1 text-[10px] font-medium transition-colors',
                    godmode.stmModules.includes(mod.id)
                      ? 'border-primary/30 bg-primary/10 text-primary'
                      : 'border-border bg-surface-2/50 text-fg-muted hover:bg-surface-3/50'
                  )}
                >
                  {mod.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Chat Tab ───────────────────────────────────────────────────────────────

function GodmodeChatTab() {
  const messages = usePlaygroundStore(s => s.messages);
  const isStreaming = usePlaygroundStore(s => s.isStreaming);
  const sendMessage = usePlaygroundStore(s => s.sendMessage);
  const cancelStreaming = usePlaygroundStore(s => s.cancelStreaming);
  const config = usePlaygroundStore(s => s.config);
  const mode = usePlaygroundStore(s => s.mode);

  const [prompt, setPrompt] = React.useState('');
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const handleSend = async () => {
    if (!prompt.trim() || isStreaming) return;
    const message = prompt;
    setPrompt('');
    try {
      await sendMessage(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send message');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <div className="mb-4 flex size-16 items-center justify-center rounded-xl border border-border bg-surface-1">
          <Sparkles className="size-8 text-fg-muted" />
        </div>
        <h3 className="mb-2 text-lg font-semibold text-fg">Godmode Chat</h3>
        <p className="mb-4 max-w-md text-center text-sm text-fg-muted">
          Chat with the G0DM0D3 pipeline. AutoTune, Parseltongue, and STM modules enhance every message.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            'Explain quantum entanglement',
            'Write a haiku about satellites',
            'Debug this TypeScript function',
            'Create a marketing pitch',
          ].map((sample) => (
            <Button
              key={sample}
              variant="outline"
              size="sm"
              className="h-auto justify-start px-3 py-2 text-left text-xs"
              onClick={() => setPrompt(sample)}
            >
              {sample}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 py-6">
          {messages.map((message) => (
            <div key={message.id}>
              {message.isStreaming ? (
                <StreamingBubble message={message} />
              ) : (
                <MessageBubble message={message} />
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
      <div className="shrink-0 border-t border-border bg-surface-1/95 p-3">
        <div className="mx-auto w-full max-w-[720px]">
          <div className="relative rounded-xl border border-border bg-surface-2 p-2 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Send a godmode message…"
              className="min-h-[60px] max-h-[180px] resize-none border-0 bg-transparent pr-20 shadow-none focus:ring-0"
              disabled={isStreaming}
            />
            <div className="absolute bottom-2 right-2">
              {isStreaming ? (
                <Button variant="outline" size="sm" onClick={cancelStreaming}>
                  <Square className="size-3" />
                  Stop
                </Button>
              ) : (
                <Button size="sm" onClick={handleSend} disabled={!prompt.trim()}>
                  <Play className="size-3" />
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Race Tab ───────────────────────────────────────────────────────────────

function RaceTab() {
  const config = usePlaygroundStore(s => s.config);
  const tier = (config.godmode as any)?.tier ?? 'fast';

  const [prompt, setPrompt] = React.useState('');
  const [racing, setRacing] = React.useState(false);
  const [result, setResult] = React.useState<RaceResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleRace = async () => {
    if (!prompt.trim() || racing) return;
    setRacing(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiPost<RaceResult>('/v1/godmode/ultraplinian', {
        messages: [{ role: 'user', content: prompt }],
        tier,
        stream: false,
      });
      setResult(res);
    } catch (e: any) {
      setError(e?.message ?? 'Race failed');
    } finally {
      setRacing(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold text-fg">
            <Trophy className="size-5 text-warning" />
            ULTRAPLINIAN Race
          </h3>
          <p className="text-sm text-fg-muted">
            Race multiple models against each other. The fastest and best response wins.
          </p>
        </div>

        {/* Prompt input */}
        <div className="mb-4 space-y-3">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter a prompt to race models against each other…"
            className="min-h-[100px] resize-none"
            disabled={racing}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge tone="muted" size="sm">Tier: {tier}</Badge>
            </div>
            <Button
              onClick={handleRace}
              disabled={!prompt.trim() || racing}
              loading={racing}
            >
              {racing ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Racing…
                </>
              ) : (
                <>
                  <Play className="size-3" />
                  Start Race
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
            <p className="text-xs text-danger">{error}</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-3">
            {result.winner && (
              <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3">
                <Trophy className="size-4 text-success" />
                <span className="text-sm font-medium text-success">
                  Winner: {result.winner}
                </span>
              </div>
            )}
            {result.results?.map((r, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-mono">{r.model}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge tone="muted" size="sm">{r.provider}</Badge>
                      <Badge tone="info" size="sm">{r.latencyMs}ms</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="whitespace-pre-wrap text-xs text-fg">{r.content}</p>
                  {r.tokensOutput && (
                    <div className="mt-2 flex items-center gap-3 text-[10px] text-fg-muted">
                      <span>{r.tokensOutput} tokens</span>
                      {r.cost && <span>${r.cost.toFixed(4)}</span>}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Synthesize Tab ─────────────────────────────────────────────────────────

function SynthesizeTab() {
  const config = usePlaygroundStore(s => s.config);
  const tier = (config.godmode as any)?.tier ?? 'fast';

  const [prompt, setPrompt] = React.useState('');
  const [synthesizing, setSynthesizing] = React.useState(false);
  const [result, setResult] = React.useState<SynthesizeResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleSynthesize = async () => {
    if (!prompt.trim() || synthesizing) return;
    setSynthesizing(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiPost<SynthesizeResult>('/v1/godmode/consortium', {
        messages: [{ role: 'user', content: prompt }],
        tier,
        stream: false,
      });
      setResult(res);
    } catch (e: any) {
      setError(e?.message ?? 'Synthesis failed');
    } finally {
      setSynthesizing(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold text-fg">
            <Users className="size-5 text-accent" />
            CONSORTIUM Synthesis
          </h3>
          <p className="text-sm text-fg-muted">
            Hive-mind synthesis — multiple models contribute to a single, unified response.
          </p>
        </div>

        {/* Prompt input */}
        <div className="mb-4 space-y-3">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter a prompt for multi-model synthesis…"
            className="min-h-[100px] resize-none"
            disabled={synthesizing}
          />
          <div className="flex items-center justify-between">
            <Badge tone="muted" size="sm">Tier: {tier}</Badge>
            <Button
              onClick={handleSynthesize}
              disabled={!prompt.trim() || synthesizing}
              loading={synthesizing}
            >
              {synthesizing ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Synthesizing…
                </>
              ) : (
                <>
                  <Brain className="size-3" />
                  Synthesize
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
            <p className="text-xs text-danger">{error}</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-3">
            {result.synthesis && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Brain className="size-4 text-accent" />
                    Synthesis
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="whitespace-pre-wrap text-sm text-fg">{result.synthesis}</p>
                </CardContent>
              </Card>
            )}
            {result.contributions && result.contributions.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-fg-muted">Contributions</h4>
                {result.contributions.map((c, i) => (
                  <Card key={i}>
                    <CardHeader className="pb-1">
                      <CardTitle className="text-xs font-mono">{c.model}</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="whitespace-pre-wrap text-xs text-fg-muted">{c.content}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main GodmodeView ───────────────────────────────────────────────────────

export function GodmodeView() {
  const [activeTab, setActiveTab] = React.useState<GodmodeTab>('chat');
  const navigate = useNavigate();

  const tabs: Array<{ id: GodmodeTab; label: string; icon: typeof Sparkles }> = [
    { id: 'chat', label: 'Chat', icon: Sparkles },
    { id: 'race', label: 'Race', icon: Trophy },
    { id: 'synthesize', label: 'Synthesize', icon: Users },
  ];

  const modeSwitcher: Array<{ id: string; label: string; icon: typeof MessageSquare }> = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'agent', label: 'Agent', icon: Bot },
    { id: 'godmode', label: 'Godmode', icon: Sparkles },
    { id: 'agentic', label: 'Agentic', icon: Cpu },
  ];

  return (
    <div className="flex min-h-0 flex-1">
      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mode switcher + sub-tab bar */}
        <div className="shrink-0 border-b border-border bg-surface-1/95">
          {/* Mode switcher row */}
          <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
            <div className="flex gap-1">
              {modeSwitcher.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    if (m.id !== 'godmode') {
                      navigate(`/playground/${m.id}`);
                    }
                  }}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                    m.id === 'godmode'
                      ? 'bg-primary/10 text-primary'
                      : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                  )}
                >
                  <m.icon className="size-3" />
                  {m.label}
                </button>
              ))}
            </div>
            <Badge tone="muted" size="sm">G0DM0D3</Badge>
          </div>
          {/* Sub-tab bar */}
          <div className="flex gap-1 p-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                )}
              >
                <tab.icon className="size-3.5" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {activeTab === 'chat' && <GodmodeChatTab />}
        {activeTab === 'race' && <RaceTab />}
        {activeTab === 'synthesize' && <SynthesizeTab />}
      </div>

      {/* Pipeline settings sidebar */}
      <div className="hidden w-72 shrink-0 overflow-y-auto border-l border-border bg-surface-1/50 p-3 lg:block">
        <PipelineSettings />
      </div>
    </div>
  );
}
