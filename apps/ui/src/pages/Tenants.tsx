import { useState, useCallback } from 'react';
import { useTenants, useApiKeys } from '@/hooks/useApiData';
import StatusBadge from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Users, Search, Key, Globe, Plus, Trash2, Copy, Check, X, AlertTriangle } from 'lucide-react';

const planColors: Record<string, string> = {
  free: 'bg-[#595962]/10 text-[#595962]',
  pro: 'bg-[#00E0FF]/10 text-[#00E0FF]',
  enterprise: 'bg-[#F7A51C]/10 text-[#F7A51C]',
};

export default function Tenants() {
  const { tenants, error } = useTenants();
  const {
    keys: apiKeys,
    createKey,
    deleteKey,
    newKeyPlaintext,
    clearNewKey,
  } = useApiKeys();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Copy feedback
  const [copied, setCopied] = useState(false);

  const filtered = tenants.filter((t) =>
    !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const detailTenant = tenants.find((t) => t.id === selectedTenant);
  const tenantKeys = apiKeys.filter((k) => k.tenantId === selectedTenant);

  const handleCreateKey = useCallback(async () => {
    if (!selectedTenant) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createKey(selectedTenant, newKeyName || undefined);
      setNewKeyName('');
      setShowCreateForm(false);
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  }, [selectedTenant, newKeyName, createKey]);

  const handleCopyKey = useCallback(() => {
    if (newKeyPlaintext) {
      navigator.clipboard.writeText(newKeyPlaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [newKeyPlaintext]);

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
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-[#F8F9FC]">API Keys</h4>
                  <button
                    onClick={() => { setShowCreateForm(true); setCreateError(null); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F7A51C] text-[#060608] rounded-lg text-[11px] font-semibold hover:bg-[#F7A51C]/90 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Create Key
                  </button>
                </div>

                {/* Create Form */}
                {showCreateForm && (
                  <div className="mb-4 p-4 bg-[#0A0A0C] rounded-lg border border-[#27272E]">
                    <div className="flex items-center justify-between mb-3">
                      <h5 className="text-xs font-semibold text-[#F8F9FC]">New API Key</h5>
                      <button
                        onClick={() => { setShowCreateForm(false); setCreateError(null); setNewKeyName(''); }}
                        className="p-1 rounded hover:bg-[#1A1A20] transition-colors"
                      >
                        <X className="w-3 h-3 text-[#595962]" />
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        placeholder="Key name (optional)"
                        className="flex-1 px-3 py-2 bg-[#0F0F12] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] placeholder-[#595962] focus:outline-none focus:border-[#F7A51C]"
                      />
                      <button
                        onClick={handleCreateKey}
                        disabled={creating}
                        className="flex items-center gap-1.5 px-4 py-2 bg-[#F7A51C] text-[#060608] rounded-md text-xs font-semibold hover:bg-[#F7A51C]/90 transition-colors disabled:opacity-50"
                      >
                        {creating ? 'Creating...' : 'Create'}
                      </button>
                    </div>
                    {createError && (
                      <p className="text-[11px] text-[#FF4D6A] mt-2">{createError}</p>
                    )}
                  </div>
                )}

                {tenantKeys.length === 0 && !showCreateForm ? (
                  <p className="text-xs text-[#595962]">No API keys for this tenant</p>
                ) : (
                  <div className="space-y-2">
                    {tenantKeys.map((key) => (
                      <div key={key.id} className="flex items-center justify-between p-3 bg-[#0A0A0C] rounded-lg">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-[#F8F9FC]">{key.name}</div>
                          <div className="text-[10px] text-[#595962] font-mono-data">dmr-****...****</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={key.status} />
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <button className="p-1.5 rounded-lg hover:bg-[#FF4D6A]/10 text-[#595962] hover:text-[#FF4D6A] transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="bg-[#0F0F12] border-[#27272E]">
                              <AlertDialogHeader>
                                <AlertDialogTitle className="text-[#F8F9FC]">Revoke API Key</AlertDialogTitle>
                                <AlertDialogDescription className="text-[#595962]">
                                  Are you sure you want to revoke &quot;{key.name}&quot;? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="bg-[#1A1A20] text-[#A6A6B0] border-[#27272E] hover:bg-[#1A1A20]/80">
                                  Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteKey(key.id)}
                                  className="bg-[#FF4D6A] text-white hover:bg-[#FF4D6A]/90"
                                >
                                  Revoke
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
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

      {/* New Key Modal — "Key Shown Once" */}
      {newKeyPlaintext && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md bg-[#0F0F12] border border-[#27272E] rounded-2xl p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#F7A51C] to-[#FF4D6A]" />

            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-[#F7A51C]/10 flex items-center justify-center">
                <Key className="w-5 h-5 text-[#F7A51C]" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#F8F9FC]">API Key Created</h2>
                <p className="text-xs text-[#595962]">Save this key now — it will not be shown again</p>
              </div>
            </div>

            <div className="p-3 bg-[#0A0A0C] rounded-lg border border-[#27272E] mb-4">
              <div className="flex items-center justify-between gap-3">
                <code className="text-[11px] text-[#00FFB2] font-mono-data break-all select-all">
                  {newKeyPlaintext}
                </code>
                <button
                  onClick={handleCopyKey}
                  className="shrink-0 p-2 rounded-lg hover:bg-[#1A1A20] transition-colors"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-[#00FFB2]" />
                  ) : (
                    <Copy className="w-4 h-4 text-[#595962]" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-xl bg-[#F7A51C]/5 border border-[#F7A51C]/10 mb-5">
              <AlertTriangle className="w-4 h-4 text-[#F7A51C] shrink-0 mt-0.5" />
              <p className="text-[11px] text-[#A6A6B0]">
                This is the only time you will see this key. Copy it now and store it securely.
              </p>
            </div>

            <button
              onClick={() => { clearNewKey(); setCopied(false); }}
              className="w-full py-3 text-xs font-bold bg-[#F7A51C] text-black rounded-xl hover:bg-[#F7A51C]/90 shadow-lg shadow-[#F7A51C]/10 transition-all"
            >
              I&apos;ve saved my key
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
