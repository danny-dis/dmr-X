import { Database, Plus } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/primitives/Button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/primitives/Dialog';
import { Field, FieldLabel, FieldDescription, FieldError } from '@/components/primitives/Field';
import { Input } from '@/components/primitives/Input';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import type { ApiProvider } from '@/types/api';

export interface CreateModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

interface FormState {
  name: string;
  providerId: string;
  modality: string;
  contextWindow: string;
  inputCostPer1k: string;
  outputCostPer1k: string;
  tier: string;
}

const EMPTY: FormState = {
  name: '',
  providerId: '',
  modality: 'llm',
  contextWindow: '4096',
  inputCostPer1k: '0',
  outputCostPer1k: '0',
  tier: 'standard',
};

// Map the dialog's human-friendly tier labels to the backend's
// capability_tier enum (see CreateModelSchema in admin.routes.ts).
// `standard` is the common default; `premium` upgrades to brain (top of
// the routing chain); `economy` falls back to worker (cheapest tier);
// `experimental` opts into specialist for newer/non-mainline capabilities.
const TIER_TO_CAPABILITY_TIER: Record<string, string> = {
  standard: 'executor',
  premium: 'brain',
  economy: 'worker',
  experimental: 'specialist',
};

export function CreateModelDialog({ open, onOpenChange, onCreated }: CreateModelDialogProps) {
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({});

  const providers = useApiData<ApiProvider[]>(() => Admin.listProviders(), [open], { enabled: open });

  React.useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setErrors({});
    }
  }, [open]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) next.name = 'Name is required';
    if (!form.providerId) next.providerId = 'Provider is required';
    const numFields: (keyof FormState)[] = ['contextWindow', 'inputCostPer1k', 'outputCostPer1k'];
    for (const k of numFields) {
      const n = Number(form[k]);
      if (form[k] && (Number.isNaN(n) || n < 0)) {
        next[k] = 'Must be a non-negative number';
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      // The gateway Zod schema expects snake_case field names with a strict
      // capability_tier enum. The dialog's `tier` selector uses human-friendly
      // labels that don't match the enum directly, so map them to the closest
      // capability_tier value before sending.
      await Admin.createModel({
        model_id: form.name.trim(),
        provider_id: form.providerId,
        modality: form.modality as any,
        context_window: Number(form.contextWindow) || 0,
        input_cost_per_1k: Number(form.inputCostPer1k) || 0,
        output_cost_per_1k: Number(form.outputCostPer1k) || 0,
        capability_tier: TIER_TO_CAPABILITY_TIER[form.tier] ?? 'executor',
      } as any);
      toast.success('Model created', { description: form.name });
      onCreated?.();
      onOpenChange(false);
    } catch (err) {
      toast.error('Failed to create model', {
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
              <Database className="size-4 text-fg-muted" />
              <DialogTitle>New model</DialogTitle>
            </div>
            <DialogDescription>
              Manually register a model for a specific provider.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <Field>
              <FieldLabel required>Name / ID</FieldLabel>
              <Input
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="gpt-4o or claude-3-opus"
                invalid={!!errors.name}
                autoFocus
              />
              <FieldDescription>The exact identifier used in API requests.</FieldDescription>
              {errors.name && <FieldError>{errors.name}</FieldError>}
            </Field>

            <Field>
              <FieldLabel required>Provider</FieldLabel>
              <select
                value={form.providerId}
                onChange={(e) => update('providerId', e.target.value)}
                className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Select a provider...</option>
                {(providers.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {errors.providerId && <FieldError>{errors.providerId}</FieldError>}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>Modality</FieldLabel>
                <select
                  value={form.modality}
                  onChange={(e) => update('modality', e.target.value)}
                  className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                >
                  <option value="llm">LLM (Text)</option>
                  <option value="diffusion">Diffusion (Image)</option>
                  <option value="embedding">Embedding</option>
                  <option value="audio_tts">TTS</option>
                  <option value="audio_stt">STT</option>
                  <option value="reranking">Reranking</option>
                </select>
              </Field>

              <Field>
                <FieldLabel>Tier</FieldLabel>
                <select
                  value={form.tier}
                  onChange={(e) => update('tier', e.target.value)}
                  className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                >
                  <option value="standard">Standard</option>
                  <option value="premium">Premium</option>
                  <option value="economy">Economy</option>
                  <option value="experimental">Experimental</option>
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field>
                <FieldLabel>Context</FieldLabel>
                <Input
                  type="number"
                  value={form.contextWindow}
                  onChange={(e) => update('contextWindow', e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Input $ / 1k</FieldLabel>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.inputCostPer1k}
                  onChange={(e) => update('inputCostPer1k', e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Output $ / 1k</FieldLabel>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.outputCostPer1k}
                  onChange={(e) => update('outputCostPer1k', e.target.value)}
                />
              </Field>
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
              Create model
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
