import { Bot } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router';

import { AgentForm, type AgentFormValues } from './AgentForm';

import { PageContainer, PageHeader } from '@/components/layout';
import { BackLink } from '@/components/primitives/BackLink';
import { toast } from '@/components/primitives/Toast';
import { useCreateAgent } from '@/lib/queries/agents';

export function AgentCreatePage() {
  const navigate = useNavigate();
  const create = useCreateAgent();
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = (values: AgentFormValues) => {
    setError(null);
    create.mutate(values, {
      onSuccess: (agent) => {
        toast.success(`${agent.name} created`);
        navigate(`/agents/${agent.id}`);
      },
      onError: (e) => setError((e as Error).message),
    });
  };

  return (
    <PageContainer size="narrow">
      <BackLink to="/agents">Agents</BackLink>
      <PageHeader
        title="New agent"
        description="An agent is a system prompt, a model tier, and the set of tools it may call."
        icon={<Bot className="size-5 text-primary" />}
      />

      <AgentForm
        submitLabel="Create agent"
        pending={create.isPending}
        error={error}
        onSubmit={handleSubmit}
        onCancel={() => navigate('/agents')}
      />
    </PageContainer>
  );
}
