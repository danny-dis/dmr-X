import { Send, Settings2, MessageSquare, Square, Cpu, Wrench, X, Coins, Search, Clock, ChevronDown, Check, Sparkles, Bot } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router';

import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Slider } from '@/components/primitives/Slider';
import { Switch } from '@/components/primitives/Switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { Textarea } from '@/components/primitives/Textarea';
import { toast } from '@/components/primitives/Toast';
import { useAgentInstances } from '@/lib/queries/agents';
import { useModels } from '@/lib/queries/models';
import { cn } from '@/lib/utils';
import { usePlaygroundStore } from '@/store/usePlaygroundStore';
import type { ApiModel } from '@/types/api';
import { GodmodePanel } from './GodmodePanel';
import { PromptLibrary } from './PromptLibrary';
import { GenerateButtons } from './GenerateButtons';
import { ImportButton, type ImportedFile } from './ImportButton';

// The four modes that behave like a chat transcript and are reachable
// through the URL (`/playground/:mode`) — one tab each. `tool-loop` and the
// one-shot generator modes (image/embed/tts/rerank/moderate) exist in
// `PlaygroundMode` for API/back-compat reasons but have no tab here.
const MODE_TABS: ReadonlyArray<{ value: 'chat' | 'agent' | 'godmode' | 'agentic'; label: string; icon: typeof MessageSquare }> = [
  { value: 'chat', label: 'Chat', icon: MessageSquare },
  { value: 'agent', label: 'Agent', icon: Bot },
  { value: 'godmode', label: 'Godmode', icon: Sparkles },
  { value: 'agentic', label: 'Agentic', icon: Cpu },
];

