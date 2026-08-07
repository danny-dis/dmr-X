import { Users, Plus, Search, KeyRound, Mail, Calendar, Save, Trash2, Lock } from 'lucide-react';
import * as React from 'react';

import { ApiKeyCard } from '@/components/domain/ApiKeyCard';
import { CreateApiKeyDialog } from '@/components/domain/CreateApiKeyDialog';
import { CreateTenantDialog } from '@/components/domain/CreateTenantDialog';
import { PageHeader, PageContainer } from '@/components/layout';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/primitives/AlertDialog';
import { Badge } from '@/components/primitives/Badge';
import { Button, buttonVariants } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { interpretError } from '@/components/primitives/ErrorState';
import { Input } from '@/components/primitives/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Pagination } from '@/components/primitives/Pagination';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Switch } from '@/components/primitives/Switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { toast } from '@/components/primitives/Toast';
import { formatCurrency, formatNumber, timeAgo } from '@/lib/formatters';
import { useApiKeysForTenant, useDeleteTenant, useRevokeApiKey, useTenants, useUpdateTenant } from '@/lib/queries/tenants';
import type { ApiKey } from '@/types/api';

export function TenantsPage() {
  const [query, setQuery] = React.useState('');
  const [selectedTenant, setSelectedTenant] = React.useState<string | null>(null);
  const [createTenantOpen, setCreateTenantOpen] = React.useState(false);
  const [createKeyOpen, setCreateKeyOpen] = React.useState(false);
  const [currentPage, setCurrentPage] = React.useState(1);
  const PAGE_SIZE = 20;

  const tenants = useTenants({ refetchInterval: 15000 });

  const keys = useApiKeysForTenant(selectedTenant, { refetchInterval: 15000 });
  const updateTenant = useUpdateTenant();
  const deleteTenant = useDeleteTenant();
  const revokeApiKey = useRevokeApiKey();

  const [settingsName, setSettingsName] = React.useState('');
  const [settingsEmail, setSettingsEmail] = React.useState('');
  const [settingsTier, setSettingsTier] = React.useState('free');
  const [settingsSuspended, setSettingsSuspended] = React.useState(false);
  const saving = updateTenant.isPending;

  // Tenant delete: confirmed via AlertDialog, named after the specific tenant.
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const deletingTenant = deleteTenant.isPending;

  // API key revoke: confirmed via AlertDialog + optimistic remove from the local list.
  const [revokeTarget, setRevokeTarget] = React.useState<ApiKey | null>(null);
  const [optimisticallyHidden, setOptimisticallyHidden] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const filtered = (tenants.data ?? []).filter((t) =>
    query ? `${t.name} ${t.email ?? ''}`.toLowerCase().includes(query.toLowerCase()) : true
  );
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginatedData = React.useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  React.useEffect(() => { setCurrentPage(1); }, [query]);

  const selected = (tenants.data ?? []).find((t) => t.id === selectedTenant);

  // Keys for the selected tenant, minus any that we've optimistically removed.
  const visibleKeys = React.useMemo(
    () => (keys.data ?? []).filter((k) => !optimisticallyHidden.has(k.id)),
    [keys.data, optimisticallyHidden],
  );

  // A confirm dialog left open across a tenant switch would end up confirming
  // against the wrong tenant/key, so close both when the selection changes.
  React.useEffect(() => {
    setDeleteDialogOpen(false);
    setRevokeTarget(null);
  }, [selectedTenant]);

  React.useEffect(() => {
    if (!selectedTenant && tenants.data && tenants.data.length > 0) {
      setSelectedTenant(tenants.data[0].id);
    }
  }, [tenants.data, selectedTenant]);

  React.useEffect(() => {
    if (selected) {
      setSettingsName(selected.name ?? '');
      setSettingsEmail(selected.email ?? '');
      setSettingsTier(selected.tier ?? 'free');
      setSettingsSuspended(selected.suspended ?? false);
    }
  }, [selected]);

  const handleDeleteTenant = async () => {
    if (!selected) return;
    try {
      await deleteTenant.mutateAsync(selected.id);
      toast.success('Tenant deleted', { description: selected.name });
      setSelectedTenant(null);
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setDeleteDialogOpen(false);
    }
  };

  const handleRevokeKey = async () => {
    if (!revokeTarget) return;
    const target = revokeTarget;
    // Optimistic remove so the card disappears immediately.
    setOptimisticallyHidden((prev) => {
      const next = new Set(prev);
      next.add(target.id);
      return next;
    });
    try {
      await revokeApiKey.mutateAsync(target.id);
      toast.success('API key revoked', { description: target.name });
      setRevokeTarget(null);
    } catch (err) {
      // Restore on failure.
      setOptimisticallyHidden((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    }
  };

  const saveSettings = async () => {
    if (!selected) return;
    try {
      await updateTenant.mutateAsync({
        id: selected.id,
        name: settingsName,
        email: settingsEmail || undefined,
        tier: settingsTier,
        suspended: settingsSuspended,
      });
      toast.success('Tenant updated', { description: settingsName });
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Tenants"
        description="Manage tenants, API keys, and access scopes"
        icon={<Users className="size-5" />}
        actions={
          <Button size="sm" onClick={() => setCreateTenantOpen(true)}>
            <Plus className="size-3" aria-hidden />
            New tenant
          </Button>
        }
      />

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card padding="none" className="lg:col-span-1">
          <div className="p-3 border-b border-border">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tenants…"
              prefix={<Search className="size-3.5" aria-hidden />}
              aria-label="Search tenants"
              size="sm"
            />
          </div>
          <div className="p-1 max-h-[600px] overflow-y-auto">
            <DataState
              data={filtered}
              isLoading={tenants.isLoading}
              error={tenants.error}
              onRetry={tenants.refetch}
              loading={
                <div className="p-2 flex flex-col gap-1.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              }
              empty={{
                icon: <Users className="size-6" />,
                title: query ? 'No matching tenants' : 'No tenants yet',
                description: query
                  ? 'Try a different search term.'
                  : 'Create a tenant to start issuing API keys.',
                action: query ? undefined : (
                  <Button size="sm" onClick={() => setCreateTenantOpen(true)} leftIcon={<Plus className="size-3" aria-hidden />}>
                    New tenant
                  </Button>
                ),
                size: 'sm',
              }}
            >
              {() => (
                <>
                  {paginatedData.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTenant(t.id)}
                      className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                        selectedTenant === t.id ? 'bg-primary/10' : 'hover:bg-surface-2'
                      }`}
                    >
                      <div className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-fg-muted text-xs font-semibold uppercase">
                        {t.name.slice(0, 2)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-fg truncate">{t.name}</p>
                        <p className="text-[10px] text-fg-muted">
                          {t.tier ?? 'free'} · {formatNumber(t.tokens_used ?? 0, true)} tokens
                        </p>
                      </div>
                      <StatusPill
                        status={t.suspended ? 'offline' : 'online'}
                        size="sm"
                        showDot={false}
                      />
                    </button>
                  ))}
                </>
              )}
            </DataState>
          </div>
          {totalPages > 1 && (
            <div className="p-3 border-t border-border">
              <Pagination
                page={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            </div>
          )}
        </Card>

        <div className="lg:col-span-2">
          {selected ? (
            <Card padding="none">
              <div className="p-5 border-b border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-white font-semibold uppercase">
                      {selected.name.slice(0, 2)}
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-fg">{selected.name}</h2>
                      <p className="text-xs text-fg-muted flex items-center gap-2 mt-0.5">
                        <Badge tone="primary" size="sm">{selected.tier ?? 'free'}</Badge>
                        {selected.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="size-2.5" aria-hidden />
                            {selected.email}
                          </span>
                        )}
                        {selected.createdAt && (
                          <span className="flex items-center gap-1">
                            <Calendar className="size-2.5" aria-hidden />
                            {timeAgo(selected.createdAt)}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const protectedTenant =
                        selected.name === 'default' || selected.name === 'local';
                      return (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDeleteDialogOpen(true)}
                          loading={deletingTenant}
                          disabled={protectedTenant}
                          title={
                            protectedTenant
                              ? `Cannot delete the "${selected.name}" tenant`
                              : 'Delete tenant'
                          }
                        >
                          {protectedTenant ? (
                            <Lock className="size-3" aria-hidden />
                          ) : (
                            <Trash2 className="size-3" aria-hidden />
                          )}
                          {protectedTenant ? 'Protected' : 'Delete'}
                        </Button>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <Tabs defaultValue="keys">
                <TabsList className="mx-3 mt-3">
                  <TabsTrigger value="keys">API Keys</TabsTrigger>
                  <TabsTrigger value="usage">Usage</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
                <TabsContent value="keys" className="px-3 pb-3">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-fg">API Keys</h3>
                    <Button size="sm" onClick={() => setCreateKeyOpen(true)}>
                      <Plus className="size-3" aria-hidden />
                      New key
                    </Button>
                  </div>
                  <DataState
                    data={visibleKeys}
                    isLoading={keys.isLoading}
                    error={keys.error}
                    onRetry={keys.refetch}
                    loading={
                      <div className="grid grid-cols-1 gap-2">
                        {Array.from({ length: 2 }).map((_, i) => (
                          <Skeleton key={i} className="h-20 w-full" />
                        ))}
                      </div>
                    }
                    empty={{
                      icon: <KeyRound className="size-8" />,
                      title: 'No API keys yet',
                      description: 'Create one to start using the gateway.',
                      action: (
                        <Button size="sm" onClick={() => setCreateKeyOpen(true)} leftIcon={<Plus className="size-3" aria-hidden />}>
                          New key
                        </Button>
                      ),
                    }}
                  >
                    {(list) => (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {list.map((k) => (
                          <ApiKeyCard
                            key={k.id}
                            apiKey={k}
                            onRevoke={(id) => {
                              const target = list.find((item) => item.id === id) ?? null;
                              setRevokeTarget(target);
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </DataState>
                </TabsContent>
                <TabsContent value="usage" className="px-3 pb-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-[10px] text-fg-muted uppercase tracking-wider">Tokens</p>
                      <p className="text-lg font-semibold text-fg mt-1">
                        {formatNumber(selected.tokens_used ?? 0, true)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-[10px] text-fg-muted uppercase tracking-wider">Requests</p>
                      <p className="text-lg font-semibold text-fg mt-1">
                        {formatNumber(selected.requests_used ?? 0, true)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-[10px] text-fg-muted uppercase tracking-wider">Cost</p>
                      <p className="text-lg font-semibold text-fg mt-1">
                        {formatCurrency(selected.cost_used ?? 0)}
                      </p>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="settings" className="px-3 pb-3">
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="tenant-name-input" className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider block mb-1">Name</label>
                      <Input
                        id="tenant-name-input"
                        value={settingsName}
                        onChange={(e) => setSettingsName(e.target.value)}
                        placeholder="Tenant name"
                        size="sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="tenant-email-input" className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider block mb-1">Email</label>
                      <Input
                        id="tenant-email-input"
                        type="email"
                        value={settingsEmail}
                        onChange={(e) => setSettingsEmail(e.target.value)}
                        placeholder="tenant@example.com"
                        size="sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="tenant-tier-select" className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider block mb-1">Tier</label>
                      <Select value={settingsTier} onValueChange={setSettingsTier}>
                        <SelectTrigger id="tenant-tier-select" size="sm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="free">Free</SelectItem>
                          <SelectItem value="starter">Starter</SelectItem>
                          <SelectItem value="pro">Pro</SelectItem>
                          <SelectItem value="enterprise">Enterprise</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="rounded-lg border border-border p-3 space-y-2">
                      <p className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider">Rate limits</p>
                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <p className="text-fg-subtle">Tokens</p>
                          <p className="text-fg tabular-nums">{formatNumber(selected.tokens_used ?? 0, true)} / {formatNumber(selected.tokens_limit ?? 0, true)}</p>
                        </div>
                        <div>
                          <p className="text-fg-subtle">Requests</p>
                          <p className="text-fg tabular-nums">{formatNumber(selected.requests_used ?? 0, true)} / {formatNumber(selected.requests_limit ?? 0, true)}</p>
                        </div>
                        <div>
                          <p className="text-fg-subtle">Cost</p>
                          <p className="text-fg tabular-nums">{formatCurrency(selected.cost_used ?? 0)} / {formatCurrency(selected.cost_limit ?? 0)}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <label htmlFor="tenant-suspended-switch" className="text-sm text-fg cursor-pointer">Suspended</label>
                        <p className="text-[10px] text-fg-muted">Block all API access for this tenant</p>
                      </div>
                      <Switch
                        id="tenant-suspended-switch"
                        checked={settingsSuspended}
                        onCheckedChange={setSettingsSuspended}
                      />
                    </div>
                    <Button onClick={saveSettings} loading={saving} leftIcon={<Save className="size-3" aria-hidden />}>
                      Save
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </Card>
          ) : (
            <Card padding="md">
              <p className="text-fg-muted text-sm">Select a tenant to view details</p>
            </Card>
          )}
        </div>
      </div>

      <CreateTenantDialog
        open={createTenantOpen}
        onOpenChange={setCreateTenantOpen}
        onCreated={async (tenantId) => {
          // Clear the search so the new tenant is always visible after creation.
          setQuery('');
          await tenants.refetch();
          setSelectedTenant(tenantId);
        }}
      />

      <CreateApiKeyDialog
        open={createKeyOpen}
        onOpenChange={setCreateKeyOpen}
        tenantId={selectedTenant}
        tenantName={selected?.name}
        onCreated={() => void keys.refetch()}
      />

      {/* Delete tenant confirm — names the tenant, never window.confirm. */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the tenant "{selected?.name}" and revokes all of its API
              keys. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'danger' })}
              onClick={() => void handleDeleteTenant()}
            >
              Delete tenant
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke API key confirm — names the key, never window.confirm. */}
      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {revokeTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Any application using the key "{revokeTarget?.name}" will immediately lose access.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'danger' })}
              onClick={() => void handleRevokeKey()}
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
