import {
  Terminal,
  Save,
  RotateCcw,
  Copy,
  Check,
  AlertTriangle,
  ChevronDown,
  Download,
  Wifi,
  WifiOff,
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

interface TestResult {
  success: boolean;
  latencyMs: number;
  error?: string;
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
          <span className="text-xs text-fg-muted flex-1">Select model for OpenCode</span>
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

export function OpenCodePage() {
  const [providers, setProviders] = React.useState<ApiProvider[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<TestResult | null>(null);
  const [selected, setSelected] = React.useState<{ providerId: string; modelId: string } | null>(null);
  const [configFormat, setConfigFormat] = React.useState<'toml' | 'env'>('toml');

  // Load saved config from backend
  React.useEffect(() => {
    Promise.all([
      Admin.listProviders(),
      Admin.getAgentIntegrationConfig(),
    ])
      .then(([providerList, config]) => {
        setProviders(providerList);
        if (config.opencode) {
          const oc = config.opencode;
          if (oc.modelId && oc.providerId) {
            setSelected({ providerId: oc.providerId as string, modelId: oc.modelId as string });
          }
          if (oc.configFormat === 'toml' || oc.configFormat === 'env') {
            setConfigFormat(oc.configFormat);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const resolveModel = React.useMemo(() => {
    const model = selected
      ? providers.find((p) => p.id === selected.providerId)?.models?.find((m) => m.id === selected.modelId)
      : null;
    return model?.modelId ?? model?.id ?? 'auto-coding';
  }, [selected, providers]);

  const tomlConfig = React.useMemo(() => {
    const modelId = resolveModel;
    const gatewayUrl = window.location.origin;

    return `# DMR-X OpenCode Configuration
# Generated: ${new Date().toISOString().split('T')[0]}

{
  "languageModel": {
    "default": "dmrx",
    "dmrx": {
      "model": "${modelId}",
      "baseUrl": "${gatewayUrl}/v1",
      "apiKey": "dmrx_your_api_key_here"
    }
  }
}`;
  }, [selected, providers, resolveModel]);

  const envConfig = React.useMemo(() => {
    const modelId = resolveModel;
    const gatewayUrl = window.location.origin;

    return `# DMR-X OpenCode Environment Configuration
# Generated: ${new Date().toISOString().split('T')[0]}

# Set these environment variables before running OpenCode
export OPENAI_BASE_URL="${gatewayUrl}/v1"
export OPENAI_API_KEY="dmrx_your_api_key_here"
export OPENAI_MODEL="${modelId}"

# Then run:
opencode "your prompt here"`;
  }, [selected, providers, resolveModel]);

  // Save config to backend
  const handleSave = async () => {
    if (!selected) {
      toast.error('No model selected', { description: 'Select a model before saving.' });
      return;
    }

    setSaving(true);
    try {
      await Admin.updateAgentIntegrationConfig('opencode', {
        modelId: selected.modelId,
        providerId: selected.providerId,
        configFormat,
      });
      toast.success('Configuration saved', {
        description: 'Your OpenCode integration settings have been saved.',
      });
    } catch (err) {
      toast.error('Failed to save', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  // Test connection
  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await Admin.testIntegration('opencode');
      setTestResult(result);
      if (result.success) {
        toast.success('Connection successful', {
          description: `Gateway responded in ${result.latencyMs}ms`,
        });
      } else {
        toast.error('Connection failed', {
          description: result.error ?? 'Unknown error',
        });
      }
    } catch (err) {
      setTestResult({ success: false, latencyMs: 0, error: err instanceof Error ? err.message : String(err) });
      toast.error('Test failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  // Download config file
  const handleDownloadConfig = () => {
    const content = configFormat === 'toml' ? tomlConfig : envConfig;
    const filename = configFormat === 'toml' ? 'opencode.json' : 'opencode-env.sh';
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    toast.success('Config downloaded', {
      description: configFormat === 'toml'
        ? 'Copy to ~/.config/opencode/opencode.json'
        : 'Source this file or copy the exports to your shell profile',
    });
  };

  const handleReset = () => {
    setSelected(null);
    setTestResult(null);
    toast.show('Reset', { description: 'Model selection cleared.' });
  };

  if (loading) {
    return (
      <PageContainer>
        <PageHeader
          title="OpenCode Integration"
          description="Configure DMR-X as a model provider for the OpenCode CLI"
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
        title="OpenCode Integration"
        description="Configure DMR-X as a model provider for the OpenCode CLI"
        icon={<Terminal className="size-5" />}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <RotateCcw className="size-3" />
              Reset
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleTestConnection}
              loading={testing}
              leftIcon={testResult?.success ? <Wifi className="size-3" /> : testResult ? <WifiOff className="size-3" /> : undefined}
            >
              Test Connection
            </Button>
            <Button size="sm" onClick={handleSave} loading={saving}>
              <Save className="size-3" />
              Save
            </Button>
          </>
        }
      />

      <div className="mt-5 space-y-4">
        {/* Model Selection */}
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Model</CardTitle>
            <p className="text-[10px] text-fg-muted mt-0.5">
              Select the model OpenCode should use. DMR-X routes to the best available provider.
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

        {/* Test Result */}
        {testResult && (
          <div
            className={cn(
              'rounded-lg border px-4 py-3',
              testResult.success
                ? 'border-success/30 bg-success/5'
                : 'border-danger/30 bg-danger/5',
            )}
          >
            <div className="flex items-start gap-2">
              {testResult.success ? (
                <Wifi className="size-4 text-success shrink-0 mt-0.5" />
              ) : (
                <WifiOff className="size-4 text-danger shrink-0 mt-0.5" />
              )}
              <div className="text-xs text-fg leading-relaxed">
                <p className="font-medium">
                  {testResult.success ? 'Connection successful' : 'Connection failed'}
                </p>
                <p className="text-fg-muted">
                  {testResult.success
                    ? `Gateway responded in ${testResult.latencyMs}ms`
                    : testResult.error}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Config Format Toggle */}
        <div className="flex gap-2">
          <Button
            variant={configFormat === 'toml' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setConfigFormat('toml')}
          >
            Config File (JSON)
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
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  {configFormat === 'toml' ? 'Configuration File' : 'Environment Variables'}
                </CardTitle>
                <p className="text-[10px] text-fg-muted mt-0.5">
                  {configFormat === 'toml'
                    ? 'Add this to ~/.config/opencode/opencode.json'
                    : 'Set these environment variables before launching OpenCode'}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDownloadConfig}
                leftIcon={<Download className="size-3" />}
              >
                Download
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            <CodeBlock
              code={configFormat === 'toml' ? tomlConfig : envConfig}
              label={configFormat === 'toml' ? 'opencode.json' : 'shell'}
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
                DMR-X acts as an OpenAI-compatible proxy for OpenCode. Point{' '}
                <code className="font-mono bg-surface-2 px-1 rounded">baseUrl</code> or{' '}
                <code className="font-mono bg-surface-2 px-1 rounded">OPENAI_BASE_URL</code> to
                your gateway, and OpenCode will route requests through your configured
                providers with automatic fallback, rate limiting, and cost tracking.
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
              <p className="mb-1">2. Configure OpenCode (see above), then run:</p>
              <CodeBlock
                code={`opencode "Explain this codebase"`}
                label="terminal"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