export function PlaygroundInput() {
  const navigate = useNavigate();
  const mode = usePlaygroundStore(s => s.mode);
  const model = usePlaygroundStore(s => s.model);
  const config = usePlaygroundStore(s => s.config);
  const costFilter = usePlaygroundStore(s => s.costFilter);
  const isTemporary = usePlaygroundStore(s => s.isTemporary);
  const isStreaming = usePlaygroundStore(s => s.isStreaming);
  const agentInstanceId = usePlaygroundStore(s => s.agentInstanceId);
  const setModel = usePlaygroundStore(s => s.setModel);
  const setCostFilter = usePlaygroundStore(s => s.setCostFilter);
  const setConfig = usePlaygroundStore(s => s.setConfig);
  const setTools = usePlaygroundStore(s => s.setTools);
  const setAgentInstanceId = usePlaygroundStore(s => s.setAgentInstanceId);
  const toggleTemporary = usePlaygroundStore(s => s.toggleTemporary);
  const sendMessage = usePlaygroundStore(s => s.sendMessage);
  const cancelStreaming = usePlaygroundStore(s => s.cancelStreaming);
  const consumePromptSeed = usePlaygroundStore(s => s.consumePromptSeed);
  const pendingPrompt = usePlaygroundStore(s => s.pendingPrompt);

  // Mode lives in the URL (`/playground/:mode`) so a conversation in
  // agent/godmode/agentic can be linked to directly. `PlaygroundPage` reads
  // the route param and syncs it into the store; clicking a tab here just
  // navigates — the store update happens via that same sync effect, so the
  // URL is always the source of truth rather than two places disagreeing.
  const handleModeChange = (next: string) => {
    if (next === mode) return;
    const suffix = next === 'agent' && agentInstanceId ? `?instance=${agentInstanceId}` : '';
    navigate(`/playground/${next}${suffix}`);
  };

  // Agent mode's instance picker. Only active instances are dispatch
  // candidates server-side, so those are what a user should be able to pick.
  const agentInstances = useAgentInstances('active');
  const instanceOptions = agentInstances.data?.items ?? [];
  const selectedInstance = instanceOptions.find(i => i.id === agentInstanceId) ?? null;

  const [prompt, setPrompt] = React.useState('');
  const [showConfig, setShowConfig] = React.useState(false);
  // Tools panel collapsed by default — most users won't need it for
  // regular chat. Once expanded we keep it open for the session.
  const [showTools, setShowTools] = React.useState(false);
  const [attachments, setAttachments] = React.useState<ImportedFile[]>([]);

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
    (config.tools ?? []).length > 0 ? JSON.stringify(config.tools, null, 2) : ''
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
      if ((config.tools ?? []).length > 0) setTools([]);
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

  // Fetch only available models (from providers with active keys or keyless providers).
  // The backend filters by provider key status when available_only=true (default).
  const models = useModels({ available_only: 'true' }, { refetchInterval: 30000 });
  
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

  // Group models by provider for better UX
  const groupedModels = React.useMemo(() => {
    const groups = new Map<string, ApiModel[]>();
    for (const m of filteredModels) {
      const provider = m.provider || m.provider_name || 'unknown';
      if (!groups.has(provider)) groups.set(provider, []);
      groups.get(provider)!.push(m);
    }
    return groups;
  }, [filteredModels]);

  // Model selector search + recent models
  const [modelSearch, setModelSearch] = React.useState('');
  const [showModelDropdown, setShowModelDropdown] = React.useState(false);
  const modelDropdownRef = React.useRef<HTMLDivElement>(null);
  const modelSearchRef = React.useRef<HTMLInputElement>(null);

  // Track recent model selections (persisted to localStorage)
  const [recentModels, setRecentModels] = React.useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('dmrx-recent-models') ?? '[]'); } catch { return []; }
  });

  const addRecentModel = React.useCallback((modelId: string) => {
    setRecentModels(prev => {
      const next = [modelId, ...prev.filter(m => m !== modelId)].slice(0, 5);
      try { localStorage.setItem('dmrx-recent-models', JSON.stringify(next)); } catch { /* private browsing — ignore */ }
      return next;
    });
  }, []);

  // Filter models by search query
  const modelSearchLower = modelSearch.toLowerCase();
  const searchFilteredModels = React.useMemo(() => {
    if (!modelSearchLower) return filteredModels;
    return filteredModels.filter(m =>
      (m.name || m.model_id || '').toLowerCase().includes(modelSearchLower) ||
      (m.provider || m.provider_name || '').toLowerCase().includes(modelSearchLower) ||
      (m.display_name || '').toLowerCase().includes(modelSearchLower)
    );
  }, [filteredModels, modelSearchLower]);

  const searchGroupedModels = React.useMemo(() => {
    const groups = new Map<string, ApiModel[]>();
    for (const m of searchFilteredModels) {
      const provider = m.provider || m.provider_name || 'unknown';
      if (!groups.has(provider)) groups.set(provider, []);
      groups.get(provider)!.push(m);
    }
    return groups;
  }, [searchFilteredModels]);

  // Recent model objects
  const recentModelObjects = React.useMemo(() => {
    return recentModels
      .map(id => filteredModels.find(m => (m.model_id || m.id) === id))
      .filter(Boolean) as ApiModel[];
  }, [recentModels, filteredModels]);

  // Close dropdown on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    if (showModelDropdown) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModelDropdown]);

  // Focus search input when dropdown opens
  React.useEffect(() => {
    if (showModelDropdown) {
      requestAnimationFrame(() => modelSearchRef.current?.focus());
    }
  }, [showModelDropdown]);

  const selectModel = (modelId: string) => {
    setModel(modelId);
    addRecentModel(modelId);
    setShowModelDropdown(false);
    setModelSearch('');
  };

  // Meta model labels
  const META_MODELS = [
    { id: 'auto', label: 'Auto (best model)' },
    { id: 'auto-fast', label: 'Auto-Fast' },
    { id: 'auto-smart', label: 'Auto-Smart' },
    { id: 'auto-agentic', label: 'Auto-Agentic' },
    { id: 'auto-coding', label: 'Auto-Coding' },
  ];

  const filteredMetaModels = META_MODELS.filter(m =>
    !modelSearchLower || m.label.toLowerCase().includes(modelSearchLower)
  );

  // Current model display name
  const currentModelLabel = React.useMemo(() => {
    if (model.startsWith('auto')) {
      return META_MODELS.find(m => m.id === model)?.label ?? model;
    }
    const found = filteredModels.find(m => (m.model_id || m.id) === model);
    return found ? (found.display_name || found.name || found.model_id) : model;
  }, [model, filteredModels]);
  
  const handleSend = async () => {
    if (!prompt.trim() || isStreaming) return;

    if (mode === 'agent' && !agentInstanceId) {
      toast.error('Select an agent instance before sending a message.');
      return;
    }

    const message = prompt;
    setPrompt('');
    setAttachments([]);

    try {
      await sendMessage(message);
    } catch (error) {
      console.error('Failed to send message:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send message');
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  
  return (
    <div className="shrink-0 border-t border-border bg-surface-1/95 p-3 shadow-[0_-10px_30px_-24px_rgba(15,23,42,0.45)] backdrop-blur sm:p-4">
      <div className="mx-auto w-full max-w-[960px]">
        {/* Mode Tabs — Chat / Agent / Godmode / Agentic. Switching tabs
            navigates so the URL (`/playground/:mode`) stays the source of
            truth; `PlaygroundPage` syncs the route param back into the
            store's `mode`. */}
        <div className="mb-3">
          <Tabs value={mode} onValueChange={handleModeChange}>
            <TabsList variant="pills">
              {MODE_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="flex items-center gap-1.5"
                >
                  <tab.icon className="size-3.5" />
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {/* Config Row */}
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {/* Agent Instance Selector — replaces the model combobox in
                agent mode, since the instance (not a free model choice)
                determines what runs. */}
            {mode === 'agent' && (
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 w-[min(100vw-4.5rem,280px)] sm:w-[280px]">
                  <Select
                    value={agentInstanceId ?? undefined}
                    onValueChange={(v) => setAgentInstanceId(v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={agentInstances.isLoading ? 'Loading instances…' : 'Select an agent instance…'} />
                    </SelectTrigger>
                    <SelectContent>
                      {instanceOptions.length === 0 ? (
                        <div className="px-2 py-4 text-center text-xs text-fg-subtle">
                          {agentInstances.isLoading ? 'Loading…' : 'No active agent instances. Deploy one from the Agents page.'}
                        </div>
                      ) : (
                        instanceOptions.map((instance) => (
                          <SelectItem key={instance.id} value={instance.id}>
                            {instance.definitionHumanName || instance.definitionName || instance.id}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {selectedInstance && (
                  <Badge
                    tone={selectedInstance.status === 'active' ? 'success' : 'muted'}
                    size="sm"
                    variant="soft"
                    className="shrink-0"
                  >
                    {selectedInstance.status}
                  </Badge>
                )}
              </div>
            )}

            {/* Model Selector Combobox */}
            {mode !== 'agent' && (
            <div className="relative min-w-0" ref={modelDropdownRef}>
              <button
                type="button"
                onClick={() => setShowModelDropdown(!showModelDropdown)}
                className="flex h-9 w-[min(100vw-2rem,320px)] items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg outline-none transition-colors hover:border-border-strong focus:border-primary/40 focus:ring-2 focus:ring-primary/20 sm:w-[320px]"
              >
                <span className="truncate">{currentModelLabel}</span>
                <ChevronDown className={cn("size-3.5 text-fg-muted shrink-0 transition-transform", showModelDropdown && "rotate-180")} />
              </button>

              {showModelDropdown && (
                <div className="absolute left-0 top-full z-50 mt-1 max-h-[400px] w-[min(100vw-2rem,360px)] overflow-hidden rounded-lg border border-border bg-surface-1 shadow-2xl">
                  {/* Search input */}
                  <div className="p-2 border-b border-border">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-fg-muted" />
                      <input
                        ref={modelSearchRef}
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder="Search models…"
                        className="w-full h-8 pl-8 pr-3 rounded-md border border-border bg-surface-2 text-xs text-fg outline-none focus:border-primary/40"
                      />
                    </div>
                  </div>

                  {/* Scrollable list */}
                  <div className="max-h-[340px] overflow-y-auto p-1">
                    {/* Meta models */}
                    {filteredMetaModels.length > 0 && (
                      <div className="mb-1">
                        <div className="px-2 py-1 text-[10px] font-semibold text-fg-subtle uppercase tracking-wider">
                          Routing
                        </div>
                        {filteredMetaModels.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => selectModel(m.id)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-left transition-colors',
                              model === m.id ? 'bg-primary/10 text-primary' : 'text-fg-muted hover:bg-surface-2'
                            )}
                          >
                            <span className="truncate">{m.label}</span>
                            {model === m.id && <Check className="size-3 ml-auto shrink-0 text-primary" />}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Recent models */}
                    {!modelSearch && recentModelObjects.length > 0 && (
                      <div className="mb-1">
                        <div className="px-2 py-1 text-[10px] font-semibold text-fg-subtle uppercase tracking-wider flex items-center gap-1">
                          <Clock className="size-3" />
                          Recent
                        </div>
                        {recentModelObjects.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => selectModel(m.model_id || m.id)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-left transition-colors',
                              model === (m.model_id || m.id) ? 'bg-primary/10 text-primary' : 'text-fg-muted hover:bg-surface-2'
                            )}
                          >
                            <span className="truncate font-mono">{m.display_name || m.name || m.model_id}</span>
                            <span className="text-[10px] text-fg-subtle ml-auto shrink-0">{m.provider}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Provider groups */}
                    {Array.from(searchGroupedModels.entries()).map(([provider, providerModels]) => (
                      <div key={provider} className="mb-1">
                        <div className="px-2 py-1 text-[10px] font-semibold text-fg-subtle uppercase tracking-wider">
                          {provider}
                        </div>
                        {providerModels.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => selectModel(m.model_id || m.id)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-left transition-colors',
                              model === (m.model_id || m.id) ? 'bg-primary/10 text-primary' : 'text-fg-muted hover:bg-surface-2'
                            )}
                          >
                            <span className="truncate font-mono">{m.display_name || m.name || m.model_id}</span>
                            {model === (m.model_id || m.id) && <Check className="size-3 ml-auto shrink-0 text-primary" />}
                          </button>
                        ))}
                      </div>
                    ))}

                    {/* Empty state */}
                    {searchGroupedModels.size === 0 && filteredMetaModels.length === 0 && (
                      <div className="px-2 py-4 text-center text-xs text-fg-subtle">
                        {modelSearch ? 'No models match your search' : 'No models available. Add a provider key to get started.'}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Config Toggle */}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowConfig(!showConfig)}
            >
              <Settings2 className="size-4" />
            </Button>

            {/* Cost Filter Toggle — promoted to always-available. Previously
                gated on `model.startsWith('auto')`, so it vanished the moment
                a user picked a concrete model even though `x-cost-filter`
                is honored server-side regardless of model choice. */}
            {mode !== 'agent' && (
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
        
        {/* Auxiliary panels (settings, godmode pipeline, prompt library).
            Scrolls on its own instead of growing the composer without bound:
            this whole bar is `shrink-0` inside a `100dvh` `overflow-hidden`
            column, so an expanded panel used to push the prompt textarea off
            the bottom of the viewport — in godmode mode there was visibly
            nowhere left to type. The input below stays outside this container
            and is therefore always reachable. */}
        <div className="max-h-[38vh] overflow-y-auto overscroll-contain">
        {/* Config Panel */}
        {showConfig && (
          <div className="mb-3 space-y-4 rounded-lg border border-border bg-surface-2 p-3">
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

            {/* Agent-mode run limits — enforced server-side by
                AgentChatRequestSchema (maxSteps 1-50, max_cost_budget > 0). */}
            {mode === 'agent' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-fg-muted">Max steps</span>
                    <span className="font-mono">{config.maxSteps ?? 10}</span>
                  </div>
                  <Slider
                    value={[config.maxSteps ?? 10]}
                    onValueChange={(v) => setConfig({ maxSteps: v[0] })}
                    min={1}
                    max={50}
                    step={1}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-fg-muted">Max cost budget</span>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-1 px-2 h-7">
                    <span className="text-xs text-fg-subtle">$</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={config.maxCostBudget ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setConfig({ maxCostBudget: v === '' ? undefined : Math.max(0, Number(v)) });
                      }}
                      placeholder="No limit"
                      className="w-full bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Tools picker. The user pastes an OpenAI-format `tools`
                array as JSON; we parse + validate and push it into the
                store. `tool-loop` mode requires at least one tool
                server-side (Zod `min(1)`), so the indicator below the
                textarea doubles as a visual gate for that mode. Hidden in
                agent mode — an agent instance's tools come from its
                `allowedTools` server-side, not a client-supplied list. */}
            {mode !== 'agent' && (
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
                  {/* Preset tool templates */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <span className="text-[10px] text-fg-subtle self-center mr-1">Presets:</span>
                    {[
                      {
                        label: 'Web Search',
                        tool: { type: 'function', function: { name: 'web_search', description: 'Search the web for information', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } } },
                      },
                      {
                        label: 'Calculator',
                        tool: { type: 'function', function: { name: 'calculate', description: 'Perform a mathematical calculation', parameters: { type: 'object', properties: { expression: { type: 'string', description: 'Math expression to evaluate' } }, required: ['expression'] } } },
                      },
                      {
                        label: 'Get Weather',
                        tool: { type: 'function', function: { name: 'get_weather', description: 'Get current weather for a location', parameters: { type: 'object', properties: { location: { type: 'string', description: 'City name' }, units: { type: 'string', enum: ['celsius', 'fahrenheit'], description: 'Temperature units' } }, required: ['location'] } } },
                      },
                      {
                        label: 'Run Code',
                        tool: { type: 'function', function: { name: 'run_code', description: 'Execute code in a sandbox', parameters: { type: 'object', properties: { language: { type: 'string', enum: ['python', 'javascript', 'typescript'], description: 'Programming language' }, code: { type: 'string', description: 'Code to execute' } }, required: ['language', 'code'] } } },
                      },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          const current = toolsText.trim() ? JSON.parse(toolsText) : [];
                          if (!Array.isArray(current)) return;
                          const updated = [...current, preset.tool];
                          setToolsText(JSON.stringify(updated, null, 2));
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-[10px] font-medium text-fg-muted hover:border-primary/30 hover:text-primary transition-colors"
                      >
                        <Wrench className="size-2.5" />
                        {preset.label}
                      </button>
                    ))}
                  </div>
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
            )}
          </div>
        )}

        {/* Godmode Settings & Prompt Library — shown when in godmode mode */}
        {mode === 'godmode' && (
          <div className="mb-3 space-y-3">
            <GodmodePanel
              config={config.godmode ?? {
                autotune: true,
                parseltongue: true,
                parseltongueTechnique: 'leetspeak',
                parseltongueIntensity: 'medium',
                stmModules: ['hedge_reducer', 'direct_mode'],
              }}
              onChange={(g) => setConfig({ godmode: { ...config.godmode, ...g } as any })}
            />
            <PromptLibrary onSelectPrompt={(prompt) => setPrompt(prompt)} />
          </div>
        )}
        </div>
        
        {/* Input */}
        <div className="relative rounded-xl border border-border bg-surface-2 p-2 shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15">
          <Textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === 'agent'
                ? (agentInstanceId ? 'Send a message to the agent...' : 'Select an agent instance above to start...')
                : `Send a ${mode} message...`
            }
            className="min-h-[68px] max-h-[220px] resize-none border-0 bg-transparent pr-28 shadow-none focus:ring-0"
            disabled={isStreaming}
          />
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            <ImportButton onAttach={(file) => setAttachments(prev => [...prev, file])} />
            {(mode === 'chat' || mode === 'image') && <GenerateButtons />}
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
                disabled={!prompt.trim() || (mode === 'agent' && !agentInstanceId)}
              >
                <Send className="size-3" />
                Send
              </Button>
            )}
          </div>
        </div>
        
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {attachments.map((file, idx) => (
              <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-surface-2 border border-border">
                <span className="truncate max-w-[120px]">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
                  className="text-fg-muted hover:text-fg"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        
        <p className="text-[10px] text-fg-subtle text-center mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
