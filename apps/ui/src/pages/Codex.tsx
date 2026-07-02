import {
  Terminal,
  Save,
  RotateCcw,
  Copy,
  Check,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Input } from '@/components/primitives/Input';
import { toast } from '@/components/primitives/Toast';
import { PageHeader, PageContainer } from '@/components/layout';
import { Admin } from '@/lib/admin';
import { cn } from '@/lib/utils';
import type { ApiModel, ApiProvider } from '@/types/api';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface ModelOption {
  provider: ApiProvider;
  model: ApiModel;
  label: string;
}

/* -------------------------------------------------------------------------- */
/*  Model Picker                                                               */
/* -------------------------------------------------------------------------- */

function ModelPicker({
  providers,
  selected,
  onSelect,
}: {
  providers: ApiProvider[];
  selected: { providerId: string; modelId: string } | null;
  onSelect: (providerId: string, modelId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const searchRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const allModels = React.useMemo(() => {
    const items: ModelOption[] = [];
    for (const provider of providers) {
      if (!provider.models) continue;
      for (const model of provider.models) {
        const label = model.displayName ?? model.name ?? model.modelId ?? model.id;
        items.push({ provider, model, label });
      }
    }
    return items;
  }, [providers]);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return allModels;
    const q = search.toLowerCase();
    return allModels.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.model.modelId?.toLowerCase().includes(q) ||
        item.provider.name.toLowerCase().includes(q),
    );
  }, [allModels, search]);

  const grouped = React.useMemo(() => {
    const groups: Record<string, ModelOption[]> = {};
    for (const item of filtered) {
      const key = item.provider.id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  }, [filtered]);

  const current = React.useMemo(() => {
    if (!selected) return null;
    return allModels.find(
      (item) => item.model.id === selected.modelId && item.provider.id === selected.providerId,
    );
  }, [allModels, selected]);

  React.useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 100);
    else setSearch('');
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2',
          'hover:border-border-strong transition-colors text-left w-full max-w-[360px]',
        )}
      >
        {current ? (
          <>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-primary/10 text-primary">
              MODEL
            </span>
            <span className="text-xs font-medium text-fg truncate flex-1">
              {current.label}
            </span>
            <Badge tone="muted" size="sm">{current.provider.name}</Badge>
          </>
        ) : (
          <span className="text-xs text-fg-muted flex-1">Select model for Codex</span>
        )}
        <ChevronDown className="size-3.5 text-fg-subtle shrink-0" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div
            className="fixed rounded-xl border border-border bg-surface-1 shadow-lg"
            style={{
              top: triggerRef.current
                ? triggerRef.current.getBoundingClientRect().bottom + window.scrollY + 4
                : 0,
              left: triggerRef.current
                ? triggerRef.current.getBoundingClientRect().left + window.scrollX
                : 0,
              width: Math.max(triggerRef.current?.offsetWidth ?? 300, 320),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border px-3 py-2">
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="w-full text-xs"
              />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {Object.entries(grouped).map(([providerId, items]) => {
                const provider = items[0]?.provider;
                if (!provider) return null;
                return (
                  <div key={providerId}>
                    <div className="px-3 py-1.5 text-[10px] font-semibold text-fg-subtle uppercase tracking-wider bg-surface-2/50">
                      {provider.name}
                    </div>
                    {items.map((item) => {
                      const isSelected = item.model.id === selected?.modelId && item.provider.id === selected?.providerId;
                      return (
                        <div
                          key={item.model.id}
                          onClick={() => {
                            onSelect(item.provider.id, item.model.id);
                            setOpen(false);
                          }}
                          className={cn(
                            'flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors',
                            'hover:bg-surface-3',
                            isSelected && 'bg-primary/10',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-fg truncate">{item.label}</div>
                            <div className="text-[10px] text-fg-subtle font-mono mt-0.5 truncate">
                              {item.model.modelId ?? item.model.id}
                            </div>
                          </div>
                          {isSelected && <Check className="size-3.5 text-primary shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-fg-muted">
                  No models found
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Copyable Code Block                                                        */
/* -------------------------------------------------------------------------- */

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-3 rounded-t-lg border border-border border-b-0">
        <span className="text-[10px] text-fg-subtle font-medium">{label}</span>
        <button
          onClick={handleCopy}
          className="text-fg-subtle hover:text-fg transition-colors"
          title="Copy to clipboard"
        >
          {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
        </button>
      </div>
      <pre className="px-3 py-2 bg-surface-2 rounded-b-lg border border-border overflow-x-auto text-[11px] font-mono text-fg leading-relaxed">
        {code}
      </pre>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Page                                                                  */
/* -------------------------------------------------------------------------- */

export function CodexPage() {
  const [providers, setProviders] = React.useState<ApiProvider[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<{ providerId: string; modelId: string } | null>(null);
  const [configFormat, setConfigFormat] = React.useState<'toml' | 'env'>('toml');

  React.useEffect(() => {
    Admin.listProviders()
      .then(setProviders)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const tomlConfig = React.useMemo(() => {
    const model = selected
      ? providers.find((p) => p.id === selected.providerId)?.models?.find((m) => m.id === selected.modelId)
      : null;
    const modelId = model?.modelId ?? model?.id ?? 'auto-coding';

    return `# Add this to ~/.codex/config.toml
model = "${modelId}"
model_provider = "dmrx"

[model_providers.dmrx]
name = "DMR-X Gateway"
base_url = "http://localhost:3000/v1"
env_key = "DMRX_API_KEY"
wire_api = "chat"
requires_openai_auth = false`;
  }, [selected, providers]);

  const envConfig = React.useMemo(() => {
    const model = selected
      ? providers.find((p) => p.id === selected.providerId)?.models?.find((m) => m.id === selected.modelId)
      : null;
    const modelId = model?.modelId ?? model?.id ?? 'auto-coding';

    return `# Set these environment variables before running Codex
export OPENAI_BASE_URL=http://localhost:3000/v1
export OPENAI_API_KEY=dmrx_your_api_key_here

# Then run:
codex --model ${modelId} "your prompt here"`;
  }, [selected, providers]);

  const handleReset = () => {
    setSelected(null);
    toast.show('Reset', { description: 'Model selection cleared.' });
  };

  if (loading) {
    return (
      <PageContainer>
        <PageHeader
          title="Codex Integration"
          description="Configure DMR-X as a model provider for OpenAI Codex CLI"
          icon={<Terminal className="size-5" />}
        />
        <div className="mt-5 space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-surface-2 animate-pulse" />
          ))}
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Codex Integration"
        description="Configure DMR-X as a model provider for OpenAI Codex CLI"
        icon={<Terminal className="size-5" />}
        actions={
          <Button variant="ghost" size="sm" onClick={handleReset}>
            <RotateCcw className="size-3" />
            Reset
          </Button>
        }
      />

      <div className="mt-5 space-y-4">
        {/* Model Selection */}
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Model</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">
              Select the model Codex should use. DMR-X routes to the best available provider.
            </p>
          </CardHeader>
          <CardContent className="px-0">
            <ModelPicker
              providers={providers}
              selected={selected}
              onSelect={(providerId, modelId) => setSelected({ providerId, modelId })}
            />
          </CardContent>
        </Card>

        {/* Config Format Toggle */}
        <div className="flex gap-2">
          <Button
            variant={configFormat === 'toml' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setConfigFormat('toml')}
          >
            Config File (TOML)
          </Button>
          <Button
            variant={configFormat === 'env' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setConfigFormat('env')}
          >
            Environment Variables
          </Button>
        </div>

        {/* Generated Config */}
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>
              {configFormat === 'toml' ? 'Configuration File' : 'Environment Variables'}
            </CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">
              {configFormat === 'toml'
                ? 'Add this to ~/.codex/config.toml'
                : 'Set these environment variables before launching Codex'}
            </p>
          </CardHeader>
          <CardContent className="px-0">
            <CodeBlock
              code={configFormat === 'toml' ? tomlConfig : envConfig}
              label={configFormat === 'toml' ? 'config.toml' : 'shell'}
            />
          </CardContent>
        </Card>

        {/* How it works */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 text-primary shrink-0 mt-0.5" />
            <div className="text-xs text-fg leading-relaxed">
              <p className="font-medium mb-1">How it works</p>
              <p className="text-fg-muted">
                DMR-X acts as an OpenAI-compatible proxy for Codex. Point{' '}
                <code className="font-mono bg-surface-2 px-1 rounded">base_url</code> or{' '}
                <code className="font-mono bg-surface-2 px-1 rounded">OPENAI_BASE_URL</code> to
                your gateway, and Codex will route requests through your configured
                providers with automatic fallback, rate limiting, and cost tracking.
              </p>
              <p className="text-fg-muted mt-2">
                <strong>Important:</strong> Codex validates that API keys start with{' '}
                <code className="font-mono bg-surface-2 px-1 rounded">sk-</code>. Since DMR-X
                keys start with <code className="font-mono bg-surface-2 px-1 rounded">dmr-sk-</code>,
                you must set{' '}
                <code className="font-mono bg-surface-2 px-1 rounded">requires_openai_auth = false</code>{' '}
                in the config file approach.
              </p>
            </div>
          </div>
        </div>

        {/* Quick Start */}
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Quick Start</CardTitle>
          </CardHeader>
          <CardContent className="px-0 space-y-2">
            <div className="text-xs text-fg-muted">
              <p className="mb-1">1. Start the DMR-X gateway:</p>
              <CodeBlock code="bun run dev:gateway" label="terminal" />
            </div>
            <div className="text-xs text-fg-muted mt-3">
              <p className="mb-1">2. Configure Codex (see above), then run:</p>
              <CodeBlock
                code={`codex "Explain this codebase"`}
                label="terminal"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
