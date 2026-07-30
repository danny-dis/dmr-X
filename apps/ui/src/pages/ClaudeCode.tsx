import {
  Terminal,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  Info,
  ChevronDown,
  X,
  Search,
  Check,
  Download,
  Wifi,
  WifiOff,
} from 'lucide-react';
import * as React from 'react';
import { createPortal } from 'react-dom';

import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Code } from '@/components/primitives/Code';
import { DataState } from '@/components/primitives/DataState';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@/components/primitives/Dialog';
import { interpretError } from '@/components/primitives/ErrorState';
import { Input } from '@/components/primitives/Input';
import { toast } from '@/components/primitives/Toast';
import { PageHeader, PageContainer } from '@/components/layout';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatDuration } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ApiModel, ApiProvider } from '@/types/api';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface ClaudeCodeModelRole {
  key: 'big' | 'medium' | 'small';
  label: string;
  description: string;
  modelId: string | null;
  providerId: string | null;
}

interface EnvVar {
  key: string;
  value: string;
}

interface TestResult {
  success: boolean;
  latencyMs: number;
  error?: string;
}

type AgentIntegrationConfig = Awaited<ReturnType<typeof Admin.getAgentIntegrationConfig>>;

interface LoadedData {
  providers: ApiProvider[];
  config: AgentIntegrationConfig;
}

/* -------------------------------------------------------------------------- */
/*  Model Picker for a role                                                    */
/* -------------------------------------------------------------------------- */

function RoleModelPicker({
  role,
  providers,
  onSelect,
}: {
  role: ClaudeCodeModelRole;
  providers: ApiProvider[];
  onSelect: (providerId: string, modelId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const searchRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = React.useState({ top: 0, left: 0, width: 0 });

  const allModels = React.useMemo(() => {
    const items: Array<{ provider: ApiProvider; model: ApiModel; label: string }> = [];
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
    const groups: Record<string, typeof filtered> = {};
    for (const item of filtered) {
      const key = item.provider.id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return groups;
  }, [filtered]);

  const currentModel = React.useMemo(() => {
    if (!role.modelId) return null;
    return allModels.find(
      (item) => item.model.id === role.modelId && item.provider.id === role.providerId,
    );
  }, [allModels, role.modelId, role.providerId]);

  const updatePosition = React.useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
      width: Math.max(rect.width, 300),
    });
  }, []);

  React.useEffect(() => {
    if (open) {
      updatePosition();
      setTimeout(() => searchRef.current?.focus(), 100);
    } else {
      setSearch('');
    }
  }, [open, updatePosition]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const dropdown = open
    ? createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-50 rounded-xl border border-border bg-surface-1 shadow-lg"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        >
          <div className="border-b border-border px-3 py-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-fg-subtle" aria-hidden />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                aria-label="Search models"
                className="w-full pl-7 pr-7 py-1.5 text-xs bg-transparent outline-none"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  <X className="size-3.5 text-fg-subtle" aria-hidden />
                </button>
              )}
            </div>
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
                    const isSelected = item.model.id === role.modelId && item.provider.id === role.providerId;
                    return (
                      <div
                        key={item.model.id}
                        onClick={() => {
                          onSelect(item.provider.id, item.model.id);
                          setOpen(false);
                          setSearch('');
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
                        {isSelected && <Check className="size-3.5 text-primary shrink-0" aria-hidden />}
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
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2',
          'hover:border-border-strong transition-colors text-left w-full max-w-[280px]',
        )}
      >
        {currentModel ? (
          <>
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                role.key === 'big' && 'bg-danger/10 text-danger',
                role.key === 'medium' && 'bg-warning/10 text-warning',
                role.key === 'small' && 'bg-success/10 text-success',
              )}
            >
              {role.key === 'big' ? 'L' : role.key === 'medium' ? 'M' : 'S'}
            </span>
            <span className="text-xs font-medium text-fg truncate flex-1">
              {currentModel.label}
            </span>
            <Badge tone="muted" size="sm">{currentModel.provider.name}</Badge>
          </>
        ) : (
          <span className="text-xs text-fg-muted flex-1">{role.description}</span>
        )}
        <ChevronDown className="size-3.5 text-fg-subtle shrink-0" aria-hidden />
      </button>
      {dropdown}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Environment Variables Dialog                                               */
/* -------------------------------------------------------------------------- */

