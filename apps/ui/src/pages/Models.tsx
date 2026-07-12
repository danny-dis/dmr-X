import { Database, Search, ChevronRight, RefreshCw, Plus, KeyRound, Key } from 'lucide-react';
import * as React from 'react';

import { CreateModelDialog } from '@/components/domain/CreateModelDialog';
import { ModelDetailDrawer } from '@/components/domain/ModelDetailDrawer';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Input } from '@/components/primitives/Input';
import { Pagination } from '@/components/primitives/Pagination';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useApiData, useUrlState, useUrlNullableState } from '@/hooks';
import { ModalityBadge } from '@/icons/Modality';
import { Admin } from '@/lib/admin';
import { formatNumber } from '@/lib/formatters';
import type { ApiModel, ApiProvider } from '@/types/api';

const PRICING_TIER_CONFIG: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'muted' }> = {
  free: { label: 'Free', tone: 'success' },
  free_with_limits: { label: 'Free (limited)', tone: 'info' },
  paid: { label: 'Paid', tone: 'warning' },
  subscription_only: { label: 'Subscription', tone: 'danger' },
  unknown: { label: '?', tone: 'muted' },
};

const CAPABILITY_TIER_CONFIG: Record<string, { label: string; description: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'muted' }> = {
  frontier: { label: 'Frontier', description: 'Best available — GPT-5.5, Claude Opus 4.8', tone: 'danger' },
  strong: { label: 'Strong', description: 'High capability — GPT-5.4, Claude Sonnet 4.6', tone: 'warning' },
  balanced: { label: 'Balanced', description: 'Good all-around — Gemini Flash, Qwen3', tone: 'info' },
  fast: { label: 'Fast', description: 'Optimized for speed — GPT-5.4 mini', tone: 'success' },
  economy: { label: 'Economy', description: 'Cheapest — Phi-4 Mini, Gemma 3 4B', tone: 'muted' },
};

const DEPLOYMENT_CONFIG: Record<string, { label: string; icon: string }> = {
  cloud: { label: 'Cloud', icon: 'Cloud' },
  self_hosted: { label: 'Self-hosted', icon: 'Self' },
  on_device: { label: 'On-device', icon: 'Device' },
};

const REASONING_MODE_CONFIG: Record<string, { label: string; description: string }> = {
  fixed: { label: 'Fixed', description: 'Standard inference' },
  adaptive: { label: 'Adaptive', description: 'Auto-switches thinking depth' },
  hybrid: { label: 'Hybrid', description: 'User-controlled thinking toggle' },
};

const SAFETY_TIER_CONFIG: Record<string, { label: string; description: string; tone: 'success' | 'warning' | 'danger' }> = {
  unrestricted: { label: 'Unrestricted', description: 'Minimal guardrails', tone: 'success' },
  standard: { label: 'Standard', description: 'Normal safety measures', tone: 'warning' },
  restricted: { label: 'Restricted', description: 'Deliberate capability limits', tone: 'danger' },
};

const AGENTIC_LEVEL_CONFIG: Record<string, { label: string; description: string }> = {
  chat: { label: 'Chat', description: 'Conversational only' },
  tool_use: { label: 'Tool Use', description: 'Can call functions' },
  autonomous: { label: 'Autonomous', description: 'Can take actions independently' },
};

