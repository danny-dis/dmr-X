import { Server, Zap } from 'lucide-react';
import { Badge } from '@/components/primitives/Badge';
import { Card } from '@/components/primitives/Card';
import { formatNumber } from '@/lib/formatters';

interface ProviderData {
  provider_name: string;
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
}

interface FreeTierProviderGridProps {
  providers: ProviderData[];
}

export function FreeTierProviderGrid({ providers }: FreeTierProviderGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {providers.map((provider) => (
        <Card key={provider.provider_name} className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <h4 className="font-medium">{provider.provider_name}</h4>
            </div>
            <Badge variant={provider.is_healthy ? 'default' : 'destructive'}>
              {provider.is_healthy ? 'Healthy' : 'Unhealthy'}
            </Badge>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Monthly Budget:</span>
              <span className="font-medium">
                {provider.total_monthly_budget > 0 ? formatNumber(provider.total_monthly_budget) : 'Uncapped'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Models:</span>
              <span className="font-medium">{provider.models.length}</span>
            </div>
          </div>

          <div className="mt-3 space-y-1">
            {provider.models.slice(0, 3).map((model) => (
              <div key={model.model_id} className="flex items-center justify-between text-xs">
                <span className="truncate max-w-[150px]">{model.model_id}</span>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Brain className="h-3 w-3" />
                    {model.intelligence_rank}
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Zap className="h-3 w-3" />
                    {model.speed_rank}
                  </span>
                </div>
              </div>
            ))}
            {provider.models.length > 3 && (
              <div className="text-xs text-muted-foreground">
                +{provider.models.length - 3} more models
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
