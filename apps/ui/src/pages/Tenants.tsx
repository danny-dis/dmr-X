import * as React from 'react';
import { Users, Plus, Search, KeyRound, Shield, Mail, Calendar, Save } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Input } from '@/components/primitives/Input';
import { Button } from '@/components/primitives/Button';
import { Badge } from '@/components/primitives/Badge';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Switch } from '@/components/primitives/Switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { toast } from '@/components/primitives/Toast';
import { ApiKeyCard } from '@/components/domain/ApiKeyCard';
import { CreateTenantDialog } from '@/components/domain/CreateTenantDialog';
import { CreateApiKeyDialog } from '@/components/domain/CreateApiKeyDialog';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatNumber, timeAgo } from '@/lib/formatters';
import type { ApiTenant, ApiKey } from '@/types/api';

export function TenantsPage() {
  const [query, setQuery] = React.useState('');
  const [selectedTenant, setSelectedTenant] = React.useState<string | null>(null);
  const [createTenantOpen, setCreateTenantOpen] = React.useState(false);
  const [createKeyOpen, setCreateKeyOpen] = React.useState(false);

  const tenants = useApiData<ApiTenant[]>(() => Admin.listTenants(), [], { refetchInterval: 15000 });
  const keys = useApiData<ApiKey[]>(
    () => Admin.listApiKeys().then(allKeys => allKeys.filter(k => k.tenant_id === selectedTenant)),
    [selectedTenant],
    { enabled: !!selectedTenant, refetchInterval: 15000 }
  );

  React.useEffect(() => {
    if (!selectedTenant && tenants.data && tenants.data.length > 0) {
      setSelectedTenant(tenants.data[0].id);
    }
  }, [tenants.data, selectedTenant]);

  const [settingsName, setSettingsName] = React.useState('');
  const [settingsEmail, setSettingsEmail] = React.useState('');
  const [settingsTier, setSettingsTier] = React.useState('free');
  const [settingsSuspended, setSettingsSuspended] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (selected) {
      setSettingsName(selected.name ?? '');
      setSettingsEmail(selected.email ?? '');
      setSettingsTier(selected.tier ?? 'free');
      setSettingsSuspended(selected.suspended ?? false);
    }
  }, [selected]);

  const saveSettings = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await Admin.updateTenant(selected.id, {
        name: settingsName,
        email: settingsEmail || undefined,
        tier: settingsTier,
        suspended: settingsSuspended,
      });
      toast.success('Tenant updated');
      void tenants.refetch();
    } catch (err) {
      toast.error('Failed to update tenant', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const filtered = (tenants.data ?? []).filter((t) =>
    query ? `${t.name} ${t.email ?? ''}`.toLowerCase().includes(query.toLowerCase()) : true
  );
  const selected = (tenants.data ?? []).find((t) => t.id === selectedTenant);

  return (
    <PageContainer>
      <PageHeader
        title="Tenants"
        description="Manage tenants, API keys, and access scopes"
        icon={<Users className="size-5" />}
        actions={
          <Button size="sm" onClick={() => setCreateTenantOpen(true)}>
            <Plus className="size-3" />
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
              prefix={<Search className="size-3.5" />}
              size="sm"
            />
          </div>
          <div className="p-1 max-h-[600px] overflow-y-auto">
            {tenants.isLoading ? (
              <div className="p-2 flex flex-col gap-1.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : filtered.length > 0 ? (
              filtered.map((t) => (
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
                      {t.tier ?? 'free'} · {formatNumber(t.tokensUsed ?? 0, true)} tokens
                    </p>
                  </div>
                  <StatusPill
                    status={t.suspended ? 'offline' : 'online'}
                    size="sm"
                    showDot={false}
                  />
                </button>
              ))
            ) : (
              <p className="p-6 text-center text-fg-subtle text-xs">No tenants</p>
            )}
          </div>
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
                            <Mail className="size-2.5" />
                            {selected.email}
                          </span>
                        )}
                        {selected.createdAt && (
                          <span className="flex items-center gap-1">
                            <Calendar className="size-2.5" />
                            {timeAgo(selected.createdAt)}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm">
                      <Shield className="size-3" />
                      Edit
                    </Button>
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
                      <Plus className="size-3" />
                      New key
                    </Button>
                  </div>
                  {keys.isLoading ? (
                    <div className="grid grid-cols-1 gap-2">
                      {Array.from({ length: 2 }).map((_, i) => (
                        <Skeleton key={i} className="h-20 w-full" />
                      ))}
                    </div>
                  ) : keys.data && keys.data.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {keys.data.map((k) => (
                        <ApiKeyCard
                          key={k.id}
                          apiKey={k}
                          onRevoke={async (id) => {
                            if (confirm('Are you sure you want to revoke this API key?')) {
                              await Admin.revokeApiKey(id);
                              toast.success('API key revoked');
                              void keys.refetch();
                            }
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border p-8 text-center">
                      <KeyRound className="size-5 text-fg-subtle mx-auto mb-2" />
                      <p className="text-sm text-fg-muted">No API keys yet</p>
                      <p className="text-[10px] text-fg-subtle mt-1">Create one to start using the gateway</p>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="usage" className="px-3 pb-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-[10px] text-fg-muted uppercase tracking-wider">Tokens</p>
                      <p className="text-lg font-semibold text-fg mt-1">
                        {formatNumber(selected.tokensUsed ?? 0, true)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-[10px] text-fg-muted uppercase tracking-wider">Requests</p>
                      <p className="text-lg font-semibold text-fg mt-1">
                        {formatNumber(selected.requestsUsed ?? 0, true)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-[10px] text-fg-muted uppercase tracking-wider">Cost</p>
                      <p className="text-lg font-semibold text-fg mt-1">
                        ${(selected.costUsed ?? 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="settings" className="px-3 pb-3">
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider block mb-1">Name</label>
                      <Input
                        value={settingsName}
                        onChange={(e) => setSettingsName(e.target.value)}
                        placeholder="Tenant name"
                        size="sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider block mb-1">Email</label>
                      <Input
                        type="email"
                        value={settingsEmail}
                        onChange={(e) => setSettingsEmail(e.target.value)}
                        placeholder="tenant@example.com"
                        size="sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider block mb-1">Tier</label>
                      <Select value={settingsTier} onValueChange={setSettingsTier}>
                        <SelectTrigger size="sm" className="w-full">
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
                          <p className="text-fg tabular-nums">{formatNumber(selected.tokensUsed ?? 0, true)} / {formatNumber(selected.tokensLimit ?? 0, true)}</p>
                        </div>
                        <div>
                          <p className="text-fg-subtle">Requests</p>
                          <p className="text-fg tabular-nums">{formatNumber(selected.requestsUsed ?? 0, true)} / {formatNumber(selected.requestsLimit ?? 0, true)}</p>
                        </div>
                        <div>
                          <p className="text-fg-subtle">Cost</p>
                          <p className="text-fg tabular-nums">${(selected.costUsed ?? 0).toFixed(2)} / ${(selected.costLimit ?? 0).toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-fg">Suspended</p>
                        <p className="text-[10px] text-fg-muted">Block all API access for this tenant</p>
                      </div>
                      <Switch
                        checked={settingsSuspended}
                        onCheckedChange={setSettingsSuspended}
                      />
                    </div>
                    <Button onClick={saveSettings} loading={saving} leftIcon={<Save className="size-3" />}>
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
    </PageContainer>
  );
}
