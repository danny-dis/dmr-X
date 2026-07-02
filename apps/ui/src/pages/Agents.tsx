import { Bot, Plus, Trash2, Play, Square, ExternalLink, Copy } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/primitives/Tabs';
import { Textarea } from '@/components/primitives/Textarea';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentDefinition {
  id: string;
  name: string;
  description: string | null;
  version: string;
  systemPrompt: string | null;
  personality: string | null;
  preferredModel: string | null;
  modelTier: string;
  allowedTools: string[];
  visibility: string;
  tags: string[];
  category: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AgentInstance {
  id: string;
  agentDefinitionId: string;
  status: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Create Agent Form
// ---------------------------------------------------------------------------

function CreateAgentForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [systemPrompt, setSystemPrompt] = React.useState('');
  const [model, setModel] = React.useState('');
  const [tools, setTools] = React.useState('');
  const [visibility, setVisibility] = React.useState('private');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const allowedTools = tools.split(',').map(t => t.trim()).filter(Boolean);
      await Admin.fetch('/v1/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          systemPrompt: systemPrompt.trim() || undefined,
          preferredModel: model.trim() || undefined,
          allowedTools,
          visibility,
        }),
      });
      onCreated();
      setName('');
      setDescription('');
      setSystemPrompt('');
      setModel('');
      setTools('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create agent');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create New Agent</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium">Name *</label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="My Agent"
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Description</label>
          <Input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What does this agent do?"
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-sm font-medium">System Prompt</label>
          <Textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            placeholder="You are a helpful assistant that..."
            rows={4}
            className="mt-1 font-mono text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Preferred Model</label>
            <Input
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="auto (or specific model)"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Visibility</label>
            <select
              value={visibility}
              onChange={e => setVisibility(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="private">Private</option>
              <option value="team">Team</option>
              <option value="public">Public</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">Allowed Tools (comma-separated)</label>
          <Input
            value={tools}
            onChange={e => setTools(e.target.value)}
            placeholder="dmrx_chat, dmrx_generate_image"
            className="mt-1"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={handleCreate} disabled={saving || !name.trim()}>
          {saving ? 'Creating...' : 'Create Agent'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------

function AgentCard({
  agent,
  instances,
  onDeploy,
  onDelete,
  onPublish,
}: {
  agent: AgentDefinition;
  instances: AgentInstance[];
  onDeploy: (id: string) => void;
  onDelete: (id: string) => void;
  onPublish: (id: string) => void;
}) {
  const agentInstances = instances.filter(i => i.agentDefinitionId === agent.id);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">{agent.name}</CardTitle>
            <p className="text-xs text-muted-foreground">v{agent.version}</p>
          </div>
        </div>
        <Badge variant={agent.visibility === 'public' ? 'default' : agent.visibility === 'team' ? 'secondary' : 'outline'}>
          {agent.visibility}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {agent.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{agent.description}</p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {agent.preferredModel && (
            <Badge variant="outline" className="text-xs">{agent.preferredModel}</Badge>
          )}
          {agent.allowedTools.slice(0, 3).map(tool => (
            <Badge key={tool} variant="secondary" className="text-xs">{tool}</Badge>
          ))}
          {agent.allowedTools.length > 3 && (
            <Badge variant="secondary" className="text-xs">+{agent.allowedTools.length - 3} more</Badge>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{agentInstances.length} instance{agentInstances.length !== 1 ? 's' : ''}</span>
          {agent.publishedAt && <span className="text-green-600">Published</span>}
        </div>

        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => onDeploy(agent.id)}>
            <Play className="mr-1 h-3 w-3" /> Deploy
          </Button>
          {!agent.publishedAt && (
            <Button size="sm" variant="outline" onClick={() => onPublish(agent.id)}>
              <ExternalLink className="mr-1 h-3 w-3" /> Publish
            </Button>
          )}
          <Button size="sm" variant="destructive" onClick={() => onDelete(agent.id)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Agents Page
// ---------------------------------------------------------------------------

export function AgentsPage() {
  const [tab, setTab] = React.useState<'list' | 'create'>('list');
  const { data, loading, refetch } = useApiData<{ items: AgentDefinition[] }>('/v1/agents');
  const { data: instancesData } = useApiData<{ items: AgentInstance[] }>('/v1/agents/instances');
  const [deploying, setDeploying] = React.useState<string | null>(null);

  const agents = data?.items ?? [];
  const instances = instancesData?.items ?? [];

  const handleDeploy = async (id: string) => {
    setDeploying(id);
    try {
      await Admin.fetch(`/v1/agents/${id}/deploy`, { method: 'POST', body: '{}' });
      refetch();
    } catch (e) {
      console.error('Deploy failed:', e);
    } finally {
      setDeploying(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this agent?')) return;
    try {
      await Admin.fetch(`/v1/agents/${id}`, { method: 'DELETE' });
      refetch();
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  const handlePublish = async (id: string) => {
    try {
      await Admin.fetch(`/v1/agents/${id}/publish`, { method: 'POST' });
      refetch();
    } catch (e) {
      console.error('Publish failed:', e);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Agents"
        description="Define, deploy, and manage AI agents"
        actions={
          <Button onClick={() => setTab('create')}>
            <Plus className="mr-2 h-4 w-4" /> New Agent
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="list">My Agents ({agents.length})</TabsTrigger>
          <TabsTrigger value="create">Create</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          {loading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-48" />)}
            </div>
          ) : agents.length === 0 ? (
            <EmptyState
              icon={<Bot className="h-12 w-12" />}
              title="No agents yet"
              description="Create your first AI agent to get started"
              action={<Button onClick={() => setTab('create')}>Create Agent</Button>}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {agents.map(agent => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  instances={instances}
                  onDeploy={handleDeploy}
                  onDelete={handleDelete}
                  onPublish={handlePublish}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="create" className="mt-4">
          <CreateAgentForm onCreated={() => { refetch(); setTab('list'); }} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
