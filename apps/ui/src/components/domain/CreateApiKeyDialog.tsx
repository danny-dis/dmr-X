import { KeyRound, Plus, Check, Copy, Shield, AlertCircle, X } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
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
import { setTenantToken } from '@/lib/api';

export interface CreateApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  tenantName?: string;
  onCreated?: () => void;
}

const SCOPE_PRESETS: { id: string; label: string; description: string }[] = [
  { id: 'chat:read', label: 'chat:read', description: 'Read chat completions' },
  { id: 'chat:write', label: 'chat:write', description: 'Create chat completions' },
  { id: 'embeddings:read', label: 'embeddings:read', description: 'Read embeddings' },
  { id: 'embeddings:write', label: 'embeddings:write', description: 'Create embeddings' },
  { id: 'images:write', label: 'images:write', description: 'Generate images' },
  { id: 'audio:write', label: 'audio:write', description: 'Audio synthesis / transcription' },
  { id: 'admin:read', label: 'admin:read', description: 'Read admin endpoints' },
];

interface FormState {
  name: string;
  scopes: string[];
}

const EMPTY: FormState = { name: '', scopes: ['chat:read', 'chat:write'] };

export function CreateApiKeyDialog({
  open,
  onOpenChange,
  tenantId,
  tenantName,
  onCreated,
}: CreateApiKeyDialogProps) {
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({});
  const [createdKey, setCreatedKey] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setErrors({});
      setCreatedKey(null);
      setCopied(false);
    }
  }, [open]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const toggleScope = (id: string) => {
    setForm((prev) => ({
      ...prev,
      scopes: prev.scopes.includes(id)
        ? prev.scopes.filter((s) => s !== id)
        : [...prev.scopes, id],
    }));
  };

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) next.name = 'Name is required';
    if (form.scopes.length === 0) next.scopes = 'Select at least one scope';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) {
      toast.error('No tenant selected');
      return;
    }
    if (!validate()) return;
    setSubmitting(true);
    try {
      const created = await Admin.createApiKey({
        tenant_id: tenantId,
        name: form.name.trim(),
        scopes: form.scopes,
      });
      // The backend returns the row plus the plaintext `key`. If the payload
      // is missing the key (e.g. a non-2xx that somehow came through, or a
      // proxy stripped the body), surface a clear error instead of crashing
      // on `undefined.key` and showing a misleading "Failed to create API key".
      if (!created || typeof created.key !== 'string' || created.key.length === 0) {
         
        console.error('createApiKey: unexpected response payload', created);
        throw new Error('Server did not return the new API key. Please retry.');
      }
      setCreatedKey(created.key);
      // Activate the new key: make it the active tenant token for chat
      // calls and mark it as the currently-active key so other UI surfaces
      // (the ApiKeyCard list) can highlight it.
      setTenantToken(created.key);
      try {
        localStorage.setItem('dmrx_active_key_id', created.id);
      } catch {
        // ignore storage failures (private mode, quota, etc.)
      }
      toast.success('API key created and activated', { description: form.name });
      onCreated?.();
    } catch (err) {
      toast.error('Failed to create API key', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy', { description: 'Use Ctrl+C manually' });
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent size="lg">
        {createdKey ? (
          <div className="flex flex-col min-h-0">
            <DialogHeader>
              <div className="flex items-center gap-2 mb-1">
                <div className="flex size-8 items-center justify-center rounded-lg bg-success/10 text-success">
                  <Check className="size-4" />
                </div>
                <DialogTitle>API key created</DialogTitle>
                <Badge tone="success" size="sm">Active</Badge>
              </div>
              <DialogDescription>
                Copy this key now — it will not be shown again.
              </DialogDescription>
            </DialogHeader>

            <DialogBody className="space-y-4">
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 flex items-start gap-2">
                <AlertCircle className="size-3.5 text-warning shrink-0 mt-0.5" />
                <div className="text-[11px] text-fg-muted leading-relaxed">
                  Store this key in a secret manager. For security reasons, the full
                  key value is only displayed once at creation.
                </div>
              </div>

              <Field>
                <FieldLabel>Full key</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    value={createdKey}
                    readOnly
                    className="font-mono"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    onClick={handleCopy}
                    leftIcon={
                      copied ? (
                        <Check className="size-3.5 text-success" />
                      ) : (
                        <Copy className="size-3.5" />
                      )
                    }
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </Field>

              <div className="rounded-lg border border-border bg-surface-2/40 p-3">
                <div className="text-[10px] text-fg-subtle uppercase tracking-wider mb-1.5">
                  Example
                </div>
                <pre className="text-[11px] font-mono text-fg-muted overflow-x-auto whitespace-pre">
{`curl https://gateway.dmr-x.dev/v1/chat/completions \\
  -H "Authorization: Bearer ${createdKey.slice(0, 12)}…"`}
                </pre>
              </div>
            </DialogBody>

            <DialogFooter>
              <Button variant="primary" onClick={handleClose}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col min-h-0 max-h-[90vh]">
            <DialogHeader>
              <div className="flex items-center gap-2 mb-1">
                <KeyRound className="size-4 text-fg-muted" />
                <DialogTitle>New API key</DialogTitle>
              </div>
              <DialogDescription>
                {tenantName
                  ? `Create an API key for ${tenantName}.`
                  : 'Create an API key with scoped access.'}
              </DialogDescription>
            </DialogHeader>

            <DialogBody className="space-y-4">
              <Field>
                <FieldLabel required>Name</FieldLabel>
                <Input
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="Production key"
                  invalid={!!errors.name}
                  autoFocus
                />
                {errors.name && <FieldError>{errors.name}</FieldError>}
                <FieldDescription>
                  A human-readable label to identify this key.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel>
                  <span className="inline-flex items-center gap-1.5">
                    <Shield className="size-3" />
                    Scopes
                  </span>
                </FieldLabel>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {SCOPE_PRESETS.map((s) => {
                    const active = form.scopes.includes(s.id);
                    return (
                      <button
                        type="button"
                        key={s.id}
                        onClick={() => toggleScope(s.id)}
                        className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-colors ${
                          active
                            ? 'border-primary/40 bg-primary/5'
                            : 'border-border bg-surface-2/40 hover:border-border-strong'
                        }`}
                      >
                        <div
                          className={`mt-0.5 size-3.5 rounded border flex items-center justify-center shrink-0 ${
                            active ? 'bg-primary border-primary' : 'border-border-strong'
                          }`}
                        >
                          {active && <Check className="size-2.5 text-white" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-mono font-medium text-fg">{s.label}</div>
                          <div className="text-[10px] text-fg-muted leading-tight">
                            {s.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {errors.scopes && <FieldError>{errors.scopes}</FieldError>}
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[10px] text-fg-subtle">Selected:</span>
                  {form.scopes.length === 0 ? (
                    <span className="text-[10px] text-fg-subtle">none</span>
                  ) : (
                    form.scopes.map((s) => (
                      <Badge key={s} tone="primary" size="sm">
                        {s}
                        <button
                          type="button"
                          onClick={() => toggleScope(s)}
                          className="ml-1 hover:text-fg"
                          aria-label={`Remove ${s}`}
                        >
                          <X className="size-2" />
                        </button>
                      </Badge>
                    ))
                  )}
                </div>
              </Field>
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
                Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
