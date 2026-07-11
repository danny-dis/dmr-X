import { RefreshCw, Gift } from 'lucide-react';
import * as React from 'react';

import { FreeTierBudgetCard } from '@/components/domain/FreeTierBudgetCard';
import { FreeTierProviderGrid } from '@/components/domain/FreeTierProviderGrid';
import { PageHeader, PageContainer } from '@/components/layout';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatNumber } from '@/lib/formatters';

interface FreeTierSummary {
  summary: {
    total_monthly_budget?: number;
    pooled_monthly_budget?: number;
    total_free_models?: number;
    total_pools?: number;
    total_providers?: number;
    healthy_free_providers?: number;
    estimated_tokens_saved?: number;
  };
  providers: Array<{
    id: string;
    provider_name: string;
    type?: 'keyless' | 'uncapped' | 'monthly';
    tos_risk?: 'ok' | 'caution' | 'avoid';
    models: Array<{
      model_id: string;
      monthly_token_budget: number;
      intelligence_rank: number;
      speed_rank: number;
      rate_limits: {
        rpm: number;
        rpd: number;
        tpm: number;
        tpd: number;
      };
    }>;
    total_monthly_budget: number;
    is_healthy: boolean;
  }>;
  pools?: Array<{
    id: string;
    name: string;
    type: 'keyless' | 'uncapped' | 'monthly';
    tos_risk: 'ok' | 'caution' | 'avoid';
    monthly_tokens: number;
  }>;
  tos_risk_labels?: Partial<Record<'ok' | 'caution' | 'avoid', string>>;
  recent_usage: Array<{
    selected_provider: string;
    selected_model: string;
    total_tokens: number;
    total_requests: number;
  }>;
}

export function FreeTierDashboardPage() {
  const { data: summary, loading, refetch } = useApiData<FreeTierSummary>(
    () => Admin.getFreeTierSummary(),
    [],
    { refetchInterval: 60000 }
  );

  return (
    <PageContainer>
      <PageHeader
        title="Free Tier Dashboard"
        description="Monitor free-tier provider budgets, usage, and health across all configured providers."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      ) : summary ? (
        <div className="space-y-6">
          {/* Budget Overview */}
          <FreeTierBudgetCard
            summary={summary.summary}
            pools={summary.pools}
            providers={summary.providers}
            tosRiskLabels={summary.tos_risk_labels}
          />

          {/* Provider Grid */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Free Providers</h3>
            <FreeTierProviderGrid providers={summary.providers} />
          </div>

          {/* Recent Usage */}
          {summary.recent_usage.length > 0 && (
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Recent Free-Tier Usage (30 days)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Provider</th>
                      <th className="text-left py-2">Model</th>
                      <th className="text-right py-2">Requests</th>
                      <th className="text-right py-2">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recent_usage.map((usage, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2">{usage.selected_provider}</td>
                        <td className="py-2 font-mono text-xs">{usage.selected_model}</td>
                        <td className="py-2 text-right">{formatNumber(usage.total_requests)}</td>
                        <td className="py-2 text-right">{formatNumber(usage.total_tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      ) : (
        <Card className="p-8 text-center">
          <Gift className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No Free-Tier Data</h3>
          <p className="text-muted-foreground">
            Configure free-tier providers to see aggregated budget and usage data.
          </p>
        </Card>
      )}
    </PageContainer>
  );
}
