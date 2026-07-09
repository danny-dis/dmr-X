import { Bot, Plus, Trash2, Play, ExternalLink, Upload } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Input } from '@/components/primitives/Input';
import { Checkbox } from '@/components/primitives/Checkbox';
import { Field, FieldDescription } from '@/components/primitives/Field';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/primitives/Tabs';
import { Textarea } from '@/components/primitives/Textarea';
import { MultiSelect, type MultiSelectOption } from '@/components/primitives/MultiSelect';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';

interface Skill {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
}

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
  const [humanName, setHumanName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [systemPrompt, setSystemPrompt] = React.useState('');
  const [personality, setPersonality] = React.useState('');
  const [model, setModel] = React.useState('');
  const [tools, setTools] = React.useState('');
  const [visibility, setVisibility] = React.useState('private');
  const [skills, setSkills] = React.useState<string[]>([]);
  const [skillNudgeInterval, setSkillNudgeInterval] = React.useState(8);
  const [enableSkillTools, setEnableSkillTools] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Self-learning is on when the nudge interval is a positive number.
  const selfLearningEnabled = Number.isFinite(skillNudgeInterval) && skillNudgeInterval > 0;

  // Check the skill-tools box by default when self-learning is enabled.
  React.useEffect(() => {
    if (selfLearningEnabled && !enableSkillTools) setEnableSkillTools(true);
  }, [selfLearningEnabled, enableSkillTools]);

  // Skills available to attach to the agent. The backend exposes them at
  // GET /v1/skills; until it lands this just renders an empty selector.
  const { data: skillsData } = useApiData<{ items?: Skill[] } | Skill[]>('/v1/skills');
  const skillList = React.useMemo(() => {
    if (!skillsData) return [];
    return Array.isArray(skillsData)
      ? skillsData
      : (skillsData.items ?? []);
  }, [skillsData]);
  const skillOptions: MultiSelectOption[] = React.useMemo(
    () => skillList.map(s => ({ value: s.id, label: s.name, description: s.description ?? undefined })),
    [skillList]
  );

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const skillTools = ['skill_create', 'skill_patch'];
      const userTools = tools.split(',').map(t => t.trim()).filter(Boolean) as string[];
      // Normalize to a unique string[] and merge the skill tools based on the
      // checkbox, without clobbering tools the user typed.
      let allowedTools = Array.from(new Set(userTools));
      if (enableSkillTools) {
        allowedTools = Array.from(new Set([...allowedTools, ...skillTools]));
      } else {
        allowedTools = allowedTools.filter(t => !skillTools.includes(t));
      }

      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || undefined,
        systemPrompt: systemPrompt.trim() || undefined,
        preferredModel: model.trim() || undefined,
        allowedTools,
        visibility,
      };
      if (humanName.trim()) body.humanName = humanName.trim();
      if (personality.trim()) body.personality = personality.trim();
      if (skills.length > 0) body.skills = skills;
      // Include nudge interval only when it's a non-negative number (0 disables).
      if (Number.isFinite(skillNudgeInterval) && skillNudgeInterval >= 0) {
        body.skillNudgeInterval = skillNudgeInterval;
      }

      await Admin.fetch('/v1/agents', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      onCreated();
      setName('');
      setHumanName('');
      setDescription('');
      setSystemPrompt('');
      setPersonality('');
      setModel('');
      setTools('');
      setSkills([]);
      setSkillNudgeInterval(8);
      setEnableSkillTools(false);
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
          <label className="text-sm font-medium">Human Name</label>
          <Input
            value={humanName}
            onChange={e => setHumanName(e.target.value)}
            placeholder="Ada"
            className="mt-1"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">Human-friendly name (e.g. Ada).</p>
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
        <div>
          <label className="text-sm font-medium">Personality</label>
          <Textarea
            value={personality}
            onChange={e => setPersonality(e.target.value)}
            placeholder="Warm, concise, and a little witty. Prefers concrete examples over abstractions."
            rows={3}
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
        <div>
          <Field orientation="vertical">
            <div>
              <label className="text-sm font-medium">Skill learning interval (turns)</label>
              <Input
                type="number"
                min={0}
                value={skillNudgeInterval}
                onChange={e => {
                  const n = parseInt(e.target.value, 10);
                  setSkillNudgeInterval(Number.isNaN(n) ? 0 : n);
                }}
                className="mt-1 w-32"
              />
            </div>
            <FieldDescription>
              Every N turns the agent is nudged to capture or refine a skill. 0 disables.
            </FieldDescription>
          </Field>
        </div>
        <div>
          <Field orientation="horizontal">
            <Checkbox
              id="enable-skill-tools"
              checked={enableSkillTools}
              onCheckedChange={(v) => setEnableSkillTools(v === true)}
            />
            <div>
              <label htmlFor="enable-skill-tools" className="text-sm font-medium">
                Enable skill learning tools
              </label>
              <FieldDescription>
                Adds <code className="font-mono">skill_create</code> and{' '}
                <code className="font-mono">skill_patch</code> to Allowed Tools so the agent
                can capture and refine skills.
              </FieldDescription>
            </div>
          </Field>
        </div>
        <div>
          <MultiSelect
            label="Skills"
            options={skillOptions}
            value={skills}
            onChange={setSkills}
            placeholder="Select skills…"
            searchPlaceholder="Search skills…"
            emptyText="No skills available."
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Capabilities the agent can draw on. Imported via the same .md / ZIP / GitHub flow.
          </p>
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
// Import Agents Form
// ---------------------------------------------------------------------------

const AGENT_CATEGORIES = [
  'Academic', 'Design', 'Engineering', 'Finance', 'Game Development', 'GIS',
  'Healthcare', 'Marketing', 'Operations', 'Paid Media', 'Product',
  'Project Management', 'Research', 'Sales', 'Security', 'Spatial Computing',
  'Specialized', 'Support', 'Testing',
];

function ImportAgentsForm({ onImported }: { onImported: () => void }) {
  const [source, setSource] = React.useState<'github' | 'zip' | 'text'>('github');
  const [githubUrl, setGithubUrl] = React.useState('');
  const [text, setText] = React.useState('');
  const [filename, setFilename] = React.useState('agent.md');
  const [modelTier, setModelTier] = React.useState('auto');
  const [category, setCategory] = React.useState('');
  const [zipFile, setZipFile] = React.useState<File | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);

  const onFilePick = (files: FileList | null) => {
    if (files && files.length > 0) setZipFile(files[0]);
  };

  const handleImport = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await Admin.importAgents({
        source,
        githubUrl: source === 'github' ? githubUrl.trim() : undefined,
        content: source === 'text' ? text : undefined,
        filename: source === 'text' ? filename.trim() || 'agent.md' : undefined,
        zipFile: source === 'zip' ? zipFile ?? undefined : undefined,
        modelTier,
        category: category || undefined,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Import Agents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Bring in agent definitions from external sources. Each agent is created
            (public) and deployed automatically — ready to call downstream immediately.
          </p>

          {/* Source selector */}
          <div className="flex gap-2 flex-wrap">
            {(['github', 'zip', 'text'] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={source === s ? 'default' : 'outline'}
                onClick={() => setSource(s)}
              >
                {s === 'github' ? 'GitHub URL' : s === 'zip' ? 'Upload ZIP' : 'Paste .md'}
              </Button>
            ))}
          </div>

          {/* GitHub URL */}
          {source === 'github' && (
            <div>
              <label className="text-sm font-medium">Repository URL</label>
              <Input
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="https://github.com/user/agents-repo"
                className="mt-1"
              />
            </div>
          )}

          {/* ZIP upload */}
          {source === 'zip' && (
            <div>
              <label className="text-sm font-medium">ZIP file (.zip containing .md agents)</label>
              <div
                className={`mt-1 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); onFilePick(e.dataTransfer.files); }}
                onClick={() => (document.getElementById('zip-input') as HTMLInputElement | null)?.click()}
              >
                <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {zipFile ? zipFile.name : 'Drag & drop a .zip file here, or click to browse'}
                </p>
                <input
                  id="zip-input"
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={(e) => onFilePick(e.target.files)}
                />
              </div>
            </div>
          )}

          {/* Paste .md */}
          {source === 'text' && (
            <div className="space-y-2">
              <div>
                <label className="text-sm font-medium">Filename</label>
                <Input
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="agent.md"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Agent .md content</label>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={10}
                  placeholder={'---\nname: My Agent\ndescription: ...\n---\n\n# System prompt...'}
                  className="mt-1 font-mono text-sm"
                />
              </div>
            </div>
          )}

          {/* Options */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Model Tier</label>
              <select
                value={modelTier}
                onChange={(e) => setModelTier(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="auto">Auto</option>
                <option value="premium">Premium</option>
                <option value="budget">Budget</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Category (auto-detect if blank)</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Auto-detect</option>
                {AGENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button onClick={handleImport} disabled={loading || (source === 'zip' && !zipFile) || (source === 'github' && !githubUrl.trim()) || (source === 'text' && !text.trim())}>
            {loading ? 'Importing…' : 'Import Agents'}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Import Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="default">{result.imported ?? 0} imported</Badge>
              {result.skipped > 0 && (
                <Badge variant="secondary">{result.skipped} renamed (duplicates)</Badge>
              )}
              {result.errors?.length > 0 && (
                <Badge variant="destructive">{result.errors.length} errors</Badge>
              )}
            </div>

            {result.agents?.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-md border p-2 text-sm">
                {result.agents.slice(0, 50).map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between py-1">
                    <span>{a.name}</span>
                    {a.category && <Badge variant="outline" className="text-xs">{a.category}</Badge>}
                  </div>
                ))}
                {result.agents.length > 50 && (
                  <p className="text-xs text-muted-foreground">…and {result.agents.length - 50} more</p>
                )}
              </div>
            )}

            {result.errors?.length > 0 && (
              <div className="rounded-md border border-destructive/40 p-2 text-sm text-destructive">
                {result.errors.slice(0, 10).map((e: any, i: number) => (
                  <div key={i}>{e.file}: {e.error}</div>
                ))}
              </div>
            )}

            {result.imported > 0 && (
              <Button variant="outline" onClick={onImported}>View Imported Agents →</Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skills Panel
// ---------------------------------------------------------------------------

function SkillsPanel() {
  const { data, loading, error, refetch } = useApiData<{ items?: Skill[] } | Skill[]>('/v1/skills');
  const skills = React.useMemo(() => {
    if (!data) return [];
    return Array.isArray(data) ? data : (data.items ?? []);
  }, [data]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>Skills</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Reusable capabilities agents can draw on. Imported via the same .md / ZIP / GitHub flow used for agents.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>Refresh</Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">
            Failed to load skills. {(error as any)?.message ?? ''}
          </p>
        ) : skills.length === 0 ? (
          <EmptyState
            icon={<Bot className="h-12 w-12" />}
            title="No skills yet"
            description="Import skills from a GitHub repo, ZIP, or pasted .md to make them available here."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {skills.map(s => (
              <div key={s.id} className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-fg">{s.name}</span>
                </div>
                {s.description && (
                  <p className="mt-1 text-xs text-fg-muted leading-relaxed">{s.description}</p>
                )}
                {s.tags?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.tags.map(t => (
                      <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Agents Page
// ---------------------------------------------------------------------------

export function AgentsPage() {
  const [tab, setTab] = React.useState<'list' | 'create' | 'import' | 'skills'>('list');
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
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
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

        <TabsContent value="import" className="mt-4">
          <ImportAgentsForm onImported={() => { refetch(); setTab('list'); }} />
        </TabsContent>

        <TabsContent value="skills" className="mt-4">
          <SkillsPanel />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
