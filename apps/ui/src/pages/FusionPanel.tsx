import { Layers, Plus, Trash2, GripVertical, Zap, Server, ArrowUpDown, RefreshCw, Settings } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { EmptyState } from '@/components/primitives/EmptyState';
import { interpretError } from '@/components/primitives/ErrorState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Switch } from '@/components/primitives/Switch';
import { StatTile } from '@/components/primitives/StatTile';
import { Textarea } from '@/components/primitives/Textarea';
import { toast } from '@/components/primitives/Toast';
import { fetchAuthenticated } from '@/lib/api';
import { formatNumber } from '@/lib/formatters';
import {
  useAddFusionSlot,
  useCreateFusionPanel,
  useDeleteFusionPanel,
  useFusionPanels,
  useRemoveFusionSlot,
  useReorderFusionSlots,
  useUpdateFusionPanel,
} from '@/lib/queries/fusionPanels';
import { useCatalog, useProviders } from '@/lib/queries/providers';
import { cn } from '@/lib/utils';

// G0DM0D3 components
import { FusionModeSelector, type FusionMode } from '@/components/fusion/FusionModeSelector';
import { RaceResults, type RaceRanking } from '@/components/fusion/RaceResults';
import { SynthesisPanel, type ConsortiumResult } from '@/components/fusion/SynthesisPanel';
import { GodmodeSettings, type GodmodeConfig } from '@/components/fusion/GodmodeSettings';

