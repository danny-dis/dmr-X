import { Users, Plus, Mail, Hash, Gauge } from 'lucide-react';
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
import { Admin } from '@/lib/admin';

export interface CreateTenantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (tenantId: string) => void;
}

interface FormState {
  name: string;
  email: string;
  tier: 'free' | 'pro' | 'enterprise';
  tokensLimit: string;
  requestsLimit: string;
  costLimit: string;
}

const EMPTY: FormState = {
  name: '',
  email: '',
  tier: 'free',
  tokensLimit: '1000000',
  requestsLimit: '10000',
  costLimit: '50',
};

export function CreateTenantDialog({ open, onOpenChange, onCreated }: CreateTenantDialogProps) {
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({});

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
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      next.email = 'Invalid email address';
    }
    const numFields: (keyof FormState)[] = ['tokensLimit', 'requestsLimit', 'costLimit'];
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
      const created = await Admin.createTenant({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        tier: form.tier,
        tokensLimit: Number(form.tokensLimit) || 0,
        requestsLimit: Number(form.requestsLimit) || 0,
        costLimit: Number(form.costLimit) || 0,
      });
      // The backend returns the inserted tenant row. Guard against a
      // missing id/name so the user gets a clear error instead of a
      // generic "Failed to create tenant" caused by a TypeError.
      if (!created || !created.id || !created.name) {
         
        console.error('createTenant: unexpected response payload', created);
        throw new Error('Server did not return the new tenant. Please retry.');
      }
      toast.success('Tenant created', { description: created.name });
      onCreated?.(created.id);
      onOpenChange(false);
    } catch (err) {
      toast.error('Failed to create tenant', {
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
              <Users className="size-4 text-fg-muted" />
              <DialogTitle>New tenant</DialogTitle>
            </div>
            <DialogDescription>
              Create a tenant to isolate usage, billing, and access scopes.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <Field>
              <FieldLabel required>
                <span className="inline-flex items-center gap-1.5">
                  <Hash className="size-3" />
                  Name
                </span>
              </FieldLabel>
              <Input
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="Acme Corp"
                invalid={!!errors.name}
                autoFocus
              />
              {errors.name && <FieldError>{errors.name}</FieldError>}
            </Field>

            <Field>
              <FieldLabel>
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="size-3" />
                  Email
                </span>
              </FieldLabel>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="billing@acme.com"
                invalid={!!errors.email}
              />
              {errors.email && <FieldError>{errors.email}</FieldError>}
            </Field>

            <Field>
              <FieldLabel>Tier</FieldLabel>
              <select
                value={form.tier}
                onChange={(e) => update('tier', e.target.value as FormState['tier'])}
                className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
              >
                <option value="free">free</option>
                <option value="pro">pro</option>
                <option value="enterprise">enterprise</option>
              </select>
              <FieldDescription>
                Tier controls default limits and feature gates.
              </FieldDescription>
            </Field>

            <div>
              <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-fg">
                <Gauge className="size-3" />
                Default limits
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field>
                  <FieldLabel className="text-[11px]">Tokens</FieldLabel>
                  <Input
                    type="number"
                    min="0"
                    value={form.tokensLimit}
                    onChange={(e) => update('tokensLimit', e.target.value)}
                    invalid={!!errors.tokensLimit}
                  />
                  {errors.tokensLimit && <FieldError>{errors.tokensLimit}</FieldError>}
                </Field>
                <Field>
                  <FieldLabel className="text-[11px]">Requests</FieldLabel>
                  <Input
                    type="number"
                    min="0"
                    value={form.requestsLimit}
                    onChange={(e) => update('requestsLimit', e.target.value)}
                    invalid={!!errors.requestsLimit}
                  />
                  {errors.requestsLimit && <FieldError>{errors.requestsLimit}</FieldError>}
                </Field>
                <Field>
                  <FieldLabel className="text-[11px]">Cost (USD)</FieldLabel>
                  <Input
                    type="number"
                    min="0"
                    value={form.costLimit}
                    onChange={(e) => update('costLimit', e.target.value)}
                    invalid={!!errors.costLimit}
                  />
                  {errors.costLimit && <FieldError>{errors.costLimit}</FieldError>}
                </Field>
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
              Create tenant
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
