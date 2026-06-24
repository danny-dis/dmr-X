import {
  Database,
  Brain,
  Layers,
  Gauge,
  Eye,
  Wrench,
  Sparkles,
  Hash,
  Calendar,
  Trash2,
  CheckCircle2,
  Circle,
  Cpu,
} from 'lucide-react';
import * as React from 'react';

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
import { Switch } from '@/components/primitives/Switch';
import { toast } from '@/components/primitives/Toast';
import { ModalityBadge } from '@/icons/Modality';
import { Admin } from '@/lib/admin';
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
} from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ApiModel } from '@/types/api';

export interface ModelDetailDrawerProps {
  model: ApiModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}

interface CapabilityRow {
  key: keyof Pick<
    ApiModel,
    | 'supportsStreaming'
    | 'supportsVision'
    | 'supportsToolUse'
    | 'supportsReasoning'
    | 'supportsFunctionCall'
  >;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const CAPABILITIES: CapabilityRow[] = [
  {
    key: 'supportsStreaming',
    label: 'Streaming',
    description: 'Stream tokens as they are generated',
    icon: <Layers className="size-3.5" />,
  },
  {
    key: 'supportsVision',
    label: 'Vision',
    description: 'Accept image inputs alongside text',
    icon: <Eye className="size-3.5" />,
  },
  {
    key: 'supportsToolUse',
    label: 'Tool use',
    description: 'Invoke external tools and functions',
    icon: <Wrench className="size-3.5" />,
  },
  {
    key: 'supportsReasoning',
    label: 'Reasoning',
    description: 'Expose extended chain-of-thought output',
    icon: <Sparkles className="size-3.5" />,
  },
  {
    key: 'supportsFunctionCall',
    label: 'Function calling',
    description: 'Structured function-call outputs',
    icon: <Brain className="size-3.5" />,
  },
];

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
  return <span className="text-fg-subtle">—</span>;
}