export function FusionPanelPage() {
  const [activePanelId, setActivePanelId] = React.useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = React.useState<string>('');
  const [selectedModel, setSelectedModel] = React.useState<string>('');

  // Per-action busy flags — each drives a Button's `loading` prop instead of
  // swapping its label, and each slot-row action shares one id since a human
  // only triggers one action per row at a time.
  const [creatingPanel, setCreatingPanel] = React.useState(false);
  const [deletingPanel, setDeletingPanel] = React.useState(false);
  const [togglingPanel, setTogglingPanel] = React.useState(false);
  const [addingSlot, setAddingSlot] = React.useState(false);
  const [busySlotId, setBusySlotId] = React.useState<string | null>(null);

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

  const providers = useProviders({ refetchInterval: 30000 });
  const catalog = useCatalog({ refetchInterval: 60000 });

  const panelsQuery = useFusionPanels({ refetchInterval: 30000 });
  const panels = panelsQuery.data ?? [];

  const createPanelMutation = useCreateFusionPanel();
  const deletePanelMutation = useDeleteFusionPanel();
  const updatePanelMutation = useUpdateFusionPanel();
  const addSlotMutation = useAddFusionSlot();
  const removeSlotMutation = useRemoveFusionSlot();
  const reorderSlotsMutation = useReorderFusionSlots();

  const catalogEntries = catalog.data?.entries ?? [];
  const enabledProviders = (providers.data ?? []).filter(p => p.enabled);

  const availableModels = React.useMemo(() => {
    if (!selectedProvider) return [];
    const provider = enabledProviders.find(p => p.id === selectedProvider);
    if (!provider) return [];
    return provider.models ?? [];
  }, [selectedProvider, enabledProviders]);

  // Auto-select the first panel once the list loads, if nothing is active yet.
  React.useEffect(() => {
    if (!activePanelId && panelsQuery.data && panelsQuery.data.length > 0) {
      setActivePanelId(panelsQuery.data[0]!.id);
    }
  }, [panelsQuery.data, activePanelId]);

  const activePanel = panels.find(p => p.id === activePanelId) ?? null;
  const slots = activePanel?.slots ?? [];

  const createPanel = async () => {
    const name = `Fusion Panel ${panels.length + 1}`;
    setCreatingPanel(true);
    try {
      const newPanel = await createPanelMutation.mutateAsync({ name });
      setActivePanelId(newPanel.id);
      toast.success(`Created "${name}"`);
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setCreatingPanel(false);
    }
  };

  const deletePanel = async (id: string) => {
    setDeletingPanel(true);
    try {
      await deletePanelMutation.mutateAsync(id);
      if (activePanelId === id) {
        setActivePanelId(panels.find(p => p.id !== id)?.id ?? null);
      }
      toast.success('Panel deleted');
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setDeletingPanel(false);
    }
  };

  const addSlot = async () => {
    if (!activePanelId || !selectedProvider || !selectedModel) {
      toast.error('Select a provider and model', {
        description: 'Choose both a provider and a model before adding a slot.',
      });
      return;
    }
    const provider = enabledProviders.find(p => p.id === selectedProvider);
    const model = provider?.models?.find(m => m.id === selectedModel);
    if (!provider || !model) return;

    setAddingSlot(true);
    try {
      const newSlot = await addSlotMutation.mutateAsync({
        panelId: activePanelId,
        provider_id: provider.name,
        model_id: model.id,
        display_name: `${provider.name} / ${model.id}`,
      });

      setSelectedProvider('');
      setSelectedModel('');
      toast.success(`Added ${newSlot.display_name}`);
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setAddingSlot(false);
    }
  };

  const removeSlot = async (slotId: string) => {
    if (!activePanelId) return;
    setBusySlotId(slotId);
    try {
      await removeSlotMutation.mutateAsync({ panelId: activePanelId, slotId });
      toast.success('Slot removed');
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setBusySlotId(null);
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

    setBusySlotId(slotId);
    try {
      await reorderSlotsMutation.mutateAsync({ panelId: activePanelId, slotIds: currentSlots.map(s => s.id) });
      toast.success('Slot order updated');
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setBusySlotId(null);
    }
  };

  const toggleSlot = async (slotId: string) => {
    if (!activePanelId) return;
    const slot = slots.find(s => s.id === slotId);
    if (!slot) return;
    setBusySlotId(slotId);
    try {
      // Use update to toggle is_enabled
      const updatedSlots = slots.map(s =>
        s.id === slotId ? { ...s, is_enabled: s.is_enabled ? 0 : 1 } : s
      );
      await updatePanelMutation.mutateAsync({ id: activePanelId, slots: updatedSlots });
      toast.success(slot.is_enabled ? 'Slot disabled' : 'Slot enabled');
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setBusySlotId(null);
    }
  };

  const togglePanel = async (panelId: string) => {
    const panel = panels.find(p => p.id === panelId);
    if (!panel) return;
    setTogglingPanel(true);
    try {
      await updatePanelMutation.mutateAsync({ id: panelId, is_active: panel.is_active ? 0 : 1 });
      toast.success(panel.is_active ? 'Panel deactivated' : 'Panel activated');
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setTogglingPanel(false);
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
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
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
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void panelsQuery.refetch()}
              loading={panelsQuery.isLoading}
              aria-label="Refresh panels"
            >
              <RefreshCw className="size-3" aria-hidden />
            </Button>
            <Button size="sm" onClick={createPanel} loading={creatingPanel} leftIcon={<Plus className="size-3" aria-hidden />}>
              New Panel
            </Button>
          </div>
        }
      />

      <div className="mt-4">
        <DataState
          data={panelsQuery.data}
          isLoading={panelsQuery.isLoading}
          error={panelsQuery.error}
          onRetry={panelsQuery.refetch}
          skeletonRows={4}
          empty={{
            icon: <Layers className="size-8" />,
            title: 'No fusion panels',
            description: 'Create a panel to configure multi-model parallel execution.',
            action: (
              <Button size="sm" onClick={createPanel} loading={creatingPanel} leftIcon={<Plus className="size-3" aria-hidden />}>
                Create panel
              </Button>
            ),
          }}
        >
          {() => (
            <>
              {/* Panel selector */}
              <div className="flex items-center gap-3">
                <Select value={activePanelId ?? ''} onValueChange={setActivePanelId}>
                  <SelectTrigger className="w-64 h-9" aria-label="Active fusion panel">
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
                    loading={togglingPanel}
                  >
                    {activePanel.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                )}
                {activePanel && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deletePanel(activePanel.id)}
                    loading={deletingPanel}
                    aria-label={`Delete ${activePanel.name}`}
                    className="text-danger"
                  >
                    <Trash2 className="size-3" aria-hidden />
                  </Button>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatTile
                  label="Slots"
                  value={formatNumber(slots.length)}
                  icon={<Layers className="size-3.5" />}
                  hint="models in fusion panel"
                />
                <StatTile
                  label="Providers"
                  value={formatNumber(new Set(slots.map(s => s.provider_id)).size)}
                  icon={<Server className="size-3.5" />}
                  tone="success"
                  hint="unique providers"
                />
                <StatTile
                  label="Available"
                  value={formatNumber(enabledProviders.length)}
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

              {/* G0DM0D3 Tier Info (when not parallel) */}
              {fusionMode !== 'parallel' && (
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

              {/* G0DM0D3 Settings (visible when not parallel) */}
              {fusionMode !== 'parallel' && (
                <div className="mt-4">
                  <Card padding="md">
                    <h3 className="text-sm font-semibold text-fg mb-3 flex items-center gap-2">
                      <Settings className="size-4" aria-hidden />
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

              {/* Add Model Slot */}
              {activePanel && (
                <div className="mt-4">
                  <Card padding="md">
                    <h3 className="text-sm font-semibold text-fg mb-3">Add Model Slot</h3>
                    <div className="flex items-center gap-3">
                      <Select value={selectedProvider} onValueChange={(v) => { setSelectedProvider(v); setSelectedModel(''); }}>
                        <SelectTrigger className="w-48 h-9" aria-label="Provider">
                          <SelectValue placeholder="Select provider…" />
                        </SelectTrigger>
                        <SelectContent>
                          {enabledProviders.map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={selectedModel} onValueChange={setSelectedModel} disabled={!selectedProvider}>
                        <SelectTrigger className="w-60 h-9" disabled={!selectedProvider} aria-label="Model">
                          <SelectValue placeholder="Select model…" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableModels.map(m => (
                            <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        onClick={addSlot}
                        disabled={!selectedProvider || !selectedModel}
                        loading={addingSlot}
                        leftIcon={<Plus className="size-3" aria-hidden />}
                      >
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
                      <Badge tone="muted" size="sm">{formatNumber(slots.length)} slots</Badge>
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
                            <GripVertical className="size-4 text-fg-subtle cursor-move" aria-hidden />
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
                                loading={busySlotId === slot.id}
                                aria-label={slot.is_enabled ? `Disable ${slot.display_name}` : `Enable ${slot.display_name}`}
                              >
                                {slot.is_enabled ? (
                                  <span className="size-2 rounded-full bg-success" aria-hidden />
                                ) : (
                                  <span className="size-2 rounded-full border border-fg-subtle" aria-hidden />
                                )}
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => moveSlot(slot.id, 'up')}
                                disabled={idx === 0}
                                loading={busySlotId === slot.id}
                                aria-label={`Move ${slot.display_name} up`}
                              >
                                ↑
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => moveSlot(slot.id, 'down')}
                                disabled={idx === slots.length - 1}
                                loading={busySlotId === slot.id}
                                aria-label={`Move ${slot.display_name} down`}
                              >
                                ↓
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => removeSlot(slot.id)}
                                loading={busySlotId === slot.id}
                                aria-label={`Remove ${slot.display_name}`}
                              >
                                <Trash2 className="size-3 text-danger" aria-hidden />
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

              {/* Godmode Prompt Input (for non-parallel modes) */}
              {fusionMode !== 'parallel' && (
                <div className="mt-4">
                  <Card padding="md">
                    <h3 className="text-sm font-semibold text-fg mb-3">
                      {fusionMode === 'ultraplinian' ? 'ULTRAPLINIAN' : 'CONSORTIUM'} Prompt
                    </h3>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label htmlFor="godmode-prompt" className="sr-only">
                          {fusionMode === 'ultraplinian' ? 'ULTRAPLINIAN' : 'CONSORTIUM'} prompt
                        </label>
                        <Textarea
                          id="godmode-prompt"
                          value={godmodePrompt}
                          onChange={(e) => setGodmodePrompt(e.target.value)}
                          placeholder={`Enter prompt for ${fusionMode === 'ultraplinian' ? 'multi-model racing' : 'hive-mind synthesis'}...`}
                          className="min-h-[80px] resize-none"
                          disabled={isRunningGodmode}
                        />
                      </div>
                      <div className="flex flex-col items-stretch gap-2 self-end">
                        <div className="flex items-center gap-2 px-1">
                          <Switch
                            id="godmode-stream"
                            checked={streamLiquid}
                            onCheckedChange={setStreamLiquid}
                            disabled={isRunningGodmode}
                          />
                          <label htmlFor="godmode-stream" className="text-xs text-fg-muted whitespace-nowrap">
                            Stream (Liquid Response)
                          </label>
                        </div>
                        <Button
                          onClick={runGodmode}
                          disabled={!godmodePrompt.trim()}
                          loading={isRunningGodmode}
                        >
                          {streamLiquid ? 'Stream' : 'Run'}
                        </Button>
                      </div>
                    </div>

                    {/* Live streaming text */}
                    {liveText && (
                      <div className="mt-3 rounded-lg border border-border bg-surface-2/50 p-3" aria-live="polite">
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
        </DataState>
      </div>
    </PageContainer>
  );
}
