import { useState } from 'react';
import { useTenants, useApiKeys } from '@/hooks/useApiData';
import StatusBadge from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Users, Search, Key, Globe } from 'lucide-react';

const planColors: Record<string, string> = {
  free: 'bg-[#595962]/10 text-[#595962]',
  pro: 'bg-[#00E0FF]/10 text-[#00E0FF]',
  enterprise: 'bg-[#F7A51C]/10 text-[#F7A51C]',
};

export default function Tenants() {
  const { tenants, error } = useTenants();
  const { keys: apiKeys } = useApiKeys();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);

  const filtered = tenants.filter((t) =>
    !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const detailTenant = tenants.find((t) => t.id === selectedTenant);
  const tenantKeys = apiKeys.filter((k) => k.tenantId === selectedTenant);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Tenants</h1>
          <p className="text-xs text-[#595962] mt-0.5">Tenant management and API key access</p>
        </div>
      </div>

      <ErrorBanner error={error} />

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 bg-[#0F0F12] border border-[#27272E] rounded-lg flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-[#595962]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tenants..."
            className="bg-transparent text-xs text-[#F8F9FC] placeholder-[#595962] outline-none flex-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Tenant List */}
        <div className="xl:col-span-1 space-y-2">
          {filtered.length === 0 ? (
            <div className="glass-card rounded-xl p-8 text-center">
              <Users className="w-8 h-8 text-[#595962] mx-auto mb-3" />
              <p className="text-xs text-[#595962]">No tenants found</p>
            </div>
          ) : (
            filtered.map((tenant) => (
              <div
                key={tenant.id}
                className={cn(
                  'glass-card rounded-xl p-4 cursor-pointer hover:border-[#F7A51C]/20 transition-all',
                  selectedTenant === tenant.id && 'border-[#F7A51C]/50 bg-[#F7A51C]/5'
                )}
                onClick={() => setSelectedTenant(selectedTenant === tenant.id ? null : tenant.id)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-[#F7A51C]/10 flex items-center justify-center">
                      <span className="text-sm font-bold text-[#F7A51C]">{tenant.name.charAt(0)}</span>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[#F8F9FC]">{tenant.name}</div>
                      <div className="text-[11px] text-[#595962] font-mono-data">{tenant.region}</div>
                    </div>
                  </div>
                  <StatusBadge status={tenant.status} />
                </div>

                <div className="flex items-center gap-3">
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize', planColors[tenant.plan])}>
                    {tenant.plan}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Detail Panel */}
        <div className="xl:col-span-2">
          {detailTenant ? (
            <div className="space-y-4">
              {/* Tenant Header */}
              <div className="glass-card rounded-xl p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-[#F7A51C]/10 flex items-center justify-center">
                      <span className="text-xl font-bold text-[#F7A51C]">{detailTenant.name.charAt(0)}</span>
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-[#F8F9FC]">{detailTenant.name}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize', planColors[detailTenant.plan])}>
                          {detailTenant.plan}
                        </span>
                        <StatusBadge status={detailTenant.status} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-[10px] text-[#595962] mb-1">Region</div>
                    <div className="text-xs text-[#F8F9FC] flex items-center gap-1">
                      <Globe className="w-3 h-3" /> {detailTenant.region}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#595962] mb-1">API Keys</div>
                    <div className="text-xs text-[#F8F9FC] flex items-center gap-1">
                      <Key className="w-3 h-3" /> {tenantKeys.length}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#595962] mb-1">Created</div>
                    <div className="text-xs text-[#F8F9FC]">
                      {new Date(detailTenant.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* API Keys */}
              <div className="glass-card rounded-xl p-5">
                <h4 className="text-sm font-semibold text-[#F8F9FC] mb-3">API Keys</h4>
                {tenantKeys.length === 0 ? (
                  <p className="text-xs text-[#595962]">No API keys for this tenant</p>
                ) : (
                  <div className="space-y-2">
                    {tenantKeys.map((key) => (
                      <div key={key.id} className="flex items-center justify-between p-3 bg-[#0A0A0C] rounded-lg">
                        <div>
                          <div className="text-xs text-[#F8F9FC]">{key.name}</div>
                          <div className="text-[10px] text-[#595962] font-mono-data">{key.key.substring(0, 20)}...</div>
                        </div>
                        <StatusBadge status={key.status} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="glass-card rounded-xl p-12 text-center">
              <Users className="w-10 h-10 text-[#595962] mx-auto mb-3" />
              <p className="text-sm text-[#595962]">Select a tenant to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