export function ModelDetailDrawer({
  model,
  open,
  onOpenChange,
  onChanged,
}: ModelDetailDrawerProps) {
  const [saving, setSaving] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setSaving(null);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [open]);

  const updateCapability = async (
    key: CapabilityRow['key'],
    value: boolean,
  ) => {
    if (!model) return;
    setSaving(key);
    try {
      await Admin.updateModel(model.id, { [key]: value });
      toast.success(`${CAPABILITIES.find((c) => c.key === key)?.label} ${value ? 'enabled' : 'disabled'}`);
      onChanged?.();
    } catch (err) {
      toast.error('Failed to update model', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(null);
    }
  };

  const toggleActive = async () => {
    if (!model) return;
    const next = !(model.isActive ?? true);
    setSaving('isActive');
    try {
      await Admin.updateModel(model.id, { isActive: next });
      toast.success(next ? 'Model activated' : 'Model deactivated');
      onChanged?.();
    } catch (err) {
      toast.error('Failed to update model', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async () => {
    if (!model) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await Admin.deleteModel(model.id);
      toast.success('Model deleted', { description: model.name });
      setDeleting(false);
      onChanged?.();
      onOpenChange(false);
    } catch (err) {
      toast.error('Failed to delete model', {
        description: err instanceof Error ? err.message : String(err),
      });
      setDeleting(false);
    }
  };

  if (!model) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent side="right" size="lg">
          <DrawerHeader>
            <DrawerTitle>Model</DrawerTitle>
            <DrawerDescription>No model selected</DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            <div className="text-xs text-fg-muted">Select a model to view its details.</div>
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

  const isActive = model.isActive ?? true;
  const providerName = model.providerName ?? model.provider ?? model.providerId;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" size="lg">
        <DrawerHeader>
          <div className="flex items-center gap-2 mb-1">
            <Badge tone="muted" size="sm" icon={<Database className="size-2.5" />}>
              {providerName}
            </Badge>
            <ModalityBadge modality={model.modality} size={12} />
            <Badge
              tone={isActive ? 'success' : 'muted'}
              size="sm"
              icon={isActive ? <CheckCircle2 className="size-2.5" /> : <Circle className="size-2.5" />}
            >
              {isActive ? 'active' : 'inactive'}
            </Badge>
          </div>
          <DrawerTitle className="font-mono">{model.name}</DrawerTitle>
          <DrawerDescription>
            {model.displayName ?? 'Model configuration, capabilities, and pricing'}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="space-y-5">
          <section>
            <h3 className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Hash className="size-3" />
              Identity
            </h3>
            <div className="rounded-lg border border-border bg-surface-2/40 px-3 divide-y divide-border/0">
              <MetaRow label="ID" value={model.id} mono />
              <MetaRow label="Provider" value={providerName} />
              <MetaRow label="Provider ID" value={model.providerId} mono />
              <MetaRow label="Modality" value={<code className="text-xs">{model.modality}</code>} mono />
              <MetaRow
                label="Layer"
                value={model.intelligenceLayer ?? <Empty />}
              />
              <MetaRow
                label="Capability"
                value={model.capabilityTier ? (
                  <Badge tone="muted" size="sm">{model.capabilityTier}</Badge>
                ) : <Empty />}
              />
              <MetaRow
                label="Tier"
                value={model.tier ? <Badge tone="muted" size="sm">{model.tier}</Badge> : <Empty />}
              />
              {model.qualityScore != null && (
                <MetaRow
                  label="Quality"
                  value={
                    <div className="flex items-center gap-1.5">
                      <Gauge className="size-3 text-fg-muted" />
                      <span className="tabular-nums">{model.qualityScore.toFixed(2)}</span>
                    </div>
                  }
                />
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider flex items-center gap-1.5">
                <Cpu className="size-3" />
                Capabilities
              </h3>
              <Switch
                checked={isActive}
                onCheckedChange={toggleActive}
                disabled={saving === 'isActive'}
                aria-label="Active"
              />
            </div>
            <div className="rounded-lg border border-border bg-surface-2/40 divide-y divide-border/60">
              {CAPABILITIES.map((cap) => {
                const value = !!model[cap.key];
                const loading = saving === cap.key;
                return (
                  <label
                    key={cap.key}
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-2/60 transition-colors"
                  >
                    <div className="flex items-center justify-center size-7 rounded-md bg-surface-3 text-fg-muted shrink-0">
                      {cap.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-fg">{cap.label}</div>
                      <div className="text-[10px] text-fg-muted truncate">{cap.description}</div>
                    </div>
                    <Switch
                      checked={value}
                      onCheckedChange={(v) => updateCapability(cap.key, v)}
                      disabled={loading}
                      aria-label={cap.label}
                    />
                  </label>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Layers className="size-3" />
              Limits
            </h3>
            <div className="rounded-lg border border-border bg-surface-2/40 px-3">
              <MetaRow
                label="Context window"
                value={
                  model.contextWindow != null
                    ? formatNumber(model.contextWindow, true) + ' tokens'
                    : <Empty />
                }
              />
              <MetaRow
                label="Max output"
                value={
                  model.maxOutputTokens != null
                    ? formatNumber(model.maxOutputTokens, true) + ' tokens'
                    : <Empty />
                }
              />
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Brain className="size-3" />
              Pricing
            </h3>
            <div className="rounded-lg border border-border bg-surface-2/40 px-3">
              <MetaRow
                label="Input / 1k"
                value={
                  model.inputCostPer1k != null ? (
                    formatCurrency(model.inputCostPer1k)
                  ) : (
                    <Empty />
                  )
                }
              />
              <MetaRow
                label="Output / 1k"
                value={
                  model.outputCostPer1k != null ? (
                    formatCurrency(model.outputCostPer1k)
                  ) : (
                    <Empty />
                  )
                }
              />
              {model.costPerImage != null && (
                <MetaRow
                  label="Per image"
                  value={formatCurrency(model.costPerImage)}
                />
              )}
            </div>
          </section>

          {model.createdAt && (
            <section>
              <h3 className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Calendar className="size-3" />
                Metadata
              </h3>
              <div className="rounded-lg border border-border bg-surface-2/40 px-3">
                <MetaRow
                  label="Created"
                  value={formatDateTime(model.createdAt)}
                />
              </div>
            </section>
          )}
        </DrawerBody>

        <DrawerFooter className="justify-between">
          <Button
            variant={confirmDelete ? 'danger' : 'ghost'}
            onClick={handleDelete}
            disabled={deleting}
            loading={deleting}
            leftIcon={<Trash2 className="size-3.5" />}
          >
            {confirmDelete ? 'Click again to confirm' : 'Delete'}
          </Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