function EnvVarsDialog({
  open,
  onOpenChange,
  envVars,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  envVars: EnvVar[];
  onSave: (vars: EnvVar[]) => void;
}) {
  const [vars, setVars] = React.useState<EnvVar[]>(envVars);

  React.useEffect(() => {
    if (open) setVars([...envVars]);
  }, [open, envVars]);

  const updateVar = (index: number, field: 'key' | 'value', value: string) => {
    setVars((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)));
  };

  const addVar = () => setVars((prev) => [...prev, { key: '', value: '' }]);
  const removeVar = (index: number) => setVars((prev) => prev.filter((_, i) => i !== index));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Environment Variables</DialogTitle>
          <DialogDescription>
            Custom environment variables to pass to Claude Code when launching.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {vars.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={v.key}
                onChange={(e) => updateVar(i, 'key', e.target.value)}
                placeholder="KEY"
                aria-label={`Variable ${i + 1} name`}
                className="flex-1 font-mono text-xs"
              />
              <Input
                value={v.value}
                onChange={(e) => updateVar(i, 'value', e.target.value)}
                placeholder="value"
                aria-label={`Variable ${i + 1} value`}
                className="flex-1 font-mono text-xs"
              />
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => removeVar(i)}
                aria-label="Remove variable"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={addVar} leftIcon={<Plus className="size-3" aria-hidden />}>
            Add variable
          </Button>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm">Cancel</Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={() => {
              onSave(vars.filter((v) => v.key.trim()));
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Page                                                                  */
/* -------------------------------------------------------------------------- */

