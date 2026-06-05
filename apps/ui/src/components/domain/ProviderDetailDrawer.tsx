import * as React from 'react';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerFooter,
} from '@/components/primitives/Drawer';
import { Button } from '@/components/primitives/Button';
import { Badge } from '@/components/primitives/Badge';
import { Switch } from '@/components/primitives/Switch';
import { StatusPill } from '@/components/primitives/StatusPill';
import { toast } from '@/components/primitives/Toast';
import { Admin } from '@/lib/admin';
import { formatDateTime, formatDuration } from '@/lib/formatters';
import type { ApiProvider, Modality } from '@/types/api';

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

  React.useEffect(() => {
    if (!open) {
      setToggling(false);
      setTesting(false);
      setRefreshing(false);
      setDeleting(false);
      setConfirmDelete(false);
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
  const healthStatus = health?.status ?? (provider.enabled ? 'online' : 'offline');
  const enabled = provider.enabled ?? true;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" size="lg">
        <DrawerHeader>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <StatusPill status={healthStatus} size="sm" showDot pulse />
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
          </section>

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
