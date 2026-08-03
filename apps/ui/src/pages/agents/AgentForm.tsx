import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/primitives/Field';
import { Input } from '@/components/primitives/Input';
import { MultiSelect } from '@/components/primitives/MultiSelect';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Switch } from '@/components/primitives/Switch';
import { Textarea } from '@/components/primitives/Textarea';
import { useMcpTools } from '@/lib/queries/mcp';

/**
 * Mirrors the server's `AgentDefinitionCreateSchema`.
 *
 * react-hook-form and zod were already dependencies and entirely unused —
 * every form in the app was hand-rolled `useState` with no validation, so
 * invalid input only failed at the API. Validating against the same shape the
 * server enforces means the error appears next to the field that caused it.
 */
const AgentFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or fewer'),
  humanName: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  systemPrompt: z.string().max(100_000).optional(),
  personality: z.string().max(5000).optional(),
  preferredModel: z.string().optional(),
  modelTier: z.enum(['auto', 'premium', 'budget']),
  category: z.string().optional(),
  visibility: z.enum(['private', 'team', 'public']),
  allowedTools: z.array(z.string()),
  planMode: z.boolean(),
  historyCompaction: z.boolean(),
  verifyOnStop: z.boolean(),
});

export type AgentFormValues = z.infer<typeof AgentFormSchema>;

/** Built-in tools registered by the gateway's tool router. */
const BUILTIN_TOOLS = [
  'execute_code',
  'remember',
  'recall',
  'delegate',
  'load_skill',
  'skill_create',
  'skill_patch',
  'read_file',
  'write_file',
  'edit_file',
  'list_files',
  'bash',
  'search_files',
];

const CATEGORIES = [
  'general', 'coding', 'research', 'writing', 'data', 'devops', 'security',
  'support', 'sales', 'marketing', 'finance', 'legal', 'education',
  'productivity', 'creative', 'analysis', 'automation', 'testing', 'other',
];

export function AgentForm({
  defaultValues,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  defaultValues?: Partial<AgentFormValues>;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (values: AgentFormValues) => void;
  onCancel: () => void;
}) {
  const mcpTools = useMcpTools();

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<AgentFormValues>({
    resolver: zodResolver(AgentFormSchema),
    defaultValues: {
      name: '',
      modelTier: 'auto',
      visibility: 'private',
      allowedTools: [],
      planMode: false,
      historyCompaction: false,
      verifyOnStop: false,
      ...defaultValues,
    },
  });

  // Built-ins plus whatever the connected MCP servers expose, so the tool
  // list reflects what this instance can actually call.
  const toolOptions = [
    ...BUILTIN_TOOLS.map((t) => ({ value: t, label: t, description: 'Built-in' })),
    ...(mcpTools.data?.tools ?? []).map((t) => ({
      value: t.toolName,
      label: t.toolName,
      description: `MCP · ${t.serverName}`,
    })),
  ];

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" {...register('name')} invalid={!!errors.name} placeholder="research-assistant" />
            <FieldDescription>Used as the identifier. Lowercase and hyphens read best.</FieldDescription>
            {errors.name && <FieldError>{errors.name.message}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="humanName">Display name</FieldLabel>
            <Input id="humanName" {...register('humanName')} invalid={!!errors.humanName} placeholder="Research Assistant" />
            {errors.humanName && <FieldError>{errors.humanName.message}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="description">Description</FieldLabel>
            <Textarea id="description" rows={2} {...register('description')} invalid={!!errors.description} />
            {errors.description && <FieldError>{errors.description.message}</FieldError>}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="category"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="category">Category</FieldLabel>
                  <Select value={field.value ?? ''} onValueChange={field.onChange}>
                    <SelectTrigger id="category"><SelectValue placeholder="Choose" /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />

            <Controller
              control={control}
              name="visibility"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="visibility">Visibility</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="visibility"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="private">Private</SelectItem>
                      <SelectItem value="team">Team</SelectItem>
                      <SelectItem value="public">Public</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Behaviour</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel htmlFor="systemPrompt">System prompt</FieldLabel>
            <Textarea
              id="systemPrompt"
              rows={6}
              {...register('systemPrompt')}
              invalid={!!errors.systemPrompt}
              className="font-mono text-xs"
            />
            {errors.systemPrompt && <FieldError>{errors.systemPrompt.message}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="personality">Personality</FieldLabel>
            <Textarea
              id="personality"
              rows={3}
              {...register('personality')}
              invalid={!!errors.personality}
              placeholder="Optional tone and style guidance layered on top of the system prompt."
            />
            <FieldDescription>
              Shapes tone and style without duplicating what the system prompt already instructs.
            </FieldDescription>
            {errors.personality && <FieldError>{errors.personality.message}</FieldError>}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="modelTier"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="modelTier">Model tier</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="modelTier"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto — router decides</SelectItem>
                      <SelectItem value="premium">Premium</SelectItem>
                      <SelectItem value="budget">Budget</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />

            <Field>
              <FieldLabel htmlFor="preferredModel">Preferred model</FieldLabel>
              <Input id="preferredModel" {...register('preferredModel')} placeholder="Optional — overrides the tier" />
            </Field>
          </div>

          <Controller
            control={control}
            name="allowedTools"
            render={({ field }) => (
              <Field>
                <FieldLabel>Allowed tools</FieldLabel>
                <MultiSelect
                  options={toolOptions}
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="No tools — the agent can only reply"
                  searchPlaceholder="Search tools…"
                  emptyText="No tools available"
                />
                <FieldDescription>
                  Calls to anything outside this list are blocked at dispatch and recorded in the
                  run trace.
                </FieldDescription>
              </Field>
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ToggleRow
            control={control}
            name="planMode"
            label="Plan first"
            hint="Emit a numbered plan in a tool-free call before acting."
          />
          <ToggleRow
            control={control}
            name="historyCompaction"
            label="Compact history"
            hint="Summarise older turns once the transcript grows past 24 messages."
          />
          <ToggleRow
            control={control}
            name="verifyOnStop"
            label="Verify on stop"
            hint="Run a self-check before declaring the task finished."
          />
        </CardContent>
      </Card>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2.5"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <p className="text-sm text-fg">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function ToggleRow({
  control,
  name,
  label,
  hint,
}: {
  control: ReturnType<typeof useForm<AgentFormValues>>['control'];
  name: 'planMode' | 'historyCompaction' | 'verifyOnStop';
  label: string;
  hint: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className="flex items-start justify-between gap-4">
          <label htmlFor={name} className="cursor-pointer">
            <div className="text-sm text-fg">{label}</div>
            <p className="mt-0.5 text-2xs text-fg-muted">{hint}</p>
          </label>
          <Switch id={name} checked={field.value} onCheckedChange={field.onChange} />
        </div>
      )}
    />
  );
}
