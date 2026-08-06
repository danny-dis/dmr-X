import { DollarSign, TrendingUp, TrendingDown, RefreshCw, PiggyBank } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';

import { BarSeriesChart } from '@/components/charts/BarSeriesChart';
import { PageHeader, PageContainer } from '@/components/layout';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { StatTile } from '@/components/primitives/StatTile';
import { chartColor } from '@/lib/chartPalette';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatters';
import { useCostDashboard, type CostDashboard } from '@/lib/queries/usage';
import { cn } from '@/lib/utils';

function isEmptyDashboard(d: CostDashboard): boolean {
  return (
    d.totalCost === 0 &&
    d.byTenant.length === 0 &&
    d.dailyCosts.length === 0 &&
    Object.keys(d.byProvider).length === 0
  );
}

export function CostDashboardPage() {
  const [days, setDays] = React.useState(30);
  const { data, isLoading, error, refetch } = useCostDashboard(days, { refetchInterval: 60000 });

  return (
    <PageContainer>
      <PageHeader
        title="Cost Dashboard"
        description="Monitor costs, free-tier savings, and usage across tenants and providers."
        actions={
          <div className="flex items-center gap-2">
            <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v, 10))}>
              <SelectTrigger size="sm" className="w-36" aria-label="Date range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              loading={isLoading && data != null}
              leftIcon={<RefreshCw className="size-3.5" />}
            >
              Refresh
            </Button>
          </div>
        }
      />

      <div className="mt-6">
        <DataState
          data={data}
          isLoading={isLoading}
          error={error}
          onRetry={refetch}
          skeletonRows={4}
          isEmpty={isEmptyDashboard}
          empty={{
            icon: <DollarSign />,
            title: 'No cost data yet',
            description:
              'Costs appear here once requests have been routed. Send a request from the playground or connect a provider to get started.',
            action: (
              <div className="flex items-center gap-2">
                <Button asChild variant="primary" size="sm">
                  <Link to="/playground/chat">Open playground</Link>
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <Link to="/connect">Connect a provider</Link>
                </Button>
              </div>
            ),
          }}
        >
          {(dashboard) => (
            <div className="space-y-6">
              {/* Cost Overview */}
              <Card padding="lg">
                <div className="flex items-center gap-2 mb-4">
                  <DollarSign className="size-5 text-success" aria-hidden />
                  <h3 className="text-lg font-semibold text-fg">Cost overview</h3>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatTile
                    icon={<DollarSign className="size-4" />}
                    label="Total cost"
                    value={formatCurrency(dashboard.totalCost)}
                    tone="default"
                  />
                  <StatTile
                    icon={<TrendingDown className="size-4" />}
                    label="Free-tier cost"
                    value={formatCurrency(dashboard.freeTierCost)}
                    tone="success"
                  />
                  <StatTile
                    icon={<TrendingUp className="size-4" />}
                    label="Paid cost"
                    value={formatCurrency(dashboard.paidCost)}
                    tone="warning"
                  />
                  <StatTile
                    icon={<PiggyBank className="size-4" />}
                    label="Cost savings"
                    value={formatCurrency(dashboard.costSavings)}
                    tone="accent"
                  />
                </div>
              </Card>

              {/* By Provider */}
              <Card padding="lg">
                <h3 className="text-lg font-semibold text-fg mb-4">Cost by provider</h3>
                {Object.keys(dashboard.byProvider).length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 font-medium text-fg-muted">Provider</th>
                          <th className="text-right py-2 font-medium text-fg-muted">Cost</th>
                          <th className="text-right py-2 font-medium text-fg-muted">Requests</th>
                          <th className="text-right py-2 font-medium text-fg-muted">Tokens</th>
                          <th className="text-right py-2 font-medium text-fg-muted">Free %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(dashboard.byProvider).map(([provider, stats]) => (
                          <tr key={provider} className="border-b border-border last:border-0">
                            <td className="py-2 font-medium text-fg">{provider}</td>
                            <td className="py-2 text-right text-fg">{formatCurrency(stats.cost)}</td>
                            <td className="py-2 text-right text-fg">{formatNumber(stats.requests)}</td>
                            <td className="py-2 text-right text-fg">{formatNumber(stats.tokens)}</td>
                            <td className="py-2 text-right">
                              <span className={cn(
                                'font-medium',
                                stats.freePercent > 50 ? 'text-success' : 'text-fg-muted'
                              )}>
                                {formatPercent(stats.freePercent)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    size="sm"
                    title="No provider activity"
                    description="No requests have been routed to a provider in this date range."
                  />
                )}
              </Card>

              {/* By Tenant */}
              <Card padding="lg">
                <h3 className="text-lg font-semibold text-fg mb-4">Cost by tenant</h3>
                {dashboard.byTenant.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 font-medium text-fg-muted">Tenant</th>
                          <th className="text-right py-2 font-medium text-fg-muted">Total cost</th>
                          <th className="text-right py-2 font-medium text-fg-muted">Free tier</th>
                          <th className="text-right py-2 font-medium text-fg-muted">Paid</th>
                          <th className="text-right py-2 font-medium text-fg-muted">Requests</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.byTenant.map((tenant) => (
                          <tr key={tenant.tenantId} className="border-b border-border last:border-0">
                            <td className="py-2 font-medium text-fg">{tenant.tenantName}</td>
                            <td className="py-2 text-right text-fg">{formatCurrency(tenant.totalCost)}</td>
                            <td className="py-2 text-right text-success">{formatCurrency(tenant.freeTierCost)}</td>
                            <td className="py-2 text-right text-fg">{formatCurrency(tenant.paidCost)}</td>
                            <td className="py-2 text-right text-fg">{formatNumber(tenant.totalRequests)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    size="sm"
                    title="No tenant activity"
                    description="No requests have been attributed to a tenant in this date range."
                  />
                )}
              </Card>

              {/* Daily Costs */}
              <Card padding="lg">
                <h3 className="text-lg font-semibold text-fg mb-4">Daily costs</h3>
                {dashboard.dailyCosts.length > 0 ? (
                  <BarSeriesChart
                    data={dashboard.dailyCosts.map((day) => ({
                      date: day.date,
                      freeCost: day.free_cost,
                      paidCost: day.paid_cost,
                    }))}
                    bars={[
                      { key: 'freeCost', name: 'Free', color: chartColor('success') },
                      { key: 'paidCost', name: 'Paid', color: chartColor('warning') },
                    ]}
                    xKey="date"
                    height={256}
                    yFormatter={(n) => formatCurrency(n)}
                  />
                ) : (
                  <EmptyState
                    size="sm"
                    title="No daily cost history"
                    description="Daily cost breakdown will appear once requests have been routed in this range."
                  />
                )}
              </Card>
            </div>
          )}
        </DataState>
      </div>
    </PageContainer>
  );
}