export function ClaudeCodePage() {
  const load = useApiData<LoadedData>(
    async () => {
      const [providerList, config] = await Promise.all([
        Admin.listProviders(),
        Admin.getAgentIntegrationConfig(),
      ]);
      return { providers: providerList, config };
    },
    [],
  );
  const providers = load.data?.providers ?? [];

  const [saving, setSaving] = React.useState(false);

  // Connection-check state, kept separate from the initial config load: it
  // is a one-off, user-triggered action rather than a query, so it starts
  // idle and only renders once the user asks for it.
  const [testStatus, setTestStatus] = React.useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [testResult, setTestResult] = React.useState<TestResult | null>(null);
  const [testError, setTestError] = React.useState<unknown>(null);

  const [roles, setRoles] = React.useState<ClaudeCodeModelRole[]>([
    { key: 'big', label: 'Large Model', description: 'Select Big Model (Opus)', modelId: null, providerId: null },
    { key: 'medium', label: 'Medium Model', description: 'Select Medium Model (Sonnet)', modelId: null, providerId: null },
    { key: 'small', label: 'Small Model', description: 'Select Small Model (Haiku)', modelId: null, providerId: null },
  ]);

  const [envVars, setEnvVars] = React.useState<EnvVar[]>([]);
  const [envDialogOpen, setEnvDialogOpen] = React.useState(false);

  // Sync local form state once the saved config has loaded.
  React.useEffect(() => {
    const cc = load.data?.config.claudeCode;
    if (!cc) return;
    setRoles((prev) =>
      prev.map((r) => ({
        ...r,
        modelId: (cc[`${r.key}ModelId`] as string | null) ?? null,
        providerId: (cc[`${r.key}ProviderId`] as string | null) ?? null,
      })),
    );
    if (cc.customEnvVars && Array.isArray(cc.customEnvVars)) {
      setEnvVars(cc.customEnvVars as EnvVar[]);
    }
  }, [load.data]);

  const updateRole = (key: 'big' | 'medium' | 'small', providerId: string, modelId: string) => {
    setRoles((prev) =>
      prev.map((r) => (r.key === key ? { ...r, providerId, modelId } : r)),
    );
  };

  // Save config to backend
  const handleSaveAndEnable = async () => {
    const configured = roles.filter((r) => r.modelId && r.providerId);
    if (configured.length === 0) {
      toast.error('No models selected', { description: 'Select at least one model role.' });
      return;
    }

    setSaving(true);
    try {
      const config: Record<string, unknown> = {};
      for (const role of roles) {
        config[`${role.key}ModelId`] = role.modelId;
        config[`${role.key}ProviderId`] = role.providerId;
      }
      config.customEnvVars = envVars.filter((v) => v.key.trim());

      await Admin.updateAgentIntegrationConfig('claudeCode', config);
      toast.success('Configuration saved', {
        description: 'Your Claude Code integration settings have been saved.',
      });
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setSaving(false);
    }
  };

  // Test connection
  const handleTestConnection = async () => {
    setTestStatus('loading');
    setTestResult(null);
    setTestError(null);
    try {
      const result = await Admin.testIntegration('claude-code');
      setTestResult(result);
      setTestStatus('success');
      if (result.success) {
        toast.success('Connection successful', {
          description: `Gateway responded in ${formatDuration(result.latencyMs)}`,
        });
      } else {
        toast.error('Connection failed', {
          description: result.error ?? 'The gateway rejected the test request. Check the model roles below and try again.',
        });
      }
    } catch (err) {
      setTestStatus('error');
      setTestError(err);
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    }
  };

  // Generate wrapper script
  const handleDownloadScript = () => {
    const apiUrl = window.location.origin;
    const configured = roles.filter((r) => r.modelId && r.providerId);

    const envLines: string[] = [];
    envLines.push(`# DMR-X Claude Code Wrapper`);
    envLines.push(`# Generated: ${new Date().toISOString().split('T')[0]}`);
    envLines.push('');
    envLines.push(`set -e`);
    envLines.push('');
    envLines.push(`# Configuration`);
    envLines.push(`DMRX_GATEWAY="${apiUrl}"`);
    envLines.push(`ANTHROPIC_BASE_URL="\${DMRX_GATEWAY}/v1"`);
    envLines.push('');

    const anthropicProvider = providers.find((p) => p.name.toLowerCase().includes('anthropic'));
    if (anthropicProvider?.apiKeyRef) {
      envLines.push(`# Set your DMR-X API key here or export it before running this script`);
      envLines.push(`export ANTHROPIC_API_KEY="\${DMRX_API_KEY:-your-api-key-here}"`);
      envLines.push('');
    }

    envLines.push(`# Model roles`);
    for (const role of configured) {
      const provider = providers.find((p) => p.id === role.providerId);
      const model = provider?.models?.find((m) => m.id === role.modelId);
      if (model) {
        const envKey =
          role.key === 'big'
            ? 'CLAUDE_CODE_BIG_MODEL'
            : role.key === 'medium'
              ? 'CLAUDE_CODE_MEDIUM_MODEL'
              : 'CLAUDE_CODE_SMALL_MODEL';
        envLines.push(`export ${envKey}="${model.modelId ?? model.id}"`);
      }
    }
    envLines.push('');

    if (envVars.length > 0) {
      envLines.push(`# Custom environment variables`);
      for (const ev of envVars) {
        if (ev.key.trim()) {
          envLines.push(`export ${ev.key}="${ev.value}"`);
        }
      }
      envLines.push('');
    }

    envLines.push(`# Validate gateway connectivity`);
    envLines.push(`echo "Testing DMR-X gateway connectivity..."`);
    envLines.push(`if ! curl -s --fail "\${DMRX_GATEWAY}/health" > /dev/null 2>&1; then`);
    envLines.push(`  echo "ERROR: Cannot reach DMR-X gateway at \${DMRX_GATEWAY}"`);
    envLines.push(`  echo "Please ensure the gateway is running: bun run dev:gateway"`);
    envLines.push(`  exit 1`);
    envLines.push(`fi`);
    envLines.push(`echo "Gateway is reachable."`);
    envLines.push('');
    envLines.push(`# Launch Claude Code`);
    envLines.push(`exec claude "$@"`);

    const script = envLines.join('\n');
    const blob = new Blob([script], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'claude-code-dmrx.sh';
    a.click();
    URL.revokeObjectURL(url);

    toast.success('Script downloaded', {
      description: 'Run: chmod +x claude-code-dmrx.sh && ./claude-code-dmrx.sh',
    });
  };

  const handleReset = () => {
    setRoles((prev) => prev.map((r) => ({ ...r, modelId: null, providerId: null })));
    setEnvVars([]);
    setTestStatus('idle');
    setTestResult(null);
    setTestError(null);
    toast.show('Reset to defaults', { description: 'Click Save to apply.' });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Claude Code Integration"
        description="Map DMR-X providers to Claude Code model roles"
        icon={<Terminal className="size-5" />}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <RotateCcw className="size-3" aria-hidden />
              Reset
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleTestConnection()}
              loading={testStatus === 'loading'}
              leftIcon={
                testResult?.success ? (
                  <Wifi className="size-3" aria-hidden />
                ) : testStatus === 'error' || testResult ? (
                  <WifiOff className="size-3" aria-hidden />
                ) : undefined
              }
            >
              Test Connection
            </Button>
            <Button size="sm" onClick={() => void handleSaveAndEnable()} loading={saving}>
              <Save className="size-3" aria-hidden />
              Save
            </Button>
          </>
        }
      />

      <div className="mt-5">
        <DataState
          data={load.data}
          isLoading={load.isLoading}
          error={load.error}
          onRetry={load.refetch}
          loading={
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 rounded-lg bg-surface-2 animate-pulse" />
              ))}
            </div>
          }
        >
          {() => (
            <div className="space-y-4">
              {roles.map((role) => (
                <Card key={role.key} padding="md">
                  <CardHeader className="px-0 pt-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'text-[10px] px-2 py-0.5 rounded-full font-bold',
                          role.key === 'big' && 'bg-danger/10 text-danger',
                          role.key === 'medium' && 'bg-warning/10 text-warning',
                          role.key === 'small' && 'bg-success/10 text-success',
                        )}
                      >
                        {role.key === 'big' ? 'BIG' : role.key === 'medium' ? 'MED' : 'SML'}
                      </span>
                      <CardTitle>{role.label}</CardTitle>
                      <Badge tone="muted" size="sm">
                        {role.description.split('(')[1]?.replace(')', '') ?? role.key}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="px-0">
                    <RoleModelPicker
                      role={role}
                      providers={providers}
                      onSelect={(providerId, modelId) => updateRole(role.key, providerId, modelId)}
                    />
                  </CardContent>
                </Card>
              ))}

              <Card padding="md">
                <CardHeader className="px-0 pt-0">
                  <CardTitle>Environment Variables</CardTitle>
                  <p className="text-[10px] text-fg-muted mt-0.5">
                    Custom env vars passed to Claude Code on launch
                  </p>
                </CardHeader>
                <CardContent className="px-0">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap gap-1.5">
                      {envVars.length === 0 ? (
                        <span className="text-xs text-fg-subtle">No custom variables</span>
                      ) : (
                        envVars.map((v, i) => (
                          <Badge key={i} tone="muted" size="sm" className="font-mono">
                            {v.key}=***
                          </Badge>
                        ))
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEnvDialogOpen(true)}
                      leftIcon={<Plus className="size-3" aria-hidden />}
                    >
                      Edit
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Connection check result */}
              {testStatus !== 'idle' && (
                <DataState
                  data={testResult}
                  isLoading={testStatus === 'loading'}
                  error={testError}
                  onRetry={handleTestConnection}
                  skeletonRows={1}
                >
                  {(result) => (
                    <div
                      className={cn(
                        'rounded-lg border px-4 py-3',
                        result.success
                          ? 'border-success/30 bg-success/5'
                          : 'border-danger/30 bg-danger/5',
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {result.success ? (
                          <Wifi className="size-4 text-success shrink-0 mt-0.5" aria-hidden />
                        ) : (
                          <WifiOff className="size-4 text-danger shrink-0 mt-0.5" aria-hidden />
                        )}
                        <div className="text-xs text-fg leading-relaxed">
                          <p className="font-medium">
                            {result.success ? 'Connection successful' : 'Connection failed'}
                          </p>
                          <p className="text-fg-muted">
                            {result.success
                              ? `Gateway responded in ${formatDuration(result.latencyMs)}`
                              : result.error}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </DataState>
              )}

              {/* Quick Setup */}
              <Card padding="md">
                <CardHeader className="px-0 pt-0">
                  <CardTitle>Quick Setup</CardTitle>
                </CardHeader>
                <CardContent className="px-0 space-y-3">
                  <div className="text-xs text-fg-muted">
                    <p className="mb-2 font-medium text-fg">Option 1: Download wrapper script</p>
                    <p className="mb-2">
                      Download a shell script that configures all environment variables and launches Claude Code.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleDownloadScript}
                      leftIcon={<Download className="size-3" aria-hidden />}
                    >
                      Download Script
                    </Button>
                  </div>
                  <div className="text-xs text-fg-muted">
                    <p className="mb-2 font-medium text-fg">Option 2: Set environment variables manually</p>
                    <Code inline={false} copyable language="bash">{`export ANTHROPIC_BASE_URL="${window.location.origin}/v1"
export ANTHROPIC_API_KEY="dmr-sk-your-key-here"
export CLAUDE_CODE_BIG_MODEL="claude-opus-4-20250514"
export CLAUDE_CODE_MEDIUM_MODEL="claude-sonnet-4-20250514"
export CLAUDE_CODE_SMALL_MODEL="claude-haiku-3-20250307"

claude "your prompt here"`}</Code>
                  </div>
                </CardContent>
              </Card>

              <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                <div className="flex items-start gap-2">
                  <Info className="size-4 text-primary shrink-0 mt-0.5" aria-hidden />
                  <div className="text-xs text-fg leading-relaxed">
                    <p className="font-medium mb-1">How it works</p>
                    <p className="text-fg-muted">
                      DMR-X acts as an Anthropic-compatible proxy for Claude Code. Set{' '}
                      <Code>ANTHROPIC_BASE_URL</Code> to this gateway&apos;s URL. Claude Code then
                      routes requests through the providers configured above, with fallback, rate
                      limiting, and cost tracking applied by the gateway.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DataState>
      </div>

      <EnvVarsDialog
        open={envDialogOpen}
        onOpenChange={setEnvDialogOpen}
        envVars={envVars}
        onSave={setEnvVars}
      />
    </PageContainer>
  );
}
