import { BarChart3, TrendingUp, DollarSign, Bot } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useApiData } from '@/hooks/useApiData';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentCostSummary {
  agentInstanceId: string;
  agentName: string;
  totalExecutions: number;
  totalTokens: number;
  totalCostCents: number;
  avgCostPerExecution: number;
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  icon: Icon,
  description,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  description?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Agent Analytics Page
// ---------------------------------------------------------------------------

export function AgentAnalyticsPage() {
  const [timeRange, setTimeRange] = React.useState<'day' | 'week' | 'month'>('week');

  const getDateRange = () => {
    const now = new Date();
    const from = new Date(now);
    switch (timeRange) {
      case 'day': from.setDate(from.getDate() - 1); break;
      case 'week': from.setDate(from.getDate() - 7); break;
      case 'month': from.setMonth(from.getMonth() - 1); break;
    }
    return { from: from.toISOString(), to: now.toISOString() };
  };

  const range = getDateRange();
  const { data: costs, loading } = useApiData<{ items: AgentCostSummary[] }>(
    `/v1/agents/analytics/costs?from=${range.from}&to=${range.to}`
  );

  const agentCosts = costs?.items ?? [];

  // Calculate totals
  const totalExecutions = agentCosts.reduce((sum, a) => sum + a.totalExecutions, 0);
  const totalTokens = agentCosts.reduce((sum, a) => sum + a.totalTokens, 0);
  const totalCost = agentCosts.reduce((sum, a) => sum + a.totalCostCents, 0);

  return (
    <PageContainer>
      <PageHeader
        title="Agent Analytics"
        description="Monitor agent usage, costs, and performance"
        actions={
          <div className="flex gap-2">
            {(['day', 'week', 'month'] as const).map(range => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md transition-colors",
                  timeRange === range
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted/80"
                )}
              >
                {range.charAt(0).toUpperCase() + range.slice(1)}
              </button>
            ))}
          </div>
        }
      />

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        {loading ? (
          <>
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
          </>
        ) : (
          <>
            <StatCard
              label="Total Executions"
              value={totalExecutions.toLocaleString()}
              icon={BarChart3}
              description={`Last ${timeRange}`}
            />
            <StatCard
              label="Total Tokens"
              value={totalTokens.toLocaleString()}
              icon={TrendingUp}
              description="Input + Output"
            />
            <StatCard
              label="Total Cost"
              value={`$${(totalCost / 100).toFixed(2)}`}
              icon={DollarSign}
              description="Across all agents"
            />
            <StatCard
              label="Active Agents"
              value={agentCosts.length}
              icon={Bot}
              description="With executions"
            />
          </>
        )}
      </div>

      {/* Per-Agent Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Agent Cost Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : agentCosts.length === 0 ? (
            <EmptyState
              icon={<BarChart3 className="h-8 w-8" />}
              title="No data yet"
              description="Agent execution data will appear here once agents start running"
            />
          ) : (
            <div className="space-y-3">
              {agentCosts.map(agent => (
                <div
                  key={agent.agentInstanceId}
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{agent.agentName}</p>
                      <p className="text-xs text-muted-foreground">
                        {agent.totalExecutions.toLocaleString()} executions
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-sm">${(agent.totalCostCents / 100).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">
                      {agent.totalTokens.toLocaleString()} tokens
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
