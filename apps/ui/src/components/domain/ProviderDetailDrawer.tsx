import {
  Boxes,
  Globe,
  KeyRound,
  Cpu,
  Hash,
  Calendar,
  Star,
  StarOff,
  Trash2,
  Zap,
  Server,
  CheckCircle2,
  Circle,
  Activity,
  Plus,
  RotateCw,
  Power,
  PowerOff,
  AlertCircle,
} from 'lucide-react';
import * as React from 'react';

import { AddKeyDialog } from '@/components/domain/AddKeyDialog';
import { TierBadge, KeyTierBadge } from '@/components/domain/TierBadge';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerFooter,
} from '@/components/primitives/Drawer';
import { Input } from '@/components/primitives/Input';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Switch } from '@/components/primitives/Switch';
import { toast } from '@/components/primitives/Toast';
import { Admin } from '@/lib/admin';
import { formatDateTime, formatDuration } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ApiProvider, ApiProviderKey } from '@/types/api';

export interface ProviderDetailDrawerProps {
  provider: ApiProvider | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
  onChanged?: () => void;
}

function MetaRow({
  label,
  value,
  mono = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 py-2 border-b border-border/60 last:border-b-0',
        className,
      )}
    >
      <div className="text-[11px] text-fg-subtle uppercase tracking-wider shrink-0 pt-0.5">
        {label}
      </div>
      <div
        className={cn(
          'text-xs text-fg text-right break-all min-w-0',
          mono && 'font-mono',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Empty({ children }: { children?: React.ReactNode }) {
  return <span className="text-fg-subtle">{children ?? '—'}</span>;
}

export function ProviderDetailDrawer({
  provider,
  open,
  onOpenChange,
  isFavorite = false,
  onToggleFavorite,
  onChanged,
}: ProviderDetailDrawerProps) {
  const [toggling, setToggling] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [apiKeyEditing, setApiKeyEditing] = React.useState(false);
  const [newApiKey, setNewApiKey] = React.useState('');
  const [updatingKey, setUpdatingKey] = React.useState(false);
  const [apiKeyVisible, setApiKeyVisible] = React.useState(false);

  // Per-key state for the multi-key section. We track which key is
  // currently being rotated (so the inline form knows which one to
  // PUT to) and which is being deleted (for the confirm step).
  const [rotatingKeyId, setRotatingKeyId] = React.useState<string | null>(null);
  const [rotatingKeyValue, setRotatingKeyValue] = React.useState('');
  const [rotatingKeySubmitting, setRotatingKeySubmitting] = React.useState(false);
  const [pendingDeleteKeyId, setPendingDeleteKeyId] = React.useState<string | null>(null);
  const [deletingKey, setDeletingKey] = React.useState(false);
  const [addKeyOpen, setAddKeyOpen] = React.useState(false);
  const [togglingKeyId, setTogglingKeyId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setToggling(false);
      setTesting(false);
      setRefreshing(false);
      setDeleting(false);
      setConfirmDelete(false);
      setApiKeyEditing(false);
      setNewApiKey('');
      setApiKeyVisible(false);
      setRotatingKeyId(null);
      setRotatingKeyValue('');
      setPendingDeleteKeyId(null);
      setAddKeyOpen(false);
      setTogglingKeyId(null);
    }
  }, [open]);

  const toggleEnabled = async () => {
    if (!provider) return;
    setToggling(true);
    const next = !provider.enabled;
    try {
      await Admin.updateProvider(provider.id, { enabled: next });
      toast.success(next ? 'Provider enabled' : 'Provider disabled');
      onChanged?.();
    } catch (err) {
      toast.error('Failed to update provider', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setToggling(false);
    }
  };

  const onTest = async () => {
    if (!provider) return;
    setTesting(true);
    try {
      const result = await Admin.testProvider(provider.id);
      if (result.ok) {
        toast.success(`Provider healthy · ${formatDuration(result.latencyMs)}`);
      } else {
        toast.error('Provider test failed', { description: result.error });
      }
    } catch (err) {
      toast.error('Test failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  const onRefreshModels = async () => {
    if (!provider) return;
    setRefreshing(true);
    try {
      const result = await Admin.testProvider(provider.id);
      if (result.ok) {
        toast.success('Provider connection verified', { description: 'Models will be auto-discovered on next health check.' });
      } else {
        toast.error('Connection test failed', { description: result.error });
      }
    } catch (err) {
      toast.error('Connection test failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRefreshing(false);
    }
  };

  const handleDelete = async () => {
    if (!provider) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await Admin.deleteProvider(provider.id);
      toast.success('Provider deleted', { description: provider.name });
      onChanged?.();
      onOpenChange(false);
    } catch (err) {
      toast.error('Failed to delete provider', {
        description: err instanceof Error ? err.message : String(err),
      });
      setDeleting(false);
    }
  };

  const handleUpdateApiKey = async () => {
    if (!provider) return;
    const trimmed = newApiKey.trim();
    if (!trimmed) {
      toast.error('API key is required');
      return;
    }
    setUpdatingKey(true);
    try {
      await Admin.updateProviderApiKey(provider.id, trimmed);
      toast.success('API key updated', { description: provider.name });
      setNewApiKey('');
      setApiKeyEditing(false);
      setApiKeyVisible(false);
      onChanged?.();
    } catch (err) {
      toast.error('Failed to update API key', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUpdatingKey(false);
    }
  };

  const cancelApiKeyEdit = () => {
    setApiKeyEditing(false);
    setNewApiKey('');
    setApiKeyVisible(false);
  };

  const handleRotateKey = async (key: ApiProviderKey) => {
    if (!provider) return;
    const trimmed = rotatingKeyValue.trim();
    if (!trimmed) {
      toast.error('API key is required');
      return;
    }
    setRotatingKeySubmitting(true);
    try {
      await Admin.rotateProviderKey(provider.id, key.id, { api_key: trimmed });
      toast.success('Key rotated', { description: key.label ?? key.id });
      setRotatingKeyId(null);
      setRotatingKeyValue('');
      onChanged?.();
    } catch (err) {
      toast.error('Failed to rotate key', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRotatingKeySubmitting(false);
    }
  };

  const handleToggleKey = async (key: ApiProviderKey) => {
    if (!provider) return;
    setTogglingKeyId(key.id);
    try {
      await Admin.rotateProviderKey(provider.id, key.id, { is_active: !key.is_active });
      toast.success(key.is_active ? 'Key deactivated' : 'Key activated', {
        description: key.label ?? key.id,
      });
      onChanged?.();
    } catch (err) {
      toast.error('Failed to update key', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTogglingKeyId(null);
    }
  };

  const handleDeleteKey = async (key: ApiProviderKey) => {
    if (!provider) return;
    if (pendingDeleteKeyId !== key.id) {
      setPendingDeleteKeyId(key.id);
      return;
    }
    setDeletingKey(true);
    try {
      await Admin.removeProviderKey(provider.id, key.id);
      toast.success('Key removed', { description: key.label ?? key.id });
      setPendingDeleteKeyId(null);
      onChanged?.();
    } catch (err) {
      toast.error('Failed to remove key', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeletingKey(false);
    }
  };

  if (!provider) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent side="right" size="lg">
          <DrawerHeader>
            <DrawerTitle>Provider</DrawerTitle>
            <DrawerDescription>No provider selected</DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            <div className="text-xs text-fg-muted">Select a provider to view its details.</div>
          </DrawerBody>
          <DrawerFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  const health = provider.health;
  // Health status from the API can be 'ok' | 'degraded' | 'down' | 'unknown'.
  // StatusPill accepts the more specific StatusKind union; map the API values
  // onto it so the pill renders a meaningful label/dot color.
  const healthStatus = (() => {
    const raw = health?.status ?? (provider.enabled ? 'online' : 'offline');
    if (raw === 'ok') return 'online' as const;
    if (raw === 'down') return 'offline' as const;
    if (raw === 'degraded') return 'degraded' as const;
    if (raw === 'unknown') return 'unknown' as const;
    return raw as 'online' | 'offline';
  })();
  const enabled = provider.enabled ?? true;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" size="lg">
        <DrawerHeader>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <StatusPill status={healthStatus} size="sm" showDot pulse />
            <TierBadge tier={provider.tier} size="md" />
            {provider.adapterType && (
              <Badge tone="muted" size="sm" icon={<Boxes className="size-2.5" />}>
                {provider.adapterType}
              </Badge>
            )}
            {provider.local && (
              <Badge tone="info" size="sm">local</Badge>
            )}
            {provider.priority != null && provider.priority > 0 && (
              <Badge tone="warning" size="sm" icon={<Zap className="size-2.5" />}>
                P{provider.priority}
              </Badge>
            )}
          </div>
          <DrawerTitle>{provider.name}</DrawerTitle>
          <DrawerDescription>
            {provider.description ?? provider.baseUrl ?? 'Provider configuration and health'}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="space-y-5">
          <section>
            <h3 className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Hash className="size-3" />
              Identity
            </h3>
            <div className="rounded-lg border border-border bg-surface-2/40 px-3">
              <MetaRow label="ID" value={provider.id} mono />
              <MetaRow label="Name" value={provider.name} />
              <MetaRow
                label="Adapter"
                value={provider.adapterType ?? <Empty />}
                mono
              />
              <MetaRow
                label="Region"
                value={provider.region ?? <Empty />}
              />
              {provider.category && (
                <MetaRow
                  label="Category"
                  value={
                    <Badge tone="muted" size="sm">
                      {Array.isArray(provider.category) ? provider.category.join(', ') : provider.category}
                    </Badge>
                  }
                />
              )}
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Globe className="size-3" />
              Endpoint
            </h3>
            <div className="rounded-lg border border-border bg-surface-2/40 px-3">
              <MetaRow
                label="Base URL"
                value={provider.baseUrl ?? <Empty />}
                mono
              />
              <MetaRow
                label="Auth method"
                value={
                  provider.authType ?? provider.authMethod ? (
                    <Badge tone="muted" size="sm" icon={<KeyRound className="size-2.5" />}>
                      {provider.authType ?? provider.authMethod}
                    </Badge>
                  ) : (
                    <Empty />
                  )
                }
              />
              <MetaRow
                label="API key ref"
                value={provider.apiKeyRef ?? <Empty />}
                mono
              />
            </div>
            {apiKeyEditing ? (
              <div className="mt-2 space-y-2">
                <Input
                  type={apiKeyVisible ? 'text' : 'password'}
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder="Paste new API key…"
                  autoComplete="off"
                  autoFocus
                />
                <div className="flex items-center gap-2 justify-end">
                  <label className="flex items-center gap-1.5 text-[10px] text-fg-muted cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={apiKeyVisible}
                      onChange={(e) => setApiKeyVisible(e.target.checked)}
                      className="size-3 accent-primary"
                    />
                    Show key
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={cancelApiKeyEdit}
                    disabled={updatingKey}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleUpdateApiKey}
                    loading={updatingKey}
                    disabled={updatingKey || !newApiKey.trim()}
                    leftIcon={<KeyRound className="size-3.5" />}
                  >
                    Save key
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2 w-full"
                onClick={() => setApiKeyEditing(true)}
                leftIcon={<KeyRound className="size-3.5" />}
              >
                {provider.apiKeyRef ? 'Rotate API key' : 'Set API key'}
              </Button>
            )}
            <p className="text-[10px] text-fg-subtle mt-1 ml-0.5">
              Stored encrypted on the gateway. The plaintext is never returned in list responses.
            </p>
          </section>

          {/*
            Multi-key section. We always render this — even when
            there's only the Default key — so the "Add another key"
            affordance is discoverable. The list collapses to nothing
            when the server hasn't reported any keys (older builds).
          */}
          {provider.keys && provider.keys.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider flex items-center gap-1.5">
                  <KeyRound className="size-3" />
                  API Keys
                  <span className="text-fg-subtle font-normal normal-case tracking-normal">
                    ({provider.keys.length})
                  </span>
                </h3>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setAddKeyOpen(true)}
                  leftIcon={<Plus className="size-3" />}
                >
                  Add another key
                </Button>
              </div>
              <div className="space-y-2">
                {provider.keys.map((key) => {
                  const isRotating = rotatingKeyId === key.id;
                  return (
                    <div
                      key={key.id}
                      className={cn(
                        'rounded-lg border border-border bg-surface-2/40 px-3 py-2.5',
                        !key.is_active && 'opacity-60',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-medium text-fg truncate">
                              {key.label ?? key.id.slice(0, 8)}
                            </span>
                            <KeyTierBadge tier={key.tier} />
                            {!key.is_active && (
                              <Badge tone="muted" size="sm">inactive</Badge>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-3 text-[10px] text-fg-subtle flex-wrap">
                            {key.masked_key_prefix && (
                              <span className="font-mono">{key.masked_key_prefix}</span>
                            )}
                            {key.auth_method && key.auth_method !== 'api_key' && (
                              <span>{key.auth_method}</span>
                            )}
                            {key.priority > 0 && (
                              <span>P{key.priority}</span>
                            )}
                            {key.last_used_at && (
                              <span>used {formatDateTime(key.last_used_at)}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          {key.has_api_key && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => {
                                if (isRotating) {
                                  setRotatingKeyId(null);
                                  setRotatingKeyValue('');
                                } else {
                                  setRotatingKeyId(key.id);
                                  setRotatingKeyValue('');
                                }
                              }}
                              aria-label={isRotating ? 'Cancel rotate' : 'Rotate key'}
                              title={isRotating ? 'Cancel' : 'Rotate key'}
                            >
                              <RotateCw className="size-3.5" />
                            </Button>
                          )}
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => void handleToggleKey(key)}
                            disabled={togglingKeyId === key.id}
                            aria-label={key.is_active ? 'Deactivate key' : 'Activate key'}
                            title={key.is_active ? 'Deactivate' : 'Activate'}
                          >
                            {key.is_active ? (
                              <Power className="size-3.5" />
                            ) : (
                              <PowerOff className="size-3.5" />
                            )}
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => {
                              if (pendingDeleteKeyId === key.id) {
                                setPendingDeleteKeyId(null);
                              } else {
                                setPendingDeleteKeyId(key.id);
                              }
                            }}
                            aria-label="Delete key"
                            title="Delete key"
                            className={cn(
                              pendingDeleteKeyId === key.id && 'text-danger',
                            )}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>

                      {isRotating && (
                        <div className="mt-2 space-y-2">
                          <Input
                            type="password"
                            value={rotatingKeyValue}
                            onChange={(e) => setRotatingKeyValue(e.target.value)}
                            placeholder="Paste new API key…"
                            autoComplete="off"
                            autoFocus
                          />
                          <div className="flex items-center gap-2 justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setRotatingKeyId(null);
                                setRotatingKeyValue('');
                              }}
                              disabled={rotatingKeySubmitting}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void handleRotateKey(key)}
                              loading={rotatingKeySubmitting}
                              disabled={rotatingKeySubmitting || !rotatingKeyValue.trim()}
                            >
                              Save new key
                            </Button>
                          </div>
                        </div>
                      )}

                      {pendingDeleteKeyId === key.id && (
                        <div className="mt-2 flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-2">
                          <AlertCircle className="size-3.5 text-danger shrink-0" />
                          <span className="text-[11px] text-danger flex-1">
                            Click delete again to confirm.
                          </span>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => void handleDeleteKey(key)}
                            disabled={deletingKey}
                            loading={deletingKey}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/*
            When the server hasn't reported any keys (very old build,
            or a keyless provider), still expose the "Add key" button
            so the operator can bootstrap the connection.
          */}
          {(!provider.keys || provider.keys.length === 0) && (
            <section>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => setAddKeyOpen(true)}
                leftIcon={<Plus className="size-3.5" />}
              >
                Add a key
              </Button>
            </section>
          )}

          {provider.capabilities && provider.capabilities.length > 0 && (
            <section>
              <h3 className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Cpu className="size-3" />
                Capabilities
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {provider.capabilities.map((c: Modality) => (
                  <Badge key={c} tone="primary" size="sm">
                    {c}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Activity className="size-3" />
              Health
            </h3>
            <div className="rounded-lg border border-border bg-surface-2/40 px-3">
              <MetaRow
                label="Status"
                value={<StatusPill status={healthStatus} size="sm" showDot pulse={false} />}
              />
              <MetaRow
                label="Latency"
                value={health?.latencyMs != null ? formatDuration(health.latencyMs) : <Empty />}
              />
              <MetaRow
                label="Last check"
                value={health?.lastCheckAt ? formatDateTime(health.lastCheckAt) : <Empty />}
              />
              {health?.errorMessage && (
                <MetaRow
                  label="Error"
                  value={<span className="text-danger text-[11px]">{health.errorMessage}</span>}
                />
              )}
              <MetaRow
                label="Models"
                value={provider.modelCount ?? provider.models?.length ?? 0}
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2 w-full"
              onClick={onRefreshModels}
              loading={refreshing}
              leftIcon={<Activity className="size-3.5" />}
            >
              Refresh models
            </Button>
            <p className="text-[10px] text-fg-subtle mt-1 ml-0.5">
              Tests connection &amp; schedules auto-discovery
            </p>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider flex items-center gap-1.5">
                <Server className="size-3" />
                Status
              </h3>
              <Switch
                checked={enabled}
                onCheckedChange={toggleEnabled}
                disabled={toggling}
                aria-label="Enabled"
              />
            </div>
            <div className="rounded-lg border border-border bg-surface-2/40 px-3">
              <MetaRow
                label="Enabled"
                value={
                  <div className="flex items-center gap-1.5">
                    {enabled ? (
                      <>
                        <CheckCircle2 className="size-3 text-success" />
                        <span>yes</span>
                      </>
                    ) : (
                      <>
                        <Circle className="size-3 text-fg-subtle" />
                        <span>no</span>
                      </>
                    )}
                  </div>
                }
              />
              {provider.createdAt && (
                <MetaRow
                  label="Created"
                  value={formatDateTime(provider.createdAt)}
                />
              )}
            </div>
          </section>
        </DrawerBody>

        <DrawerFooter className="justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant={confirmDelete ? 'danger' : 'ghost'}
              onClick={handleDelete}
              disabled={deleting}
              loading={deleting}
              leftIcon={<Trash2 className="size-3.5" />}
            >
              {confirmDelete ? 'Click again to confirm' : 'Delete'}
            </Button>
            {onToggleFavorite && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onToggleFavorite(provider.id)}
                aria-label={isFavorite ? 'Unfavorite' : 'Favorite'}
              >
                {isFavorite ? (
                  <Star className="size-3.5 text-warning fill-warning" />
                ) : (
                  <StarOff className="size-3.5" />
                )}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={onTest}
              loading={testing}
              leftIcon={<Activity className="size-3.5" />}
            >
              Test
            </Button>
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
