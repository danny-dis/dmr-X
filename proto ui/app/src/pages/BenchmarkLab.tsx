import { useBenchmarkResults } from '@/hooks/useApiData';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Trophy, TrendingDown, TrendingUp, Activity } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export default function BenchmarkLab() {
  const { benchmarks: benchmarkResults, error } = useBenchmarkResults();
  // Group by benchmark name
  const byBenchmark = benchmarkResults.reduce(
    (acc, bm) => {
      if (!acc[bm.benchmarkName]) acc[bm.benchmarkName] = [];
      acc[bm.benchmarkName].push(bm);
      return acc;
    },
    {} as Record<string, typeof benchmarkResults>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Benchmark Lab</h1>
          <p className="text-xs text-[#595962] mt-0.5">Model performance evaluation and regression detection</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1A1A20] rounded-md border border-[#27272E]">
          <Activity className="w-3.5 h-3.5 text-[#00FFB2]" />
          <span className="text-[11px] text-[#00FFB2] font-mono-data">9 benchmarks run</span>
        </div>
      </div>

      <ErrorBanner error={error} />

      {/* Benchmark Groups */}
      {Object.entries(byBenchmark).map(([name, results]) => (
        <div key={name} className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#F8F9FC]">{name} Leaderboard</h3>
            <span className="text-[11px] text-[#595962] font-mono-data">{results[0]?.taskType}</span>
          </div>

          {/* Chart */}
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={results} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#27272E" />
              <XAxis type="number" stroke="#595962" tick={{ fontSize: 11, fill: '#595962' }} domain={[0, 100]} />
              <YAxis dataKey="modelName" type="category" stroke="#A6A6B0" tick={{ fontSize: 11, fill: '#A6A6B0' }} width={100} />
              <Tooltip
                contentStyle={{ background: '#0F0F12', border: '1px solid #27272E', borderRadius: '8px', fontSize: '12px' }}
                formatter={(value: number) => [`${value}%`, 'Score']}
              />
              <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                {results.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.regression ? '#FF4D6A' : '#00FFB2'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Table */}
          <table className="w-full mt-4">
            <thead>
              <tr className="text-[10px] text-[#595962] uppercase tracking-wider">
                <th className="text-left pb-2 font-medium">Model</th>
                <th className="text-left pb-2 font-medium">Score</th>
                <th className="text-left pb-2 font-medium">Previous</th>
                <th className="text-left pb-2 font-medium">Change</th>
                <th className="text-left pb-2 font-medium">Latency</th>
                <th className="text-left pb-2 font-medium">Cost</th>
                <th className="text-left pb-2 font-medium">Regression</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272E]/30">
              {results
                .sort((a, b) => b.score - a.score)
                .map((bm, i) => (
                  <tr key={bm.id} className="hover:bg-[#1A1A20] transition-colors">
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        {i === 0 && <Trophy className="w-3.5 h-3.5 text-[#F7A51C]" />}
                        <span className="text-xs text-[#F8F9FC] font-medium">{bm.modelName}</span>
                      </div>
                    </td>
                    <td className="py-2 text-sm font-semibold text-[#00FFB2] font-mono-data">{bm.score}%</td>
                    <td className="py-2 text-[11px] text-[#595962] font-mono-data">{bm.previousScore}%</td>
                    <td className="py-2">
                      <span className={cn(
                        'text-[11px] font-mono-data font-semibold',
                        bm.score >= (bm.previousScore || 0) ? 'text-[#00FFB2]' : 'text-[#FF4D6A]'
                      )}>
                        {bm.score >= (bm.previousScore || 0) ? '+' : ''}{(bm.score - (bm.previousScore || 0)).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2 text-[11px] text-[#595962] font-mono-data">{bm.latency}ms</td>
                    <td className="py-2 text-[11px] text-[#F7A51C] font-mono-data">${bm.cost.toFixed(2)}</td>
                    <td className="py-2">
                      {bm.regression ? (
                        <span className="flex items-center gap-1 text-[11px] text-[#FF4D6A]">
                          <TrendingDown className="w-3 h-3" /> Yes
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] text-[#00FFB2]">
                          <TrendingUp className="w-3 h-3" /> No
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

          {/* Comparison scores if available */}
          {results.some((r) => r.comparisonScores) && (
            <div className="mt-3 pt-3 border-t border-[#27272E]">
              <h4 className="text-[11px] font-semibold text-[#F8F9FC] mb-2">A/B Comparison</h4>
              {results
                .filter((r) => r.comparisonScores)
                .map((r) => (
                  <div key={r.id} className="flex items-center gap-4">
                    {Object.entries(r.comparisonScores || {}).map(([model, score]) => (
                      <div key={model} className="flex items-center gap-1.5">
                        <span className="text-[11px] text-[#595962]">{model}:</span>
                        <span className="text-[11px] font-mono-data text-[#A6A6B0]">{score}%</span>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
