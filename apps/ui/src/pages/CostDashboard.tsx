import { DollarSign, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { BarSeriesChart } from '@/components/charts/BarSeriesChart';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatTile } from '@/components/primitives/StatTile';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { chartColor } from '@/lib/chartPalette';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';

interface CostDashboardData {
  period: { start: string; end: string };
  totalCost: number;
  freeTierCost: number;
  paidCost: number;
  costSavings: number;
  byTenant: Array<{
    tenantId: string;
    tenantName: string;
    totalCost: number;
    freeTierCost: number;
    paidCost: number;
    totalRequests: number;
    totalOutputTokens: number;
  }>;
  byProvider: Record<string, {
    cost: number;
    requests: number;
    tokens: number;
    freePercent: number;
  }>;
  dailyCosts: Array<{
    date: string;
    cost: number;
    freeCost: number;
    paidCost: number;
  }>;
}

export function CostDashboardPage() {
  const [days, setDays] = React.useState(30);
  const { data, isLoading, refetch } = useApiData<CostDashboardData>(
    () => Admin.getCostDashboard<CostDashboardData>(days),
    [days],
    { refetchInterval: 60000 }
  );

  return (
    <PageContainer>
      <PageHeader
        title="Cost Dashboard"
        description="Monitor costs, free-tier savings, and usage across tenants and providers."
        actions={
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
              className="px-3 py-1 text-sm border rounded"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Cost Overview */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="h-5 w-5 text-success" />
              <h3 className="text-lg font-semibold">Cost Overview</h3>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatTile
                icon={<DollarSign className="h-4 w-4" />}
                label="Total Cost"
                value={formatCurrency(data.totalCost)}
                className="text-foreground"
              />
              <StatTile
                icon={<TrendingDown className="h-4 w-4" />}
                label="Free Tier Cost"
                value={formatCurrency(data.freeTierCost)}
                className="text-success"
              />
              <StatTile
                icon={<TrendingUp className="h-4 w-4" />}
                label="Paid Cost"
                value={formatCurrency(data.paidCost)}
                className="text-warning"
              />
              <StatTile
                icon={<DollarSign className="h-4 w-4" />}
                label="Cost Savings"
                value={formatCurrency(data.costSavings)}
                className="text-info"
              />
            </div>
          </Card>

          {/* By Provider */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Cost by Provider</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Provider</th>
                    <th className="text-right py-2">Cost</th>
                    <th className="text-right py-2">Requests</th>
                    <th className="text-right py-2">Tokens</th>
                    <th className="text-right py-2">Free %</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.byProvider).map(([provider, stats]) => (
                    <tr key={provider} className="border-b last:border-0">
                      <td className="py-2 font-medium">{provider}</td>
                      <td className="py-2 text-right">{formatCurrency(stats.cost)}</td>
                      <td className="py-2 text-right">{formatNumber(stats.requests)}</td>
                      <td className="py-2 text-right">{formatNumber(stats.tokens)}</td>
                      <td className="py-2 text-right">
                        <span className={cn(
                          'font-medium',
                          stats.freePercent > 50 ? 'text-success' : 'text-muted-foreground'
                        )}>
                          {stats.freePercent.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* By Tenant */}
          {data.byTenant.length > 0 && (
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Cost by Tenant</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Tenant</th>
                      <th className="text-right py-2">Total Cost</th>
                      <th className="text-right py-2">Free Tier</th>
                      <th className="text-right py-2">Paid</th>
                      <th className="text-right py-2">Requests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byTenant.map((tenant) => (
                      <tr key={tenant.tenantId} className="border-b last:border-0">
                        <td className="py-2 font-medium">{tenant.tenantName}</td>
                        <td className="py-2 text-right">{formatCurrency(tenant.totalCost)}</td>
                        <td className="py-2 text-right text-success">{formatCurrency(tenant.freeTierCost)}</td>
                        <td className="py-2 text-right">{formatCurrency(tenant.paidCost)}</td>
                        <td className="py-2 text-right">{formatNumber(tenant.totalRequests)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Daily Costs */}
          {data.dailyCosts.length > 0 && (
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Daily Costs</h3>
              <BarSeriesChart
                data={data.dailyCosts.map((day) => ({
                  date: day.date,
                  freeCost: day.freeCost,
                  paidCost: day.paidCost,
                }))}
                bars={[
                  { key: 'freeCost', name: 'Free', color: chartColor('success') },
                  { key: 'paidCost', name: 'Paid', color: chartColor('warning') },
                ]}
                xKey="date"
                height={256}
                yFormatter={(n) => formatCurrency(n)}
              />
            </Card>
          )}
        </div>
      ) : (
        <Card className="p-8 text-center">
          <DollarSign className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No Cost Data</h3>
          <p className="text-muted-foreground">
            Start routing requests to see cost data and savings.
          </p>
        </Card>
      )}
    </PageContainer>
  );
}
