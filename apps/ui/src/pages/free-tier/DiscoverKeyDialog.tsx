import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Search, XCircle } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/primitives/Dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/primitives/Field';
import { Input } from '@/components/primitives/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { toast } from '@/components/primitives/Toast';
import { Admin } from '@/lib/admin';
import { useDiscoverProviderModels } from '@/lib/queries/usage';
import { keys } from '@/lib/queryClient';

type Step = 'enter' | 'discovering' | 'done';

/**
 * Add a free provider key and discover what it unlocks.
 *
 * This is the flow the product promised and never wired: entering a key on the
 * free-tier page should make the router aware of that provider's free models.
 * Two endpoints already existed for it and were called by nothing —
 * `/providers/:id/discover` (list the key's real models) and
 * `/providers/:id/verify-free-batch` (probe which are genuinely free rather
 * than trusting a stale catalog). Activation now chains straight into both,
 * and the result is reported instead of leaving the operator guessing.
 */
export function DiscoverKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [templateId, setTemplateId] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [step, setStep] = React.useState<Step>('enter');
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{
    provider: string;
    discovered: number;
    free: number;
    paid: number;
    verifyError: string | null;
  } | null>(null);

  const discover = useDiscoverProviderModels();

  const catalog = useQuery({
    queryKey: keys.providers.catalog(),
    queryFn: () => Admin.getCatalog(),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const reset = () => {
    setTemplateId('');
    setApiKey('');
    setStep('enter');
    setError(null);
    setResult(null);
  };

  const handleSubmit = async () => {
    if (!templateId || !apiKey.trim()) return;
    setError(null);
    setStep('discovering');

    try {
      // 1. Store the key against the provider, tagged as a free-tier key so
      //    the router's free meta-models can select it.
      const activated = await Admin.activateProvider({
        template_id: templateId,
        api_key: apiKey.trim(),
        tier: 'free',
        key_label: 'free-tier',
      });

      const providerId = (activated.provider as any)?.id;
      if (!providerId) throw new Error('Provider was created but returned no id');

      // 2. Discover + verify. Verification can fail on provider rate limits
      //    without invalidating discovery, so it is reported separately.
      const { discovered, verified, verifyError } = await discover.mutateAsync(providerId);

      setResult({
        provider: discovered.provider,
        discovered: discovered.discovered,
        free: verified?.freeCount ?? 0,
        paid: verified?.paidCount ?? 0,
        verifyError,
      });
      setStep('done');
      toast.success(`${discovered.provider}: ${discovered.discovered} models discovered`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('enter');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add a free-tier key</DialogTitle>
          <DialogDescription>
            DMR-X will ask the provider which models the key can reach, then probe each one to
            confirm it is genuinely free before routing to it.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {step === 'done' && result ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4" />
                Connected to {result.provider}
              </div>
              <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface-2 p-3">
                <Stat label="Discovered" value={result.discovered} />
                <Stat label="Verified free" value={result.free} tone="success" />
                <Stat label="Paid" value={result.paid} tone="muted" />
              </div>
              {result.verifyError ? (
                <p className="text-xs text-warning">
                  Models were discovered, but the free-tier probe did not finish:{' '}
                  {result.verifyError}. They are classified from the catalog, which can be stale —
                  re-run verification from the provider page.
                </p>
              ) : (
                <p className="text-xs text-fg-muted">
                  The {result.free} verified free model{result.free === 1 ? '' : 's'}{' '}
                  {result.free === 1 ? 'is' : 'are'} now selectable by the <code>free</code> and{' '}
                  <code>auto-free</code> meta-models.
                </p>
              )}
            </div>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="provider">Provider</FieldLabel>
                <Select value={templateId} onValueChange={setTemplateId} disabled={step === 'discovering'}>
                  <SelectTrigger id="provider">
                    <SelectValue placeholder={catalog.isLoading ? 'Loading…' : 'Choose a provider'} />
                  </SelectTrigger>
                  <SelectContent>
                    {(catalog.data?.entries ?? []).map((entry: any) => (
                      <SelectItem key={entry.id ?? entry.template_id} value={entry.id ?? entry.template_id}>
                        {entry.name ?? entry.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="apikey">API key</FieldLabel>
                <Input
                  id="apikey"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={step === 'discovering'}
                  placeholder="sk-…"
                />
                <FieldDescription>
                  Stored encrypted and tagged as a free-tier key.
                </FieldDescription>
              </Field>

              {step === 'discovering' && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm text-fg-muted">
                  <Loader2 className="size-4 animate-spin" />
                  Discovering models and verifying which are free. This can take a minute for
                  providers with large catalogues.
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
                  <XCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </DialogBody>

        <DialogFooter>
          {step === 'done' ? (
            <Button onClick={() => { reset(); onOpenChange(false); }}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={step === 'discovering'}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!templateId || !apiKey.trim() || step === 'discovering'}
                loading={step === 'discovering'}
                leftIcon={<Search className="size-4" />}
              >
                Add &amp; discover
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'muted' }) {
  return (
    <div>
      <div
        className={
          tone === 'success'
            ? 'text-xl font-semibold tabular-nums text-success'
            : tone === 'muted'
              ? 'text-xl font-semibold tabular-nums text-fg-muted'
              : 'text-xl font-semibold tabular-nums text-fg'
        }
      >
        {value}
      </div>
      <div className="text-2xs text-fg-subtle">{label}</div>
    </div>
  );
}
