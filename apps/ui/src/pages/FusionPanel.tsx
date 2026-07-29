import { Layers, Plus, Trash2, GripVertical, Zap, Server, ArrowUpDown, RefreshCw, Settings } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Switch } from '@/components/primitives/Switch';
import { StatTile } from '@/components/primitives/StatTile';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin, FusionPanel as FusionPanelApi } from '@/lib/admin';
import { fetchAuthenticated } from '@/lib/api';
import type { ApiFusionPanel } from '@/lib/admin';
import { cn } from '@/lib/utils';
import type { ApiProvider, ApiCatalogEntry } from '@/types/api';

// G0DM0D3 components
import { FusionModeSelector, type FusionMode } from '@/components/fusion/FusionModeSelector';
import { RaceResults, type RaceRanking } from '@/components/fusion/RaceResults';
import { SynthesisPanel, type ConsortiumResult } from '@/components/fusion/SynthesisPanel';
import { GodmodeSettings, type GodmodeConfig } from '@/components/fusion/GodmodeSettings';
import { GodmodeClassicPanel, LearningStats } from '@/components/fusion';

export function FusionPanelPage() {
  const [panels, setPanels] = React.useState<ApiFusionPanel[]>([]);
  const [activePanelId, setActivePanelId] = React.useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = React.useState<string>('');
  const [selectedModel, setSelectedModel] = React.useState<string>('');
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);

  // G0DM0D3 state
  const [fusionMode, setFusionMode] = React.useState<FusionMode>('parallel');
  const [streamLiquid, setStreamLiquid] = React.useState(false);
  const [godmodeConfig, setGodmodeConfig] = React.useState<GodmodeConfig>({
    autotune: true,
    parseltongue: true,
    parseltongueTechnique: 'leetspeak',
    parseltongueIntensity: 'medium',
    stmModules: ['hedge_reducer', 'direct_mode'],
    tier: 'fast',
  });
  const [ultraplinianResults, setUltraplinianResults] = React.useState<{
    rankings: RaceRanking[];
    winner?: { model: string; score: number; duration_ms: number };
    tier: string;
    modelsQueried: number;
    modelsSucceeded: number;
    totalDurationMs: number;
    synthesis?: string;
  } | null>(null);
  // GodmodeSettings reports partial patches (e.g. `{ tier: value }`), not a
  // full replacement config. Passing `setGodmodeConfig` directly would drop
  // every field not present in the patch on the very next change.
  const handleGodmodeConfigChange = React.useCallback(
    (patch: Partial<GodmodeConfig>) =>
      setGodmodeConfig((prev) => ({ ...prev, ...patch })),
    [],
  );
  const [consortiumResults, setConsortiumResults] = React.useState<ConsortiumResult | null>(null);
  const [isRunningGodmode, setIsRunningGodmode] = React.useState(false);
  const [godmodePrompt, setGodmodePrompt] = React.useState('');
  const [liveText, setLiveText] = React.useState<string | null>(null);

  const providers = useApiData<ApiProvider[]>(() => Admin.listProviders(), [], { refetchInterval: 30000 });
  const catalog = useApiData<{ entries: ApiCatalogEntry[] }>(
    () => Admin.getCatalog(),
    [],
    { refetchInterval: 60000 }
  );

  const catalogEntries = catalog.data?.entries ?? [];
  const enabledProviders = (providers.data ?? []).filter(p => p.enabled);

  const availableModels = React.useMemo(() => {
    if (!selectedProvider) return [];
    const provider = enabledProviders.find(p => p.id === selectedProvider);
    if (!provider) return [];
    return provider.models ?? [];
  }, [selectedProvider, enabledProviders]);

  // Load panels on mount
  const loadPanels = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await FusionPanelApi.list();
      setPanels(data);
      // Auto-select first panel if none selected
      if (!activePanelId && data.length > 0) {
        setActivePanelId(data[0]!.id);
      }
    } catch (_err) {
      toast.error('Failed to load fusion panels');
    } finally {
      setIsLoading(false);
    }
  }, [activePanelId]);

  React.useEffect(() => {
    loadPanels();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activePanel = panels.find(p => p.id === activePanelId) ?? null;
  const slots = activePanel?.slots ?? [];

  const createPanel = async () => {
    const name = `Fusion Panel ${panels.length + 1}`;
    try {
      const newPanel = await FusionPanelApi.create({ name });
      setPanels(prev => [newPanel, ...prev]);
      setActivePanelId(newPanel.id);
      toast.success(`Created "${name}"`);
    } catch (_err) {
      toast.error('Failed to create panel');
    }
  };

  const deletePanel = async (id: string) => {
    try {
      await FusionPanelApi.delete(id);
      setPanels(prev => prev.filter(p => p.id !== id));
      if (activePanelId === id) {
        setActivePanelId(panels.find(p => p.id !== id)?.id ?? null);
      }
      toast.success('Panel deleted');
    } catch (_err) {
      toast.error('Failed to delete panel');
    }
  };

  const addSlot = async () => {
    if (!activePanelId || !selectedProvider || !selectedModel) {
      toast.error('Select a provider and model');
      return;
    }
    const provider = enabledProviders.find(p => p.id === selectedProvider);
    const model = provider?.models?.find(m => m.id === selectedModel);
    if (!provider || !model) return;

    try {
      const newSlot = await FusionPanelApi.addSlot(activePanelId, {
        provider_id: provider.name,
        model_id: model.id,
        display_name: `${provider.name} / ${model.id}`,
      });

      setPanels(prev => prev.map(p => {
        if (p.id !== activePanelId) return p;
        return { ...p, slots: [...p.slots, newSlot] };
      }));

      setSelectedProvider('');
      setSelectedModel('');
      toast.success(`Added ${newSlot.display_name}`);
    } catch (_err) {
      toast.error('Failed to add slot');
    }
  };

  const removeSlot = async (slotId: string) => {
    if (!activePanelId) return;
    try {
      await FusionPanelApi.removeSlot(activePanelId, slotId);
      setPanels(prev => prev.map(p => {
        if (p.id !== activePanelId) return p;
        return { ...p, slots: p.slots.filter(s => s.id !== slotId) };
      }));
      toast.success('Slot removed');
    } catch (_err) {
      toast.error('Failed to remove slot');
    }
  };

  const moveSlot = async (slotId: string, direction: 'up' | 'down') => {
    if (!activePanelId) return;
    const currentSlots = [...slots];
    const idx = currentSlots.findIndex(s => s.id === slotId);
    if (idx < 0) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= currentSlots.length) return;

    // Swap
    [currentSlots[idx], currentSlots[newIdx]] = [currentSlots[newIdx]!, currentSlots[idx]!];

    try {
      await FusionPanelApi.reorderSlots(activePanelId, currentSlots.map(s => s.id));
      setPanels(prev => prev.map(p => {
        if (p.id !== activePanelId) return p;
        return { ...p, slots: currentSlots };
      }));
    } catch (_err) {
      toast.error('Failed to reorder slots');
    }
  };

  const toggleSlot = async (slotId: string) => {
    if (!activePanelId) return;
    const slot = slots.find(s => s.id === slotId);
    if (!slot) return;
    try {
      // Use update to toggle is_enabled
      const updatedSlots = slots.map(s =>
        s.id === slotId ? { ...s, is_enabled: s.is_enabled ? 0 : 1 } : s
      );
      await FusionPanelApi.update(activePanelId, { slots: updatedSlots });
      setPanels(prev => prev.map(p => {
        if (p.id !== activePanelId) return p;
        return { ...p, slots: updatedSlots };
      }));
    } catch (_err) {
      toast.error('Failed to toggle slot');
    }
  };

  const togglePanel = async (panelId: string) => {
    const panel = panels.find(p => p.id === panelId);
    if (!panel) return;
    try {
      const updated = await FusionPanelApi.update(panelId, { is_active: panel.is_active ? 0 : 1 });
      setPanels(prev => prev.map(p => p.id === panelId ? updated : p));
    } catch (_err) {
      toast.error('Failed to toggle panel');
    }
  };

  // Parse an SSE stream: yield { event, data } per event block.
  const parseSseStream = async function* (
    body: ReadableStream<Uint8Array>
  ): AsyncGenerator<{ event: string; data: unknown }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          let event = 'message';
          let dataStr = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;
          let data: unknown;
          try {
            data = JSON.parse(dataStr);
          } catch {
            data = dataStr;
          }
          yield { event, data };
        }
      }
    } finally {
      reader.releaseLock();
    }
  };

  // G0DM0D3 run functions
  const runGodmode = async () => {
    if (!godmodePrompt.trim() || isRunningGodmode) return;
    setIsRunningGodmode(true);
    setUltraplinianResults(null);
    setConsortiumResults(null);
    setLiveText(null);

    const messages = [{ role: 'user' as const, content: godmodePrompt }];
    const body = {
      messages,
      godmode: true,
      autotune: godmodeConfig.autotune,
      parseltongue: godmodeConfig.parseltongue,
      parseltongue_technique: godmodeConfig.parseltongueTechnique,
      parseltongue_intensity: godmodeConfig.parseltongueIntensity,
      stm_modules: godmodeConfig.stmModules,
      tier: godmodeConfig.tier,
    };

    try {
      if (fusionMode === 'ultraplinian') {
        if (streamLiquid) {
          const res = await fetchAuthenticated('/v1/godmode/ultraplinian', {
            method: 'POST',
            body: JSON.stringify({ ...body, stream: true }),
          });
          let leaderText = '';
          let finalText = '';
          for await (const { event, data } of parseSseStream(res.body!)) {
            if (event === 'race:leader') {
              const d = data as { answer?: string; text?: string };
              leaderText = d.answer ?? d.text ?? leaderText;
              setLiveText(leaderText);
            } else if (event === 'race:complete') {
              const d = data as { polished_answer?: string; final_answer?: string; answer?: string };
              finalText = d.polished_answer ?? d.final_answer ?? d.answer ?? finalText;
              setLiveText(finalText);
            }
          }
          setUltraplinianResults({
            rankings: [],
            tier: godmodeConfig.tier,
            modelsQueried: 0,
            modelsSucceeded: 0,
            totalDurationMs: 0,
            synthesis: finalText || leaderText,
          });
        } else {
          const res = await fetchAuthenticated('/v1/godmode/ultraplinian', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          const data = await res.json();
          // Map snake_case service response -> RaceResults camelCase props.
          setUltraplinianResults({
            rankings: data.race?.rankings ?? data.rankings ?? [],
            winner: data.race?.winner ?? data.winner,
            tier: data.race?.tier ?? data.tier ?? godmodeConfig.tier,
            modelsQueried: (data.race?.models_queried ?? data.models_queried ?? 0) as number,
            modelsSucceeded: (data.race?.models_succeeded ?? data.models_succeeded ?? 0) as number,
            totalDurationMs: (data.race?.total_duration_ms ?? data.total_duration_ms ?? 0) as number,
          });
        }
      } else if (fusionMode === 'consortium') {
        if (streamLiquid) {
          const res = await fetchAuthenticated('/v1/godmode/consortium', {
            method: 'POST',
            body: JSON.stringify({ ...body, stream: true }),
          });
          let deltaText = '';
          let finalText = '';
          for await (const { event, data } of parseSseStream(res.body!)) {
            if (event === 'consortium:synthesis:delta') {
              const d = data as { delta?: string; text?: string };
              deltaText += d.delta ?? d.text ?? '';
              setLiveText(deltaText);
            } else if (event === 'consortium:complete') {
              const d = data as { synthesis?: string; final?: string };
              finalText = d.synthesis ?? d.final ?? finalText;
              setLiveText(finalText || deltaText);
            }
          }
          setConsortiumResults({
            synthesis: finalText || deltaText,
            orchestrator: { model: '', duration_ms: 0 },
            collection: {
              tier: godmodeConfig.tier,
              modelsQueried: 0,
              modelsSucceeded: 0,
              collectionDurationMs: 0,
              totalDurationMs: 0,
              responses: [],
            },
          });
        } else {
          const res = await fetchAuthenticated('/v1/godmode/consortium', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          const data = await res.json();
          // Map snake_case service response -> SynthesisPanel camelCase props.
          const collection = data.collection ?? data;
          setConsortiumResults({
            synthesis: data.synthesis ?? '',
            orchestrator: {
              model: data.orchestrator?.model ?? '',
              duration_ms: data.orchestrator?.duration_ms ?? 0,
            },
            collection: {
              tier: collection?.tier ?? godmodeConfig.tier,
              modelsQueried: (collection?.models_queried ?? 0) as number,
              modelsSucceeded: (collection?.models_succeeded ?? 0) as number,
              collectionDurationMs: (collection?.collection_duration_ms ?? 0) as number,
              totalDurationMs: (collection?.total_duration_ms ?? 0) as number,
              responses: collection?.responses ?? [],
            },
          });
        }
      }
      toast.success(`${fusionMode === 'ultraplinian' ? 'ULTRAPLINIAN' : 'CONSORTIUM'} completed`);
    } catch (_err) {
      toast.error(`Failed to run ${fusionMode}`);
    } finally {
      setIsRunningGodmode(false);
    }
  };

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Fusion Panel"
        description="Pick multiple models for parallel execution with diversity"
        icon={<Layers className="size-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={loadPanels} disabled={isLoading}>
              <RefreshCw className={cn("size-3", isLoading && "animate-spin")} />
            </Button>
            <Button size="sm" onClick={createPanel}>
              <Plus className="size-3" />
              New Panel
            </Button>
          </div>
        }
      />

      {/* Panel selector */}
      {panels.length > 0 && (
        <div className="mt-4 flex items-center gap-3">
          <Select value={activePanelId ?? ''} onValueChange={setActivePanelId}>
            <SelectTrigger className="w-64 h-9">
              <SelectValue placeholder="Select panel…" />
            </SelectTrigger>
            <SelectContent>
              {panels.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} {!p.is_active && '(inactive)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activePanel && (
            <Button
              size="sm"
              variant={activePanel.is_active ? "danger" : "primary"}
              onClick={() => togglePanel(activePanel.id)}
            >
              {activePanel.is_active ? 'Deactivate' : 'Activate'}
            </Button>
          )}
          {activePanel && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => deletePanel(activePanel.id)}
              className="text-danger"
            >
              <Trash2 className="size-3" />
            </Button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="mt-4 space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-48" />
        </div>
      ) : panels.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No fusion panels"
            description="Create a panel to configure multi-model parallel execution."
            action={
              <Button onClick={createPanel}>
                <Plus className="size-3" />
                Create Panel
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile
              label="Slots"
              value={slots.length}
              icon={<Layers className="size-3.5" />}
              hint="models in fusion panel"
            />
            <StatTile
              label="Providers"
              value={new Set(slots.map(s => s.provider_id)).size}
              icon={<Server className="size-3.5" />}
              tone="success"
              hint="unique providers"
            />
            <StatTile
              label="Available"
              value={enabledProviders.length}
              icon={<Zap className="size-3.5" />}
              tone="primary"
              hint="enabled providers"
            />
            <StatTile
              label="Mode"
              value={fusionMode === 'parallel' ? 'Parallel' : fusionMode === 'ultraplinian' ? 'ULTRAPLINIAN' : fusionMode === 'consortium' ? 'CONSORTIUM' : 'CLASSIC'}
              icon={<ArrowUpDown className="size-3.5" />}
              tone="accent"
              hint="execution strategy"
            />
          </div>

          {/* G0DM0D3 Tier Info (when not parallel / classic) */}
          {fusionMode !== 'parallel' && fusionMode !== 'classic' && (
            <div className="mt-4">
              <Card padding="md">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-fg">G0DM0D3 Tier</h3>
                    <p className="text-xs text-fg-muted mt-1">
                      {fusionMode === 'ultraplinian'
                        ? 'Multi-model racing — models compete, best response wins'
                        : 'Hive-mind synthesis — all models contribute, consensus reached'}
                    </p>
                  </div>
                  <Badge tone="primary" size="sm">
                    {fusionMode === 'ultraplinian' ? 'Racing' : 'Synthesis'}
                  </Badge>
                </div>
              </Card>
            </div>
          )}

          {/* G0DM0D3 Mode Selector */}
          <div className="mt-4">
            <Card padding="md">
              <h3 className="text-sm font-semibold text-fg mb-3">Execution Mode</h3>
              <FusionModeSelector
                value={fusionMode}
                onChange={setFusionMode}
                disabled={isRunningGodmode}
              />
            </Card>
          </div>

          {/* G0DM0D3 Settings (visible when not parallel / classic) */}
          {fusionMode !== 'parallel' && fusionMode !== 'classic' && (
            <div className="mt-4">
              <Card padding="md">
                <h3 className="text-sm font-semibold text-fg mb-3 flex items-center gap-2">
                  <Settings className="size-4" />
                  Godmode Settings
                </h3>
                <GodmodeSettings
                  config={godmodeConfig}
                  onChange={handleGodmodeConfigChange}
                  disabled={isRunningGodmode}
                />
              </Card>
            </div>
          )}

          {/* ULTRAPLINIAN Results */}
          {ultraplinianResults && fusionMode === 'ultraplinian' && (
            <div className="mt-4">
              <RaceResults
                rankings={ultraplinianResults.rankings}
                winner={ultraplinianResults.winner}
                tier={ultraplinianResults.tier}
                modelsQueried={ultraplinianResults.modelsQueried}
                modelsSucceeded={ultraplinianResults.modelsSucceeded}
                totalDurationMs={ultraplinianResults.totalDurationMs}
              />
            </div>
          )}

          {/* CONSORTIUM Results */}
          {consortiumResults && fusionMode === 'consortium' && (
            <div className="mt-4">
              <SynthesisPanel
                synthesis={consortiumResults.synthesis}
                orchestrator={consortiumResults.orchestrator}
                collection={consortiumResults.collection}
              />
            </div>
          )}

          {/* GODMODE CLASSIC (L1B3RT4S) */}
          {fusionMode === 'classic' && (
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
              <GodmodeClassicPanel />
              <LearningStats />
            </div>
          )}

          {/* Add Model Slot */}
          {activePanel && (
            <div className="mt-4">
              <Card padding="md">
                <h3 className="text-sm font-semibold text-fg mb-3">Add Model Slot</h3>
                <div className="flex items-center gap-3">
                  <Select value={selectedProvider} onValueChange={(v) => { setSelectedProvider(v); setSelectedModel(''); }}>
                    <SelectTrigger className="w-48 h-9">
                      <SelectValue placeholder="Select provider…" />
                    </SelectTrigger>
                    <SelectContent>
                      {enabledProviders.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={selectedModel} onValueChange={setSelectedModel} disabled={!selectedProvider}>
                    <SelectTrigger className="w-60 h-9" disabled={!selectedProvider}>
                      <SelectValue placeholder="Select model…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={addSlot} disabled={!selectedProvider || !selectedModel}>
                    <Plus className="size-3" />
                    Add Slot
                  </Button>
                </div>
              </Card>
            </div>
          )}

          {/* Configured Slots */}
          {activePanel && (
            <div className="mt-4">
              <Card padding="md">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-fg">Configured Slots</h3>
                  <Badge tone="muted" size="sm">{slots.length} slots</Badge>
                </div>
                {slots.length === 0 ? (
                  <EmptyState
                    title="No slots configured"
                    description="Add models above to create a fusion panel for diverse parallel execution."
                  />
                ) : (
                  <div className="space-y-2">
                    {slots.map((slot, idx) => (
                      <div
                        key={slot.id}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border bg-surface-2/50",
                          slot.is_enabled ? "border-border" : "border-border opacity-50"
                        )}
                      >
                        <GripVertical className="size-4 text-fg-subtle cursor-move" />
                        <div className="flex size-7 shrink-0 items-center justify-center rounded bg-primary/10 text-primary font-mono text-[10px] font-bold">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-fg truncate">{slot.display_name}</p>
                          <p className="text-[10px] text-fg-muted">{slot.provider_id} · {slot.model_id}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => toggleSlot(slot.id)}
                            title={slot.is_enabled ? 'Disable slot' : 'Enable slot'}
                          >
                            {slot.is_enabled ? (
                              <span className="size-2 rounded-full bg-success" aria-label="Enabled" />
                            ) : (
                              <span className="size-2 rounded-full border border-fg-subtle" aria-label="Disabled" />
                            )}
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => moveSlot(slot.id, 'up')}
                            disabled={idx === 0}
                          >
                            ↑
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => moveSlot(slot.id, 'down')}
                            disabled={idx === slots.length - 1}
                          >
                            ↓
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => removeSlot(slot.id)}
                          >
                            <Trash2 className="size-3 text-danger" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* How It Works */}
          <div className="mt-4">
            <Card padding="md">
              <h3 className="text-sm font-semibold text-fg mb-2">How Fusion Panel Works</h3>
              <ul className="text-xs text-fg-muted space-y-1.5">
                <li>• Each slot is hard-pinned to one model — no silent substitution</li>
                <li>• Requests are distributed across slots for diversity</li>
                <li>• If a slot's model is rate-limited, it's skipped (not collapsed onto another)</li>
                <li>• Useful for A/B testing, redundancy, or ensuring model diversity</li>
                <li>• Combine with routing profiles for different fusion configurations</li>
                {fusionMode !== 'parallel' && (
                  <li>• <strong>G0DM0D3 mode:</strong> {fusionMode === 'ultraplinian' ? 'Multi-model racing with rankings' : 'Hive-mind synthesis with consensus'}</li>
                )}
              </ul>
            </Card>
          </div>

          {/* Godmode Prompt Input (for non-parallel, non-classic modes) */}
          {fusionMode !== 'parallel' && fusionMode !== 'classic' && (
            <div className="mt-4">
              <Card padding="md">
                <h3 className="text-sm font-semibold text-fg mb-3">
                  {fusionMode === 'ultraplinian' ? 'ULTRAPLINIAN' : 'CONSORTIUM'} Prompt
                </h3>
                <div className="flex gap-3">
                  <textarea
                    value={godmodePrompt}
                    onChange={(e) => setGodmodePrompt(e.target.value)}
                    placeholder={`Enter prompt for ${fusionMode === 'ultraplinian' ? 'multi-model racing' : 'hive-mind synthesis'}...`}
                    className="flex-1 min-h-[80px] p-3 rounded-lg border border-border bg-surface-2 text-sm text-fg resize-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                    disabled={isRunningGodmode}
                  />
                  <div className="flex flex-col items-stretch gap-2 self-end">
                    <div className="flex items-center gap-2 px-1">
                      <Switch
                        checked={streamLiquid}
                        onCheckedChange={setStreamLiquid}
                        disabled={isRunningGodmode}
                      />
                      <span className="text-xs text-fg-muted whitespace-nowrap">
                        Stream (Liquid Response)
                      </span>
                    </div>
                    <Button
                      onClick={runGodmode}
                      disabled={!godmodePrompt.trim() || isRunningGodmode}
                    >
                      {isRunningGodmode ? 'Running...' : (streamLiquid ? 'Stream' : 'Run')}
                    </Button>
                  </div>
                </div>

                {/* Live streaming text */}
                {liveText && (
                  <div className="mt-3 rounded-lg border border-border bg-surface-2/50 p-3">
                    <div className="mb-1 text-xs font-medium text-fg-muted">
                      Live response
                    </div>
                    <div className="whitespace-pre-wrap text-sm text-fg">{liveText}</div>
                  </div>
                )}
              </Card>
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}
