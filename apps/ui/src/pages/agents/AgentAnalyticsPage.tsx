import { TrendingUp } from 'lucide-react';
import * as React from 'react';

import { BarSeriesChart } from '@/components/charts/BarSeriesChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { PageContainer, PageHeader } from '@/components/layout';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { StatTile } from '@/components/primitives/StatTile';
import { useUrlState } from '@/hooks/useUrlState';
import { useAgentAnalytics } from '@/lib/queries/agents';
import { categoricalColor, chartColor } from '@/lib/chartPalette';
import { formatCurrency, formatDuration, formatNumber } from '@/lib/formatters';

const RANGES = [
  { key: '1', label: 'Day' },
  { key: '7', label: 'Week' },
  { key: '30', label: 'Month' },
];

/**
 * Agent cost and usage.
 *
 * Backed by `/agents/analytics/costs`, which had to be added — the previous
 * page called it and it did not exist, so it rendered zeroes. It also had no
 * charts at all despite recharts being a dependency.
 */
export function AgentAnalyticsPage() {
  const [range, setRange] = useUrlState('range', '7');

  const from = React.useMemo(
    () => new Date(Date.now() - Number(range) * 24 * 60 * 60 * 1000).toISOString(),
    [range],
  );

  const { data, isLoading, error, refetch } = useAgentAnalytics(from);

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Agent Analytics"
        description="Executions, tokens and spend per agent definition."
        icon={<TrendingUp className="size-5 text-primary" />}
        actions={
          <div className="flex gap-1" role="group" aria-label="Date range">
            {RANGES.map((r) => (
              <Button
                key={r.key}
                size="sm"
                variant={range === r.key ? 'secondary' : 'ghost'}
                aria-pressed={range === r.key}
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Executions" value={formatNumber(data?.totals.executions ?? 0, true)} loading={isLoading} />
        <StatTile
          label="Tokens"
          value={formatNumber((data?.totals.inputTokens ?? 0) + (data?.totals.outputTokens ?? 0), true)}
          loading={isLoading}
        />
        <StatTile label="Cost" value={formatCurrency(data?.totals.costUsd ?? 0)} loading={isLoading} />
        <StatTile
          label="Errors"
          value={String(data?.totals.errorCount ?? 0)}
          tone={(data?.totals.errorCount ?? 0) > 0 ? 'danger' : 'default'}
          loading={isLoading}
        />
      </div>

      <DataState
        data={data}
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
        skeletonRows={4}
        isEmpty={(d) => d.items.length === 0}
        empty={{
          icon: <TrendingUp className="size-8" />,
          title: 'No agent runs in this period',
          description: 'Deploy an agent and talk to it — executions show up here.',
        }}
      >
        {(dashboard) => {
          const items = dashboard.items;
          return (
            <>
              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Cost by agent</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BarSeriesChart
                      data={items.map((i) => ({ name: i.agentName ?? 'Unknown', cost: i.costUsd }))}
                      xKey="name"
                      layout="vertical"
                      height={Math.max(200, items.length * 36)}
                      bars={[{ key: 'cost', name: 'Cost (USD)', color: chartColor('primary'), radius: [0, 3, 3, 0] }]}
                      xFormatter={(v) => formatCurrency(Number(v))}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Executions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DonutChart
                      data={items.slice(0, 8).map((i, idx) => ({
                        label: i.agentName ?? 'Unknown',
                        value: i.executions,
                        color: categoricalColor(idx),
                      }))}
                      centerLabel="runs"
                      centerValue={formatNumber(dashboard.totals.executions, true)}
                    />
                  </CardContent>
                </Card>
              </div>

              <Card className="mt-4">
                <CardHeader>
                  <CardTitle>Per agent</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-2xs uppercase tracking-wide text-fg-subtle">
                        <th scope="col" className="pb-2 font-medium">Agent</th>
                        <th scope="col" className="pb-2 text-right font-medium">Instances</th>
                        <th scope="col" className="pb-2 text-right font-medium">Runs</th>
                        <th scope="col" className="pb-2 text-right font-medium">Errors</th>
                        <th scope="col" className="pb-2 text-right font-medium">Tokens</th>
                        <th scope="col" className="pb-2 text-right font-medium">Avg time</th>
                        <th scope="col" className="pb-2 text-right font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {items.map((i) => (
                        <tr key={i.agentDefinitionId ?? i.agentName}>
                          <td className="py-2 text-fg">{i.agentName ?? 'Unknown'}</td>
                          <td className="py-2 text-right tabular-nums text-fg-muted">{formatNumber(i.instanceCount)}</td>
                          <td className="py-2 text-right tabular-nums text-fg-muted">{formatNumber(i.executions)}</td>
                          <td className={`py-2 text-right tabular-nums ${i.errorCount > 0 ? 'text-danger' : 'text-fg-muted'}`}>
                            {formatNumber(i.errorCount)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-fg-muted">
                            {formatNumber(i.totalTokens, true)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-fg-muted">
                            {formatDuration(i.avgDurationMs)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-fg">{formatCurrency(i.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          );
        }}
      </DataState>
    </PageContainer>
  );
}
