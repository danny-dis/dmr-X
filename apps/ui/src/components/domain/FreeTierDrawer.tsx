import {
  Zap,
  Globe,
  ExternalLink,
  KeyRound,
  Activity,
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
import { Progress } from '@/components/primitives/Progress';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Switch } from '@/components/primitives/Switch';
import { toast } from '@/components/primitives/Toast';
import { Admin } from '@/lib/admin';
import { formatDateTime, formatDuration, formatNumber } from '@/lib/formatters';
import { maskKey } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ApiProvider, ApiCatalogEntry } from '@/types/api';

export interface FreeTierDrawerProps {
  provider: ApiCatalogEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
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

export function FreeTierDrawer({ provider, open, onOpenChange, onCreated }: FreeTierDrawerProps) {
  const [testing, setTesting] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setTesting(false);
    }
  }, [open]);

  if (!provider) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent side="right" size="lg">
          <DrawerHeader>
            <DrawerTitle>Free Provider</DrawerTitle>
            <DrawerDescription>No provider selected</DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            <div className="text-xs text-fg-muted">Select a free provider to view details.</div>
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

  const freeModels = (provider.models ?? []).filter(
    (m) => (m as unknown as { freeTier?: unknown }).freeTier != null,
  );
  const totalModels = provider.models?.length ?? 0;

  const maxBudget = freeModels.reduce((sum, m) => {
    const ft = (m as unknown as { freeTier: { monthlyTokenBudget: number } }).freeTier;
    return sum + (ft?.monthlyTokenBudget ?? 0);
  }, 0);

  const avgIntelligence = freeModels.length > 0
    ? Math.round(freeModels.reduce((sum, m) => {
        const ft = (m as unknown as { freeTier: { intelligenceRank: number } }).freeTier;
        return sum + (ft?.intelligenceRank ?? 0);
      }, 0) / freeModels.length)
    : 0;

  const avgSpeed = freeModels.length > 0
    ? Math.round(freeModels.reduce((sum, m) => {
        const ft = (m as unknown as { freeTier: { speedRank: number } }).freeTier;
        return sum + (ft?.speedRank ?? 0);
      }, 0) / freeModels.length)
    : 0;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" size="lg">
        <DrawerHeader>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge tone="muted" size="sm" icon={<Zap className="size-2.5" />}>
              Free Tier
            </Badge>
            {provider.category && (
              <Badge tone="muted" size="sm">{provider.category}</Badge>
            )}
          </div>
          <DrawerTitle>{provider.name}</DrawerTitle>
          <DrawerDescription>
            {provider.description ?? provider.baseUrl ?? 'Free-tier provider configuration'}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="space-y-5">
          <section>
            <h3 className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Globe className="size-3" />
              Provider Info
            </h3>
            <div className="rounded-lg border border-border bg-surface-2/40 px-3">
              <MetaRow label="ID" value={provider.id} mono />
              <MetaRow label="Name" value={provider.name} />
              <MetaRow
                label="Base URL"
                value={provider.baseUrl ?? <Empty />}
                mono
              />
              <MetaRow
                label="Auth method"
                value={
                  provider.authMethod ? (
                    <Badge tone="muted" size="sm" icon={<KeyRound className="size-2.5" />}>
                      {provider.authMethod}
                    </Badge>
                  ) : (
                    <Empty />
                  )
                }
              />
              {provider.signupUrl && (
                <MetaRow
                  label="Signup"
                  value={
                    <a
                      href={provider.signupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                      {provider.signupUrl}
                      <ExternalLink className="size-3" />
                    </a>
                  }
                  mono
                />
              )}
              <MetaRow
                label="Models"
                value={
                  <span>
                    {freeModels.length} free / {totalModels} total
                  </span>
                }
              />
            </div>
          </section>

          {freeModels.length > 0 && (
            <section>
              <h3 className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Zap className="size-3" />
                Free Models
              </h3>
              <div className="rounded-lg border border-border bg-surface-2/40 px-3">
                {freeModels.slice(0, 5).map((model) => {
                  const ft = (model as unknown as {
                    freeTier: {
                      rateLimits: { rpm: number; rpd: number; tpm: number; tpd: number };
                      monthlyTokenBudget: number;
                      intelligenceRank: number;
                      speedRank: number;
                    };
                  }).freeTier;
                  return (
                    <div key={model.id} className="py-2 border-b border-border/60 last:border-b-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-fg">{model.id}</span>
                        <Badge tone="muted" size="sm">
                          {model.modality?.[0] ?? 'llm'}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[10px] text-fg-subtle">
                        {ft?.rateLimits?.rpm != null && ft.rateLimits.rpm > 0 && (
                          <span>RPM {formatNumber(ft.rateLimits.rpm)}</span>
                        )}
                        {ft?.rateLimits?.rpd != null && ft.rateLimits.rpd > 0 && (
                          <span>RPD {formatNumber(ft.rateLimits.rpd)}</span>
                        )}
                        {ft?.monthlyTokenBudget != null && ft.monthlyTokenBudget > 0 && (
                          <span>Budget {formatNumber(ft.monthlyTokenBudget)} tok</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {freeModels.length > 5 && (
                  <p className="text-[10px] text-fg-subtle py-2">
                    +{freeModels.length - 5} more free models
                  </p>
                )}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Activity className="size-3" />
              Aggregate Stats
            </h3>
            <div className="rounded-lg border border-border bg-surface-2/40 px-3">
              <MetaRow
                label="Intelligence"
                value={
                  <div className="flex items-center gap-2">
                    <Progress value={avgIntelligence * 10} tone="primary" size="sm" className="w-24" />
                    <span className="text-xs tabular-nums">{avgIntelligence}/10</span>
                  </div>
                }
              />
              <MetaRow
                label="Speed"
                value={
                  <div className="flex items-center gap-2">
                    <Progress value={avgSpeed * 10} tone="accent" size="sm" className="w-24" />
                    <span className="text-xs tabular-nums">{avgSpeed}/10</span>
                  </div>
                }
              />
              <MetaRow
                label="Budget"
                value={
                  maxBudget > 0
                    ? formatNumber(maxBudget) + ' tokens/mo'
                    : 'Rate-limited only'
                }
              />
            </div>
          </section>
        </DrawerBody>

        <DrawerFooter className="justify-between">
          <div className="flex items-center gap-2">
            {provider.signupUrl && (
              <Button
                variant="secondary"
                asChild
              >
                <a href={provider.signupUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-3.5" />
                  Get API Key
                </a>
              </Button>
            )}
          </div>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