export function ModelsPage() {
  const [query, setQuery] = useUrlState('q', '');
  const [modality, setModality] = useUrlNullableState('modality');
  const [providerFilter, setProviderFilter] = useUrlNullableState('provider');
  const [capabilityTierFilter, setCapabilityTierFilter] = useUrlNullableState('tier');
  const [pricingTierFilter, setPricingTierFilter] = useUrlNullableState('pricing');
  const [deploymentFilter, setDeploymentFilter] = useUrlNullableState('deployment');
  const [showUnavailable, setShowUnavailable] = useUrlState('unavailable', 'false');
  const [page, setPage] = React.useState(1);
  const [selectedModel, setSelectedModel] = React.useState<ApiModel | null>(null);
  const [createModelOpen, setCreateModelOpen] = React.useState(false);
  const pageSize = 24;

  // Fetch all models (with provider_available flag from backend)
  const models = useApiData<ApiModel[]>(() => Admin.listModels({ available_only: showUnavailable === 'true' ? 'false' : 'true' }), [], { refetchInterval: 30000 });
  const providers = useApiData<ApiProvider[]>(() => Admin.listProviders(), [], { refetchInterval: 30000 });

  // Build a lookup of provider key status
  const providerKeyStatus = React.useMemo(() => {
    const map = new Map<string, boolean>();
    for (const p of providers.data ?? []) {
      map.set(p.id, p.tier !== 'inactive');
    }
    return map;
  }, [providers.data]);

  const filtered = (models.data ?? []).filter((m) => {
    if (query && !m.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (modality && m.modality !== modality) return false;
    if (providerFilter && m.provider_id !== providerFilter) return false;
    if (capabilityTierFilter && m.capability_tier !== capabilityTierFilter) return false;
    if (pricingTierFilter && (m as any).pricing_tier !== pricingTierFilter) return false;
    if (contextTierFilter && m.context_tier !== contextTierFilter) return false;
    if (deploymentFilter && m.deployment !== deploymentFilter) return false;
    if (reasoningModeFilter && m.reasoning_mode !== reasoningModeFilter) return false;
    if (safetyTierFilter && m.safety_tier !== safetyTierFilter) return false;
    if (agenticLevelFilter && m.agentic_level !== agenticLevelFilter) return false;
    return true;
  });

  const modalities = Array.from(new Set((models.data ?? []).map((m) => m.modality).filter(Boolean)));
  const capabilityTiers = ['frontier', 'strong', 'balanced', 'fast', 'economy'];
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const availableCount = (models.data ?? []).filter(m => providerKeyStatus.get(m.provider_id) !== false).length;
  const unavailableCount = (models.data ?? []).length - availableCount;

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Models"
        description="Model registry — models from providers with active API keys"
        icon={<Database className="size-5" />}
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void models.refetch()}
              leftIcon={<RefreshCw className="size-3" />}
            >
              Discover
            </Button>
            <Button
              size="sm"
              onClick={() => setCreateModelOpen(true)}
              leftIcon={<Plus className="size-3" />}
            >
              New model
            </Button>
            <Badge tone="success" size="md" icon={<KeyRound className="size-3" />}>
              {availableCount} available
            </Badge>
            {unavailableCount > 0 && (
              <Badge tone="muted" size="md" icon={<Key className="size-3" />}>
                {unavailableCount} need key
              </Badge>
            )}
          </>
        }
      />

      <Card padding="none" className="mt-5">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <div className="flex-1 max-w-sm">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models…"
              prefix={<Search className="size-3.5" />}
              size="sm"
            />
          </div>
          <select
            value={providerFilter ?? ''}
            onChange={(e) => setProviderFilter(e.target.value || null)}
            className="h-7 rounded-md border border-border bg-surface-2 px-2 text-[11px] text-fg"
          >
            <option value="">All providers</option>
            {(providers.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.tier === 'inactive' ? '(no key)' : ''}
              </option>
            ))}
          </select>
          {unavailableCount > 0 && (
            <button
              onClick={() => setShowUnavailable(showUnavailable === 'true' ? 'false' : 'true')}
              className={`h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors ${
                showUnavailable === 'true'
                  ? 'bg-warning/10 text-warning border border-warning/20'
                  : 'text-fg-muted hover:bg-surface-2 border border-transparent'
              }`}
              title={showUnavailable === 'true' ? 'Hide models without keys' : 'Show models without keys'}
            >
              <Key className="size-3 inline mr-1" />
              {showUnavailable === 'true' ? 'Hide' : 'Show'} unavailable
            </button>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setModality(null)}
              className={`h-7 px-2.5 rounded-md text-[11px] font-medium ${
                !modality ? 'bg-primary/10 text-primary' : 'text-fg-muted hover:bg-surface-2'
              }`}
            >
              all
            </button>
            {modalities.slice(0, 6).map((m) => (
              <button
                key={m}
                onClick={() => setModality(m === modality ? null : m)}
                className={`h-7 px-2.5 rounded-md text-[11px] font-medium ${
                  modality === m
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-fg-muted hover:bg-surface-2 border border-transparent'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-2 pl-2 border-l border-border">
            <button
              onClick={() => setCapabilityTierFilter(null)}
              className={`h-7 px-2.5 rounded-md text-[11px] font-medium ${
                !capabilityTierFilter ? 'bg-primary/10 text-primary' : 'text-fg-muted hover:bg-surface-2'
              }`}
            >
              all tiers
            </button>
            {capabilityTiers.map((tier) => (
              <button
                key={tier}
                onClick={() => setCapabilityTierFilter(tier === capabilityTierFilter ? null : tier)}
                className={`h-7 px-2.5 rounded-md text-[11px] font-medium ${
                  capabilityTierFilter === tier
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-fg-muted hover:bg-surface-2 border border-transparent'
                }`}
                title={CAPABILITY_TIER_CONFIG[tier]?.description}
              >
                {CAPABILITY_TIER_CONFIG[tier]?.label ?? tier}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-2 pl-2 border-l border-border">
            <button
              onClick={() => setDeploymentFilter(null)}
              className={`h-7 px-2.5 rounded-md text-[11px] font-medium ${
                !deploymentFilter ? 'bg-primary/10 text-primary' : 'text-fg-muted hover:bg-surface-2'
              }`}
            >
              all deploy
            </button>
            {Object.entries(DEPLOYMENT_CONFIG).map(([key, config]) => (
              <button
                key={key}
                onClick={() => setDeploymentFilter(key === deploymentFilter ? null : key)}
                className={`h-7 px-2.5 rounded-md text-[11px] font-medium ${
                  deploymentFilter === key
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-fg-muted hover:bg-surface-2 border border-transparent'
                }`}
              >
                <span className="text-[10px] font-semibold tracking-wide text-fg-dim">{config.icon}</span>
                <span className="ml-1">{config.label}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-2 pl-2 border-l border-border">
            <button
              onClick={() => setPricingTierFilter(null)}
              className={`h-7 px-2.5 rounded-md text-[11px] font-medium ${
                !pricingTierFilter ? 'bg-primary/10 text-primary' : 'text-fg-muted hover:bg-surface-2'
              }`}
            >
              all pricing
            </button>
            {Object.entries(PRICING_TIER_CONFIG).filter(([k]) => k !== 'unknown').map(([key, config]) => (
              <button
                key={key}
                onClick={() => setPricingTierFilter(key === pricingTierFilter ? null : key)}
                className={`h-7 px-2.5 rounded-md text-[11px] font-medium ${
                  pricingTierFilter === key
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-fg-muted hover:bg-surface-2 border border-transparent'
                }`}
              >
                {config.label}
              </button>
            ))}
          </div>
        </div>

        {models.isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="p-4">
                <Skeleton className="h-3 w-3/4 mb-2" />
                <Skeleton className="h-2 w-1/2 mb-2" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        ) : paged.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
            {paged.map((m) => {
              const hasKey = providerKeyStatus.get(m.provider_id) !== false;
              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedModel(m)}
                  className={`group flex flex-col gap-2 p-4 text-left hover:bg-surface-2 transition-colors ${
                    !hasKey ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-fg font-mono truncate">{m.name}</h4>
                    <div className="flex items-center gap-1">
                      {hasKey ? (
                        <KeyRound className="size-3 text-success" />
                      ) : (
                        <Key className="size-3 text-fg-subtle" />
                      )}
                      <ChevronRight className="size-3.5 text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <Badge tone={hasKey ? 'success' : 'muted'} size="sm">
                      {m.provider ?? 'unknown'}
                    </Badge>
                    {m.modality && <ModalityBadge modality={m.modality} size={14} />}
                    {(() => {
                      const tier = m.capability_tier;
                      if (tier && CAPABILITY_TIER_CONFIG[tier]) {
                        const config = CAPABILITY_TIER_CONFIG[tier];
                        return <Badge tone={config.tone} size="sm">{config.label}</Badge>;
                      }
                      return null;
                    })()}
                    {(() => {
                      const tier = (m as any).pricing_tier;
                      if (tier && tier !== 'unknown') {
                        const config = PRICING_TIER_CONFIG[tier] ?? PRICING_TIER_CONFIG.unknown;
                        return <Badge tone={config.tone} size="sm">{config.label}</Badge>;
                      }
                      return null;
                    })()}
                  </div>
                <div className="grid grid-cols-3 gap-2 text-[10px] text-fg-muted">
                  <div>
                    <div className="text-fg-subtle">Context</div>
                    <div className="text-fg tabular-nums">{formatNumber(m.context_window ?? 0, true)}</div>
                  </div>
                  <div>
                    <div className="text-fg-subtle">In/Out</div>
                    <div className="text-fg tabular-nums">
                      ${m.input_cost_per_1k?.toFixed(3) ?? '—'} / ${m.output_cost_per_1k?.toFixed(3) ?? '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-fg-subtle">Deploy</div>
                    <div className="text-fg">{m.deployment ?? 'cloud'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[9px] text-fg-subtle mt-1">
                  {m.reasoning_mode && m.reasoning_mode !== 'fixed' && (
                    <span className="px-1 py-0.5 rounded bg-surface-2 text-fg-muted uppercase tracking-wide" title={REASONING_MODE_CONFIG[m.reasoning_mode]?.description}>
                      {REASONING_MODE_CONFIG[m.reasoning_mode]?.label ?? m.reasoning_mode}
                    </span>
                  )}
                  {m.agentic_level && m.agentic_level !== 'chat' && (
                    <span className="px-1 py-0.5 rounded bg-surface-2 text-fg-muted uppercase tracking-wide" title={AGENTIC_LEVEL_CONFIG[m.agentic_level]?.description}>
                      {AGENTIC_LEVEL_CONFIG[m.agentic_level]?.label ?? m.agentic_level}
                    </span>
                  )}
                  {m.safety_tier && m.safety_tier !== 'standard' && (
                    <span className="px-1 py-0.5 rounded bg-surface-2 text-fg-muted uppercase tracking-wide" title={SAFETY_TIER_CONFIG[m.safety_tier]?.description}>
                      {SAFETY_TIER_CONFIG[m.safety_tier]?.label ?? m.safety_tier}
                    </span>
                  )}
                </div>
              </button>
            );
            })}
          </div>
        ) : (
          <EmptyState
            title="No models"
            description="Connect a provider to populate the model registry."
          />
        )}

        {filtered.length > pageSize && (
          <div className="border-t border-border px-3 py-2.5">
            <Pagination
              page={page}
              totalPages={Math.ceil(filtered.length / pageSize)}
              onPageChange={setPage}
              total={filtered.length}
              pageSize={pageSize}
            />
          </div>
        )}
      </Card>

      <ModelDetailDrawer
        model={selectedModel}
        open={selectedModel !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedModel(null);
        }}
        onChanged={() => void models.refetch()}
      />

      <CreateModelDialog
        open={createModelOpen}
        onOpenChange={setCreateModelOpen}
        onCreated={() => void models.refetch()}
      />
    </PageContainer>
  );
}
