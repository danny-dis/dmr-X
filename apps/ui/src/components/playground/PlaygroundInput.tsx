import * as React from 'react';
import { usePlaygroundStore, PlaygroundMode } from '@/store/usePlaygroundStore';
import { Button } from '@/components/primitives/Button';
import { Textarea } from '@/components/primitives/Textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Slider } from '@/components/primitives/Slider';
import { Switch } from '@/components/primitives/Switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { Badge } from '@/components/primitives/Badge';
import { Send, Settings2, MessageSquare, Image, Volume2, ArrowUpDown, Zap, ShieldAlert, Square, Cpu, Workflow, Wrench, X, Coins } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import type { ApiModel } from '@/types/api';
import { Admin } from '@/lib/admin';

const modeOptions = [
  { value: 'chat', label: 'Chat', icon: MessageSquare },
  { value: 'image', label: 'Image', icon: Image },
  { value: 'embed', label: 'Embed', icon: ArrowUpDown },
  { value: 'tts', label: 'TTS', icon: Volume2 },
  { value: 'rerank', label: 'Rerank', icon: Zap },
  { value: 'moderate', label: 'Moderate', icon: ShieldAlert },
  // SSE-streaming modes. `agentic` posts to /v1/agentic/chat (multi-turn
  // tool-calling loop) and `tool-loop` posts to /v1/tools/loop (multi-turn
  // tool-execution loop). Both render an event trace under the response.
  { value: 'agentic', label: 'Agentic', icon: Cpu },
  { value: 'tool-loop', label: 'Tool loop', icon: Workflow },
];

