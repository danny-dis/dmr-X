import {
  Terminal,
  Save,
  RotateCcw,
  ExternalLink,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  ChevronDown,
  X,
  Search,
  Check,
} from 'lucide-react';
import * as React from 'react';
import { createPortal } from 'react-dom';

import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
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
import { Input } from '@/components/primitives/Input';
import { toast } from '@/components/primitives/Toast';
import { PageHeader, PageContainer } from '@/components/layout';
import { Admin } from '@/lib/admin';
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
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-fg-subtle" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="w-full pl-7 pr-7 py-1.5 text-xs bg-transparent outline-none"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X className="size-3.5 text-fg-subtle" />
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
        <ChevronDown className="size-3.5 text-fg-subtle shrink-0" />
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
                className="flex-1 font-mono text-xs"
              />
              <Input
                value={v.value}
                onChange={(e) => updateVar(i, 'value', e.target.value)}
                placeholder="value"
                className="flex-1 font-mono text-xs"
              />
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => removeVar(i)}
                aria-label="Remove"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={addVar} leftIcon={<Plus className="size-3" />}>
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
  const [providers, setProviders] = React.useState<ApiProvider[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const [roles, setRoles] = React.useState<ClaudeCodeModelRole[]>([
    { key: 'big', label: 'Large Model', description: 'Select Big Model (Opus)', modelId: null, providerId: null },
    { key: 'medium', label: 'Medium Model', description: 'Select Medium Model (Sonnet)', modelId: null, providerId: null },
    { key: 'small', label: 'Small Model', description: 'Select Small Model (Haiku)', modelId: null, providerId: null },
  ]);

  const [envVars, setEnvVars] = React.useState<EnvVar[]>([]);
  const [envDialogOpen, setEnvDialogOpen] = React.useState(false);

  React.useEffect(() => {
    Admin.listProviders()
      .then(setProviders)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const updateRole = (key: 'big' | 'medium' | 'small', providerId: string, modelId: string) => {
    setRoles((prev) =>
      prev.map((r) => (r.key === key ? { ...r, providerId, modelId } : r)),
    );
  };

  const handleSaveAndEnable = async () => {
    const configured = roles.filter((r) => r.modelId && r.providerId);
    if (configured.length === 0) {
      toast.error('No models selected', { description: 'Select at least one model role.' });
      return;
    }

    setSaving(true);
    try {
      const apiUrl = window.location.origin;

      const claudeEnvVars: Record<string, string> = {
        ANTHROPIC_BASE_URL: `${apiUrl}/v1`,
      };

      const anthropicProvider = providers.find((p) => p.name.toLowerCase().includes('anthropic'));
      if (anthropicProvider?.apiKeyRef) {
        claudeEnvVars.ANTHROPIC_API_KEY = anthropicProvider.apiKeyRef;
      }

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
          claudeEnvVars[envKey] = model.modelId ?? model.id;
        }
      }

      for (const ev of envVars) {
        if (ev.key.trim()) {
          claudeEnvVars[ev.key.trim()] = ev.value;
        }
      }

      const envStr = Object.entries(claudeEnvVars)
        .map(([k, v]) => `${k}=${k.includes('KEY') ? '***' : v}`)
        .join('\n');

      toast.success('Configuration saved', {
        description: `Set these environment variables before launching Claude Code:\n\n${envStr}`,
        duration: 10000,
      });
    } catch (err) {
      toast.error('Failed to save', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setRoles((prev) => prev.map((r) => ({ ...r, modelId: null, providerId: null })));
    setEnvVars([]);
    toast.show('Reset to defaults', { description: 'Click Save & Enable to apply.' });
  };

  if (loading) {
    return (
      <PageContainer>
        <PageHeader
          title="Claude Code Integration"
          description="Configure model roles for Claude Code"
          icon={<Terminal className="size-5" />}
        />
        <div className="mt-5 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-surface-2 animate-pulse" />
          ))}
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Claude Code Integration"
        description="Map DMR-X providers to Claude Code model roles"
        icon={<Terminal className="size-5" />}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <RotateCcw className="size-3" />
              Reset
            </Button>
            <Button size="sm" onClick={handleSaveAndEnable} loading={saving}>
              <Save className="size-3" />
              Save & Enable
            </Button>
          </>
        }
      />

      <div className="mt-5 space-y-4">
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
                leftIcon={<Plus className="size-3" />}
              >
                Edit
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 text-primary shrink-0 mt-0.5" />
            <div className="text-xs text-fg leading-relaxed">
              <p className="font-medium mb-1">How it works</p>
              <p className="text-fg-muted">
                DMR-X acts as an OpenAI-compatible proxy for Claude Code. Set{' '}
                <code className="font-mono bg-surface-2 px-1 rounded">ANTHROPIC_BASE_URL</code> to
                your gateway URL, and Claude Code will route requests through your configured
                providers with automatic fallback, rate limiting, and cost tracking.
              </p>
            </div>
          </div>
        </div>
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
