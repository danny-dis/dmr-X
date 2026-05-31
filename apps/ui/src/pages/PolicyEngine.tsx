import { useState, useCallback } from 'react';
import { usePolicyRules, useTenants } from '@/hooks/useApiData';
import { createPolicy } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import { ShieldCheck, Search, Plus, Shield, DollarSign, Globe, Wrench, Filter, X } from 'lucide-react';

const typeIcons: Record<string, typeof ShieldCheck> = {
  provider_allow: ShieldCheck,
  provider_deny: Shield,
  model_allow: ShieldCheck,
  model_deny: Shield,
  cost_cap: DollarSign,
  modality_restriction: Filter,
  residency: Globe,
  tool_permission: Wrench,
};

const typeLabels: Record<string, string> = {
  provider_allow: 'Provider Allow',
  provider_deny: 'Provider Deny',
  model_allow: 'Model Allow',
  model_deny: 'Model Deny',
  cost_cap: 'Cost Cap',
  modality_restriction: 'Modality Restriction',
  residency: 'Data Residency',
  tool_permission: 'Tool Permission',
};

export default function PolicyEngine() {
  const { policies: policyRules, error, refetch } = usePolicyRules();
  const { tenants } = useTenants();
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    type: 'provider_allow' as string,
    target: '',
    action: 'allow' as string,
    tenant_id: '',
  });

  const filtered = policyRules.filter((p) =>
    !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = useCallback(async () => {
    if (!form.name || !form.target || !form.tenant_id) {
      setFormError('Name, target, and tenant are required');
      return;
    }
    try {
      setFormError(null);
      await createPolicy({
        name: form.name,
        type: form.type,
        target: form.target.split(',').map((t) => t.trim()).filter(Boolean),
        action: form.action,
        tenant_id: form.tenant_id,
      });
      setShowForm(false);
      setForm({ name: '', type: 'provider_allow', target: '', action: 'allow', tenant_id: '' });
      refetch();
    } catch (e: any) {
      setFormError(e.message || 'Failed to create policy');
    }
  }, [form, refetch]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Policy Engine</h1>
          <p className="text-xs text-[#595962] mt-0.5">Tenant policies, restrictions, and compliance rules</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-3 py-2 bg-[#F7A51C] text-[#060608] rounded-md text-xs font-semibold hover:bg-[#F7A51C]/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New Policy
        </button>
      </div>

      <ErrorBanner error={error} />

      {showForm && (
        <div className="glass-card rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#F8F9FC]">Create New Policy</h3>
            <button onClick={() => { setShowForm(false); setFormError(null); }} className="text-[#595962] hover:text-[#A6A6B0]">
              <X className="w-4 h-4" />
            </button>
          </div>
          {formError && <p className="text-xs text-red-400">{formError}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-[#595962] mb-1 block">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-sm text-[#F8F9FC] focus:outline-none focus:border-[#F7A51C]"
                placeholder="Policy name"
              />
            </div>
            <div>
              <label className="text-xs text-[#595962] mb-1 block">Tenant</label>
              <select
                value={form.tenant_id}
                onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
                className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-sm text-[#F8F9FC] focus:outline-none focus:border-[#F7A51C]"
              >
                <option value="">Select tenant...</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#595962] mb-1 block">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-sm text-[#F8F9FC] focus:outline-none focus:border-[#F7A51C]"
              >
                {Object.entries(typeLabels).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#595962] mb-1 block">Target (comma-separated)</label>
              <input
                value={form.target}
                onChange={(e) => setForm({ ...form, target: e.target.value })}
                className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-sm text-[#F8F9FC] focus:outline-none focus:border-[#F7A51C]"
                placeholder="openai, anthropic"
              />
            </div>
            <div>
              <label className="text-xs text-[#595962] mb-1 block">Action</label>
              <select
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
                className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-sm text-[#F8F9FC] focus:outline-none focus:border-[#F7A51C]"
              >
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
                <option value="redirect">Redirect</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 px-4 py-2 bg-[#F7A51C] text-[#060608] rounded-md text-xs font-semibold hover:bg-[#F7A51C]/90 transition-colors"
            >
              Create Policy
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 bg-[#0F0F12] border border-[#27272E] rounded-lg flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-[#595962]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search policies..."
            className="bg-transparent text-xs text-[#F8F9FC] placeholder-[#595962] outline-none flex-1"
          />
        </div>
      </div>

      {/* Policy Cards */}
      <div className="space-y-2">
        {filtered.map((rule) => {
          const Icon = typeIcons[rule.type] || ShieldCheck;
          return (
            <div key={rule.id} className="glass-card rounded-xl p-4 hover:border-[#F7A51C]/20 transition-all">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#F7A51C]/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4 text-[#F7A51C]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-[#F8F9FC]">{rule.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1A1A20] text-[#595962] font-mono-data">
                        P{rule.priority}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-[#595962]">
                      <span>{typeLabels[rule.type]}</span>
                      <span>•</span>
                      <span className={cn(
                        'font-medium',
                        rule.action === 'allow' && 'text-[#00FFB2]',
                        rule.action === 'deny' && 'text-[#FF4D6A]',
                        rule.action === 'redirect' && 'text-[#00E0FF]',
                      )}>
                        {rule.action.toUpperCase()}
                      </span>
                      <span>•</span>
                      <span>Targets: {rule.target.join(', ')}</span>
                    </div>
                    {rule.conditions && (
                      <div className="mt-1.5 text-[11px] text-[#A6A6B0] font-mono-data">
                        {Object.entries(rule.conditions).map(([k, v]) => `${k}: ${v}`).join(' | ')}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {rule.tenantId && (
                    <span className="text-[11px] text-[#595962]">
                      {tenants.find((t) => t.id === rule.tenantId)?.name || rule.tenantId}
                    </span>
                  )}
                  <span className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full font-medium',
                    rule.enabled ? 'bg-[#00FFB2]/10 text-[#00FFB2]' : 'bg-[#595962]/10 text-[#595962]'
                  )}>
                    {rule.enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
