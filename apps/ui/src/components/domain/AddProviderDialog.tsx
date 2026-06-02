import * as React from 'react';
import { Plus, KeyRound, Globe, Cpu, Server } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/primitives/Dialog';
import { Button } from '@/components/primitives/Button';
import { Input } from '@/components/primitives/Input';
import { Field, FieldLabel, FieldDescription, FieldError } from '@/components/primitives/Field';
import { toast } from '@/components/primitives/Toast';
import { Admin } from '@/lib/admin';
import type { ApiCatalogEntry } from '@/types/api';

export interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: ApiCatalogEntry | null;
  onCreated?: () => void;
}

const ADAPTER_PRESETS: { id: string; label: string; baseUrl?: string }[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com' },
  { id: 'cohere', label: 'Cohere', baseUrl: 'https://api.cohere.ai/v1' },
  { id: 'google', label: 'Google', baseUrl: 'https://generativelanguage.googleapis.com/v1' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1' },
  { id: 'generic-openai', label: 'OpenAI-compatible', baseUrl: '' },
];

interface FormState {
  name: string;
  adapterType: string;
  baseUrl: string;
  apiKey: string;
  oauthAccessToken: string;
  region: string;
  priority: string;
}

const EMPTY: FormState = {
  name: '',
  adapterType: 'openai',
  baseUrl: '',
  apiKey: '',
  oauthAccessToken: '',
  region: '',
  priority: '0',
};

export function AddProviderDialog({
  open,
  onOpenChange,
  template,
  onCreated,
}: AddProviderDialogProps) {
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({});

  React.useEffect(() => {
    if (open) {
      setErrors({});
      if (template) {
        const preset = ADAPTER_PRESETS.find(
          (p) => p.id === template.id || p.label.toLowerCase() === template.name.toLowerCase(),
        );
        setForm({
          name: template.name,
          adapterType: preset?.id ?? template.id,
          baseUrl: template.baseUrl ?? preset?.baseUrl ?? '',
          apiKey: '',
          oauthAccessToken: '',
          region: '',
          priority: '0',
        });
      } else {
        setForm(EMPTY);
      }
    }
  }, [open, template]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  const onAdapterChange = (id: string) => {
    const preset = ADAPTER_PRESETS.find((p) => p.id === id);
    setForm((prev) => ({
      ...prev,
      adapterType: id,
      baseUrl: prev.baseUrl || preset?.baseUrl || '',
    }));
    if (errors.adapterType) setErrors((prev) => ({ ...prev, adapterType: undefined }));
  };

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) next.name = 'Name is required';
    if (!form.adapterType.trim()) next.adapterType = 'Adapter is required';
    const priority = Number(form.priority);
    if (form.priority && (Number.isNaN(priority) || priority < 0)) {
      next.priority = 'Priority must be a non-negative number';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const oauthAccessToken = form.oauthAccessToken.trim();
      const apiKey = form.apiKey.trim();
      const created = template
        ? (await Admin.activateProvider({
            template_id: template.id,
            api_key: apiKey || undefined,
            oauth_access_token: oauthAccessToken || undefined,
            auth_method: oauthAccessToken ? 'oauth' : 'api_key',
          })).provider
        : await Admin.createProvider({
            name: form.name.trim(),
            adapterType: form.adapterType.trim(),
            baseUrl: form.baseUrl.trim() || null,
            apiKeyRef: apiKey || null,
            region: form.region.trim() || undefined,
            priority: Number(form.priority) || 0,
            enabled: true,
          });
      toast.success('Provider created', { description: created.name });
      onCreated?.();
      onOpenChange(false);
    } catch (err) {
      toast.error('Failed to create provider', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 max-h-[90vh]">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <Server className="size-4 text-fg-muted" />
              <DialogTitle>Add provider</DialogTitle>
            </div>
            <DialogDescription>
              {template
                ? `Configure ${template.name} from the catalog template.`
                : 'Connect a new AI provider to the routing layer.'}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <Field>
              <FieldLabel required>Name</FieldLabel>
              <Input
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="My OpenAI account"
                invalid={!!errors.name}
                autoFocus
              />
              {errors.name && <FieldError>{errors.name}</FieldError>}
            </Field>

            <Field>
              <FieldLabel required>Adapter</FieldLabel>
              <select
                value={form.adapterType}
                onChange={(e) => onAdapterChange(e.target.value)}
                className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
              >
                {ADAPTER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {errors.adapterType && <FieldError>{errors.adapterType}</FieldError>}
              <FieldDescription>
                Adapter type determines how requests are formatted.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>
                <span className="inline-flex items-center gap-1.5">
                  <Globe className="size-3" />
                  Base URL
                </span>
              </FieldLabel>
              <Input
                value={form.baseUrl}
                onChange={(e) => update('baseUrl', e.target.value)}
                placeholder="https://api.openai.com/v1"
                mono
              />
              <FieldDescription>
                Leave blank to use the adapter default.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>
                <span className="inline-flex items-center gap-1.5">
                  <KeyRound className="size-3" />
                  API key
                </span>
              </FieldLabel>
              <Input
                type="password"
                value={form.apiKey}
                onChange={(e) => update('apiKey', e.target.value)}
                placeholder="sk-…"
                autoComplete="off"
              />
              <FieldDescription>
                Stored as a key reference; the gateway resolves the actual secret at request time.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>
                <span className="inline-flex items-center gap-1.5">
                  <KeyRound className="size-3" />
                  OAuth access token
                </span>
              </FieldLabel>
              <Input
                type="password"
                value={form.oauthAccessToken}
                onChange={(e) => update('oauthAccessToken', e.target.value)}
                placeholder="Bearer token"
                autoComplete="off"
              />
              <FieldDescription>
                Use this when the provider account gives you an OAuth bearer token instead of an API key.
              </FieldDescription>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>Region</FieldLabel>
                <Input
                  value={form.region}
                  onChange={(e) => update('region', e.target.value)}
                  placeholder="us-east-1"
                />
              </Field>

              <Field>
                <FieldLabel>Priority</FieldLabel>
                <Input
                  type="number"
                  min="0"
                  value={form.priority}
                  onChange={(e) => update('priority', e.target.value)}
                  invalid={!!errors.priority}
                />
                {errors.priority && <FieldError>{errors.priority}</FieldError>}
              </Field>
            </div>

            <div className="rounded-lg border border-border bg-surface-2/40 p-3 flex items-start gap-2">
              <Cpu className="size-3.5 text-fg-muted shrink-0 mt-0.5" />
              <div className="text-[11px] text-fg-muted leading-relaxed">
                Models for this provider will be auto-discovered on the first successful
                health check. You can also add models manually from the Models page.
              </div>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" loading={submitting} leftIcon={<Plus className="size-3.5" />}>
              Create provider
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
