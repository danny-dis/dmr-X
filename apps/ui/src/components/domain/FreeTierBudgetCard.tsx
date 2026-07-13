import { Gift, TrendingUp, Zap, Activity } from 'lucide-react';
import { Card } from '@/components/primitives/Card';
import { StatTile } from '@/components/primitives/StatTile';
import { formatNumber } from '@/lib/formatters';

interface FreeTierBudgetCardProps {
  summary: {
    total_monthly_budget: number;
    total_free_models: number;
    healthy_free_providers: number;
    estimated_tokens_saved: number;
  };
}

export function FreeTierBudgetCard({ summary }: FreeTierBudgetCardProps) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Gift className="h-5 w-5 text-success" />
        <h3 className="text-lg font-semibold">Free Tier Budget</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          icon={<Gift className="h-4 w-4" />}
          label="Monthly Budget"
          value={summary.total_monthly_budget > 0 ? formatNumber(summary.total_monthly_budget) : 'Uncapped'}
          className="text-green-600"
        />
        <StatTile
          icon={<Zap className="h-4 w-4" />}
          label="Free Models"
          value={summary.total_free_models}
          className="text-blue-600"
        />
        <StatTile
          icon={<Activity className="h-4 w-4" />}
          label="Healthy Providers"
          value={summary.healthy_free_providers}
          className="text-purple-600"
        />
        <StatTile
          icon={<TrendingUp className="h-4 w-4" />}
          label="Tokens Used (30d)"
          value={formatNumber(summary.estimated_tokens_saved)}
          className="text-orange-600"
        />
      </div>
    </Card>
  );
}
