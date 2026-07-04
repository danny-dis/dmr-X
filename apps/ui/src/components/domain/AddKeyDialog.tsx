import { Plus, KeyRound, Loader2, AlertCircle, CreditCard, Zap, Activity, CheckCircle2 } from 'lucide-react';
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
import { Field, FieldLabel, FieldDescription } from '@/components/primitives/Field';
import { Input } from '@/components/primitives/Input';
import { toast } from '@/components/primitives/Toast';
import { Admin, apiPost } from '@/lib/admin';
import { cn } from '@/lib/utils';

export interface AddKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerId: string;
  providerName: string;
  /**
   * Existing keys on the provider. Used to auto-suggest a label
   * ("Key 2", "Key 3", …) and to show context above the form.
   */
  existingKeyCount?: number;
  /**
   * Called after a successful add. The parent is expected to refetch
   * the provider list so the new key shows up immediately. We
   * deliberately don't refetch from the dialog itself — multiple
   * drawers and pages share the same `useApiData` cache.
   */
  onAdded?: () => void;
}

interface FormState {
  label: string;
  tier: 'free' | 'paid';
  apiKey: string;
  priority: string;
}

const EMPTY: FormState = {
  label: '',
  tier: 'paid',
  apiKey: '',
  priority: '0',
};

/**
 * Focused dialog for adding a *second* (or third, …) API key to a
 * provider. The "Default" key is managed by the activate and
 * api-key-rotate endpoints; this dialog always creates a new row.
 *
 * Tier is a top-level field because the entire point of this dialog
 * is to attach a key with a different tier than the existing one
 * (e.g. add a paid key on top of a free connection).
 */
export function AddKeyDialog({
  open,
  onOpenChange,
  providerId,
  providerName,
  existingKeyCount = 0,
  onAdded,
}: AddKeyDialogProps) {
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; latencyMs: number; error?: string } | null>(null);

  React.useEffect(() => {
    if (open) {
      setForm({
        ...EMPTY,
        label: existingKeyCount === 0 ? 'Default' : `Key ${existingKeyCount + 1}`,
      });
      setError(null);
      setTestResult(null);
      setTesting(false);
    }
  }, [open, existingKeyCount]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (error) setError(null);
  };

  const handleTestKey = async () => {
    const key = form.apiKey.trim();
    if (!key) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiPost<{ status?: string; latency_ms?: number; message?: string }>(
        '/admin/providers/test',
        { provider_id: providerId, api_key: key },
      );
      const ok = result.status === 'passed';
      setTestResult({
        ok,
        latencyMs: result.latency_ms ?? 0,
        error: ok ? undefined : result.message ?? 'Test failed',
      });
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : 'Connection failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.apiKey.trim()) {
      setError('API key is required');
      return;
    }
    const priority = Number(form.priority);
    if (form.priority && (Number.isNaN(priority) || priority < 0)) {
      setError('Priority must be a non-negative number');
      return;
    }
    setSubmitting(true);
    try {
      await Admin.addProviderKey(providerId, {
        label: form.label.trim() || undefined,
        tier: form.tier,
        api_key: form.apiKey.trim(),
        priority,
      });
      toast.success('Key added', { description: `${form.label || 'Key'} on ${providerName}` });
      onAdded?.();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error('Failed to add key', { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form onSubmit={onSubmit} className="flex flex-col min-h-0 max-h-[90vh]">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <KeyRound className="size-4 text-fg-muted" />
              <DialogTitle>Add another key</DialogTitle>
            </div>
            <DialogDescription>
              Attach an additional API key to <span className="font-mono">{providerName}</span>.
              The highest-priority active key is the one the gateway uses.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <Field>
              <FieldLabel>Label</FieldLabel>
              <Input
                value={form.label}
                onChange={(e) => update('label', e.target.value)}
                placeholder="Personal, Work, Workspace…"
                autoFocus
              />
              <FieldDescription>
                A friendly name so you can tell keys apart in the dashboard.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>Tier</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => update('tier', 'free')}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs transition-colors',
                    form.tier === 'free'
                      ? 'border-primary/40 bg-primary/10 text-fg'
                      : 'border-border bg-surface-2 text-fg-muted hover:border-border-strong',
                  )}
                >
                  <Zap className="size-3.5 text-success" />
                  <span className="font-medium">Free</span>
                </button>
                <button
                  type="button"
                  onClick={() => update('tier', 'paid')}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs transition-colors',
                    form.tier === 'paid'
                      ? 'border-primary/40 bg-primary/10 text-fg'
                      : 'border-border bg-surface-2 text-fg-muted hover:border-border-strong',
                  )}
                >
                  <CreditCard className="size-3.5 text-warning" />
                  <span className="font-medium">Paid</span>
                </button>
              </div>
              <FieldDescription>
                Free and paid keys can coexist on the same provider; the connection tier flips to "Free + Paid".
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel required>
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
                invalid={!!error && !form.apiKey.trim()}
              />
              <FieldDescription>
                Encrypted at rest; never returned in list responses.
              </FieldDescription>
              {form.apiKey.trim() && (
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleTestKey}
                    loading={testing}
                    disabled={testing}
                    leftIcon={<Activity className="size-3" />}
                  >
                    Test connection
                  </Button>
                  {testResult && (
                    <span className={`text-[11px] flex items-center gap-1 ${
                      testResult.ok ? 'text-success' : 'text-danger'
                    }`}>
                      {testResult.ok ? (
                        <CheckCircle2 className="size-3" />
                      ) : (
                        <AlertCircle className="size-3" />
                      )}
                      {testResult.ok
                        ? `Connected · ${testResult.latencyMs}ms`
                        : testResult.error ?? 'Test failed'}
                    </span>
                  )}
                </div>
              )}
            </Field>

            <Field>
              <FieldLabel>Priority</FieldLabel>
              <Input
                type="number"
                min="0"
                value={form.priority}
                onChange={(e) => update('priority', e.target.value)}
              />
              <FieldDescription>
                Higher numbers win. The default "0" puts this key on equal footing with the others.
              </FieldDescription>
            </Field>

            {error && (
              <div className="flex items-start gap-2 text-[11px] text-danger">
                <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {submitting && (
              <div className="flex items-center gap-2 text-[11px] text-fg-muted">
                <Loader2 className="size-3 animate-spin" />
                <span>Encrypting and saving…</span>
              </div>
            )}
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
            <Button
              type="submit"
              loading={submitting}
              disabled={submitting || !form.apiKey.trim()}
              leftIcon={<Plus className="size-3.5" />}
            >
              Add key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