export function PlaygroundInput() {
  const {
    mode,
    model,
    config,
    costFilter,
    isTemporary,
    isStreaming,
    setMode,
    setModel,
    setCostFilter,
    setConfig,
    setTools,
    toggleTemporary,
    sendMessage,
    cancelStreaming,
    consumePromptSeed,
    pendingPrompt,
  } = usePlaygroundStore();

  const [prompt, setPrompt] = React.useState('');
  const [showConfig, setShowConfig] = React.useState(false);
  // Tools panel collapsed by default — most users won't need it for
  // regular chat. Once expanded we keep it open for the session.
  const [showTools, setShowTools] = React.useState(false);

  // Ref onto the prompt textarea so we can focus it after the empty-state
  // sample tiles (or any other consumer) seed a prompt via the store.
  const promptRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Drain the `pendingPrompt` slot into the local textarea. Runs on mount
  // and whenever the store value changes (e.g. a sample-tile click while
  // the input is mounted). The store's `consumePromptSeed` returns the
  // value and clears it, so the same prompt can't be re-applied by a
  // re-render.
  React.useEffect(() => {
    if (!pendingPrompt) return;
    setPrompt(pendingPrompt);
    consumePromptSeed();
    // Focus the textarea on the next tick so the just-rendered value is
    // committed. Also place the caret at the end so the user can extend
    // the seeded prompt without losing their place.
    requestAnimationFrame(() => {
      const el = promptRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = el.value.length;
      }
    });
    // We intentionally exclude `consumePromptSeed` from deps — it's a
    // stable store action and the effect should fire only when
    // `pendingPrompt` actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  // Tools picker state. The textarea is the source of truth for editing;
  // the store's `config.tools` only gets updated when the content parses
  // as a JSON array. We seed the textarea from the store on first render
  // and whenever the store value diverges from what the user has typed
  // (e.g. after `clear` or a hydration).
  const [toolsText, setToolsText] = React.useState(() =>
    config.tools.length > 0 ? JSON.stringify(config.tools, null, 2) : ''
  );
  const [toolsError, setToolsError] = React.useState<string | null>(null);

  // Parse the textarea on every change. On valid JSON-array input, push
  // the parsed array into the store; on bad input, surface a small error
  // and leave the previous store value intact. We stringify before
  // comparing so a user editing whitespace doesn't churn the store.
  React.useEffect(() => {
    const trimmed = toolsText.trim();
    if (!trimmed) {
      // Empty string clears the tools list.
      if (config.tools.length > 0) setTools([]);
      setToolsError(null);
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        setToolsError('Tools must be a JSON array');
        return;
      }
      setToolsError(null);
      // Only update if the parsed value actually changed.
      if (JSON.stringify(parsed) !== JSON.stringify(config.tools)) {
        setTools(parsed);
      }
    } catch (e: any) {
      setToolsError(e?.message ? `Invalid JSON: ${e.message}` : 'Invalid JSON');
    }
    // We intentionally exclude `config.tools` from deps — comparing inside
    // the effect is enough to avoid an update loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolsText]);

  const clearTools = () => {
    setToolsText('');
    setTools([]);
    setToolsError(null);
  };

  // Fetch models
  const models = useApiData<ApiModel[]>(() => Admin.listModels(), [], { refetchInterval: 60000 });
  
  const filteredModels = React.useMemo(() => {
    const all = models.data ?? [];
    switch (mode) {
      case 'image': return all.filter(m => m.modality === 'diffusion');
      case 'embed': return all.filter(m => m.modality === 'embedding');
      case 'tts': return all.filter(m => m.modality === 'audio_tts');
      case 'rerank': return all.filter(m => m.modality === 'reranking');
      default: return all.filter(m => m.modality === 'llm');
    }
  }, [models.data, mode]);
  
  const handleSend = async () => {
    if (!prompt.trim() || isStreaming) return;
    
    const message = prompt;
    setPrompt('');
    
    try {
      await sendMessage(message);
    } catch (error) {
      console.error('Failed to send message:', error);
      toast.error('Failed to send message');
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  
  return (
    <div className="border-t border-border bg-surface-1 p-4">
      <div className="max-w-[800px] mx-auto">
        {/* Mode Tabs */}
        <div className="flex justify-center mb-3">
          <Tabs value={mode} onValueChange={(v) => setMode(v as PlaygroundMode)}>
            <TabsList variant="pills">
              {modeOptions.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  <option.icon className="size-3" />
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        
        {/* Config Row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {/* Model Selector */}
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (best model)</SelectItem>
                <SelectItem value="auto-fast">Auto-Fast</SelectItem>
                <SelectItem value="auto-smart">Auto-Smart</SelectItem>
                <SelectItem value="auto-agentic">Auto-Agentic</SelectItem>
                <SelectItem value="auto-coding">Auto-Coding</SelectItem>
                {filteredModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} <span className="text-fg-subtle ml-1">· {m.provider}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {/* Config Toggle */}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowConfig(!showConfig)}
            >
              <Settings2 className="size-4" />
            </Button>

            {/* Cost Filter Toggle — only visible for meta-model aliases */}
            {model.startsWith('auto') && (
              <div className="flex items-center gap-1 rounded-md border border-border bg-surface-2 p-0.5">
                <button
                  type="button"
                  onClick={() => setCostFilter('all')}
                  className={cn(
                    'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                    costFilter === 'all' ? 'bg-primary text-primary-foreground' : 'text-fg-muted hover:text-fg'
                  )}
                  title="Route through all providers (paid + free)"
                >
                  <Coins className="size-2.5" />
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setCostFilter('free')}
                  className={cn(
                    'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                    costFilter === 'free' ? 'bg-primary text-primary-foreground' : 'text-fg-muted hover:text-fg'
                  )}
                  title="Route through free providers only (zero-cost)"
                >
                  Free
                </button>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {/* Temporary Toggle */}
            <div className="flex items-center gap-2">
              <Switch
                id="temporary"
                checked={isTemporary}
                onCheckedChange={toggleTemporary}
              />
              <label htmlFor="temporary" className="text-xs text-fg-muted cursor-pointer">
                Temporary
              </label>
            </div>
          </div>
        </div>
        
        {/* Config Panel */}
        {showConfig && (
          <div className="mb-3 p-3 bg-surface-2 rounded-lg border border-border space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-fg-muted">Temperature</span>
                  <span className="font-mono">{config.temperature}</span>
                </div>
                <Slider
                  value={[config.temperature]}
                  onValueChange={(v) => setConfig({ temperature: v[0] })}
                  max={2}
                  step={0.1}
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-muted">Stream response</span>
                <Switch
                  checked={config.stream}
                  onCheckedChange={(v) => setConfig({ stream: v })}
                />
              </div>
            </div>

            {/* Tools picker. The user pastes an OpenAI-format `tools`
                array as JSON; we parse + validate and push it into the
                store. `tool-loop` mode requires at least one tool
                server-side (Zod `min(1)`), so the indicator below the
                textarea doubles as a visual gate for that mode. */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <button
                  type="button"
                  onClick={() => setShowTools((v) => !v)}
                  className="flex items-center gap-2 text-xs text-fg-muted hover:text-fg transition-colors"
                  aria-expanded={showTools}
                >
                  <Wrench className="size-3" />
                  <span>Tools</span>
                  <Badge tone={config.tools.length > 0 ? 'primary' : 'muted'} size="sm">
                    {config.tools.length}
                  </Badge>
                </button>
                {config.tools.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={clearTools}
                    aria-label="Clear tools"
                    title="Clear tools"
                  >
                    <X className="size-3" />
                  </Button>
                )}
              </div>

              {showTools && (
                <div className="space-y-1.5">
                  <Textarea
                    value={toolsText}
                    onChange={(e) => setToolsText(e.target.value)}
                    rows={7}
                    spellCheck={false}
                    placeholder={`[\n  {\n    "type": "function",\n    "function": {\n      "name": "web_search",\n      "description": "Search the web",\n      "parameters": {\n        "type": "object",\n        "properties": { "query": { "type": "string" } },\n        "required": ["query"]\n      }\n    }\n  }\n]`}
                    className="font-mono text-xs"
                    invalid={!!toolsError}
                  />
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-fg-subtle">
                      {config.tools.length} tool{config.tools.length === 1 ? '' : 's'} defined
                    </span>
                    {toolsError && (
                      <span className="text-danger">{toolsError}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Input */}
        <div className="relative">
          <Textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Send a ${mode} message...`}
            className="min-h-[60px] max-h-[200px] pr-24 resize-none"
            disabled={isStreaming}
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-2">
            {isStreaming ? (
              <Button
                variant="outline"
                size="sm"
                onClick={cancelStreaming}
              >
                <Square className="size-3" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleSend}
                disabled={!prompt.trim()}
              >
                <Send className="size-3" />
                Send
              </Button>
            )}
          </div>
        </div>
        
        <p className="text-[10px] text-fg-subtle text-center mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}