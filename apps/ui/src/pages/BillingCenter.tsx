import { useBillingSummary } from '@/hooks/useApiData';
import {
  CreditCard, TrendingUp, AlertTriangle, Download, FileText,
  DollarSign, PieChart, BarChart3
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';

export default function BillingCenter() {
  const { billing: billingSummary, error } = useBillingSummary();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Billing Center</h1>
          <p className="text-xs text-[#595962] mt-0.5">Cost tracking, invoices, and usage analytics</p>
        </div>
        <button className="flex items-center gap-2 px-3 py-2 bg-[#F7A51C] text-[#060608] rounded-md text-xs font-semibold hover:bg-[#F7A51C]/90 transition-colors">
          <Download className="w-3.5 h-3.5" />
          Export Usage
        </button>
      </div>

      <ErrorBanner error={error} />

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-[#F7A51C]" />
            <span className="text-[11px] text-[#595962]">Current Month</span>
          </div>
          <div className="text-xl font-bold text-[#F8F9FC] font-mono-data">
            ${billingSummary.currentMonthSpend.toLocaleString('en', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-[#00E0FF]" />
            <span className="text-[11px] text-[#595962]">Est. End of Month</span>
          </div>
          <div className="text-xl font-bold text-[#00E0FF] font-mono-data">
            ${billingSummary.estimatedEndOfMonth.toLocaleString('en', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard className="w-4 h-4 text-[#00FFB2]" />
            <span className="text-[11px] text-[#595962]">Previous Month</span>
          </div>
          <div className="text-xl font-bold text-[#00FFB2] font-mono-data">
            ${billingSummary.previousMonthSpend.toLocaleString('en', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-[#F7A51C]" />
            <span className="text-[11px] text-[#595962]">Overages</span>
          </div>
          <div className="text-xl font-bold text-[#F7A51C]">{billingSummary.overageFlags.length}</div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cost by Provider */}
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#F8F9FC]">Cost by Provider</h3>
            <PieChart className="w-3.5 h-3.5 text-[#595962]" />
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={billingSummary.costByProvider} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#27272E" />
              <XAxis type="number" stroke="#595962" tick={{ fontSize: 11, fill: '#595962' }} />
              <YAxis dataKey="provider" type="category" stroke="#595962" tick={{ fontSize: 11, fill: '#A6A6B0' }} width={80} />
              <Tooltip
                contentStyle={{ background: '#0F0F12', border: '1px solid #27272E', borderRadius: '8px', fontSize: '12px' }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cost']}
              />
              <Bar dataKey="cost" fill="#F7A51C" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Cost by Model */}
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#F8F9FC]">Cost by Model</h3>
            <BarChart3 className="w-3.5 h-3.5 text-[#595962]" />
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={billingSummary.costByModel}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272E" />
              <XAxis dataKey="model" stroke="#595962" tick={{ fontSize: 10, fill: '#A6A6B0' }} angle={-20} textAnchor="end" height={50} />
              <YAxis stroke="#595962" tick={{ fontSize: 11, fill: '#595962' }} />
              <Tooltip
                contentStyle={{ background: '#0F0F12', border: '1px solid #27272E', borderRadius: '8px', fontSize: '12px' }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cost']}
              />
              <Bar dataKey="cost" fill="#00E0FF" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Cost by Modality + Invoices */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Modality */}
        <div className="glass-card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[#F8F9FC] mb-4">Cost by Modality</h3>
          <div className="space-y-3">
            {billingSummary.costByModality.map((mod) => {
              const maxCost = Math.max(...billingSummary.costByModality.map((m) => m.cost));
              const pct = (mod.cost / maxCost) * 100;
              return (
                <div key={mod.modality}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[#A6A6B0] capitalize">{mod.modality}</span>
                    <span className="text-[#F8F9FC] font-mono-data">${mod.cost.toFixed(2)}</span>
                  </div>
                  <div className="w-full h-2 bg-[#1A1A20] rounded-full overflow-hidden">
                    <div className="h-full bg-[#00E0FF] rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Invoices */}
        <div className="glass-card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-[#F8F9FC] mb-4">Invoices</h3>
          <div className="space-y-2">
            {billingSummary.invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between p-3 bg-[#0A0A0C] rounded-lg">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#595962]" />
                  <div>
                    <div className="text-xs text-[#F8F9FC] font-medium">{inv.period}</div>
                    <div className="text-[10px] text-[#595962]">
                      {inv.status === 'paid' ? `Paid ${inv.paidDate}` : `Due ${inv.dueDate}`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[#F8F9FC] font-mono-data">${inv.amount.toLocaleString('en', { minimumFractionDigits: 2 })}</span>
                  <span className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full font-medium',
                    inv.status === 'paid' && 'bg-[#00FFB2]/10 text-[#00FFB2]',
                    inv.status === 'pending' && 'bg-[#F7A51C]/10 text-[#F7A51C]',
                    inv.status === 'overdue' && 'bg-[#FF4D6A]/10 text-[#FF4D6A]',
                  )}>
                    {inv.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Plan Limits */}
      <div className="glass-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[#F8F9FC] mb-4">Plan Limits</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-[#595962]">Requests</span>
              <span className="text-[#F8F9FC] font-mono-data">{billingSummary.planLimits.requests ? `${(billingSummary.planLimits.requests / 1e6).toFixed(0)}M/mo` : 'Unlimited'}</span>
            </div>
            <div className="w-full h-2 bg-[#1A1A20] rounded-full overflow-hidden">
              <div className="h-full bg-[#F7A51C] rounded-full" style={{ width: '65%' }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-[#595962]">Tokens</span>
              <span className="text-[#F8F9FC] font-mono-data">{billingSummary.planLimits.tokens ? `${(billingSummary.planLimits.tokens / 1e6).toFixed(0)}M/mo` : 'Unlimited'}</span>
            </div>
            <div className="w-full h-2 bg-[#1A1A20] rounded-full overflow-hidden">
              <div className="h-full bg-[#FF4D6A] rounded-full" style={{ width: '78%' }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-[#595962]">Spend</span>
              <span className="text-[#F8F9FC] font-mono-data">{billingSummary.planLimits.spend != null ? `$${billingSummary.planLimits.spend.toLocaleString()}/mo` : 'Unlimited'}</span>
            </div>
            <div className="w-full h-2 bg-[#1A1A20] rounded-full overflow-hidden">
              <div className="h-full bg-[#00FFB2] rounded-full" style={{ width: '57%' }} />
            </div>
          </div>
        </div>
        {billingSummary.overageFlags.length > 0 && (
          <div className="mt-4 p-3 bg-[#F7A51C]/5 border border-[#F7A51C]/20 rounded-lg">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-[#F7A51C]" />
              <span className="text-xs text-[#F7A51C]">{billingSummary.overageFlags[0]}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
