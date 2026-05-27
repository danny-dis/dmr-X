import { useFederationNodes } from '@/hooks/useApiData';
import { Globe, Construction } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function Federation() {
  const { nodes: federationNodes, error } = useFederationNodes();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Federation</h1>
          <p className="text-xs text-[#595962] mt-0.5">Cross-node benchmark sharing and federated learning</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1A1A20] rounded-md border border-[#27272E]">
          <Globe className="w-3.5 h-3.5 text-[#00E0FF]" />
          <span className="text-[11px] text-[#00E0FF] font-mono-data">{federationNodes.length} nodes</span>
        </div>
      </div>

      <ErrorBanner error={error} />

      {/* Coming Soon Banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#F7A51C]/10 border border-[#F7A51C]/30 rounded-lg">
        <Construction className="w-5 h-5 text-[#F7A51C] flex-shrink-0" />
        <div>
          <div className="text-xs font-medium text-[#F7A51C]">Coming Soon</div>
          <div className="text-[11px] text-[#F7A51C]/70">Federation is a planned feature for cross-node benchmark sharing and federated learning. This page shows mock data for preview purposes.</div>
        </div>
      </div>

      {/* Nodes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {federationNodes.map((node) => (
          <div key={node.id} className="glass-card rounded-xl p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#00E0FF]/10 flex items-center justify-center">
                  <Globe className="w-4 h-4 text-[#00E0FF]" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[#F8F9FC]">{node.name}</div>
                  <div className="text-[11px] text-[#595962] font-mono-data">{node.region}</div>
                </div>
              </div>
              <span className={cn(
                'text-[10px] px-2 py-0.5 rounded-full font-medium',
                node.status === 'synced' && 'bg-[#00FFB2]/10 text-[#00FFB2]',
                node.status === 'syncing' && 'bg-[#00E0FF]/10 text-[#00E0FF]',
                node.status === 'stale' && 'bg-[#F7A51C]/10 text-[#F7A51C]',
                node.status === 'offline' && 'bg-[#FF4D6A]/10 text-[#FF4D6A]',
              )}>
                {node.status}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-[#1A1A20] rounded p-2">
                <div className="text-[10px] text-[#595962]">Global Score</div>
                <div className="text-xs font-semibold text-[#F8F9FC] font-mono-data">{node.benchmarkSummary.globalScore}</div>
              </div>
              <div className="bg-[#1A1A20] rounded p-2">
                <div className="text-[10px] text-[#595962]">Local Score</div>
                <div className="text-xs font-semibold text-[#00E0FF] font-mono-data">{node.benchmarkSummary.localScore}</div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#595962]">Variance</span>
                <span className={cn(
                  'font-mono-data',
                  node.benchmarkSummary.variance > 1.5 ? 'text-[#FF4D6A]' : 'text-[#A6A6B0]'
                )}>{node.benchmarkSummary.variance}%</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#595962]">Anonymized Updates</span>
                <span className="text-[#A6A6B0] font-mono-data">{node.anonymizedUpdates.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#595962]">Privacy Level</span>
                <span className="text-[#A6A6B0]">{node.privacyLevel}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#595962]">Last Sync</span>
                <span className="text-[#595962] font-mono-data">{new Date(node.lastSync).toLocaleTimeString()}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Comparison Chart */}
      <div className="glass-card rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[#F8F9FC] mb-4">Global vs Local Scores</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={federationNodes}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272E" />
            <XAxis dataKey="region" stroke="#595962" tick={{ fontSize: 11, fill: '#A6A6B0' }} />
            <YAxis stroke="#595962" tick={{ fontSize: 11, fill: '#595962' }} domain={[80, 100]} />
            <Tooltip
              contentStyle={{ background: '#0F0F12', border: '1px solid #27272E', borderRadius: '8px', fontSize: '12px' }}
            />
            <Bar dataKey="benchmarkSummary.globalScore" fill="#F7A51C" name="Global" radius={[4, 4, 0, 0]} />
            <Bar dataKey="benchmarkSummary.localScore" fill="#00E0FF" name="Local" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
