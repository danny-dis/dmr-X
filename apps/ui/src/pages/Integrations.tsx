/**
 * Integrations — landing page for external integrations managed by DMR-X.
 * Currently hosts the auto-installed G0DM0D3 server card.
 */

import { Boxes } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { G0dm0d3ServerCard } from '@/components/integrations';

export function IntegrationsPage() {
  return (
    <PageContainer size="wide">
      <PageHeader
        title="Integrations"
        description="Install and manage external integrations connected to your gateway"
        icon={<Boxes className="size-5" />}
      />

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <G0dm0d3ServerCard />
      </div>
    </PageContainer>
  );
}
