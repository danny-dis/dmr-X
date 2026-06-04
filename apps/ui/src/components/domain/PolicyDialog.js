import * as React from 'react';
import { Shield, Plus, Hash, Zap, Tag, Box } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter, } from '@/components/primitives/Dialog';
import { Button } from '@/components/primitives/Button';
import { Input } from '@/components/primitives/Input';
import { Switch } from '@/components/primitives/Switch';
import { Field, FieldLabel, FieldDescription, FieldError } from '@/components/primitives/Field';
import { toast } from '@/components/primitives/Toast';
import { Admin } from '@/lib/admin';
const ACTIONS = [
    { id: 'allow', label: 'allow', description: 'Permit the matched request' },
    { id: 'deny', label: 'deny', description: 'Block the matched request' },
    { id: 'redirect', label: 'redirect', description: 'Route to an alternative model' },
    { id: 'rate_limit', label: 'rate_limit', description: 'Apply a rate limit' },
    { id: 'tag', label: 'tag', description: 'Tag the request for downstream rules' },
];
const MODALITIES = [
    { id: 'llm', label: 'llm' },
    { id: 'embedding', label: 'embedding' },
    { id: 'diffusion', label: 'diffusion' },
    { id: 'audio_tts', label: 'audio_tts' },
    { id: 'audio_stt', label: 'audio_stt' },
    { id: 'video', label: 'video' },
    { id: 'music', label: 'music' },
    { id: 'reranking', label: 'reranking' },
    { id: 'moderation', label: 'moderation' },
    { id: 'code_completion', label: 'code_completion' },
    { id: 'image', label: 'image' },
];
const EMPTY = {
    name: '',
    description: '',
    action: 'allow',
    priority: '100',
    enabled: true,
    matchModel: '',
    matchTenantId: '',
    matchTag: '',
    matchModality: '',
};
export function PolicyDialog({ open, onOpenChange, policy, onSaved }) {
    const [form, setForm] = React.useState(EMPTY);
    const [submitting, setSubmitting] = React.useState(false);
    const [errors, setErrors] = React.useState({});
    const isEdit = !!policy;
    React.useEffect(() => {
        if (open) {
            setErrors({});
            if (policy) {
                setForm({
                    name: policy.name,
                    description: policy.description ?? '',
                    action: policy.action,
                    priority: String(policy.priority ?? 100),
                    enabled: policy.enabled ?? true,
                    matchModel: policy.match?.model ?? '',
                    matchTenantId: policy.match?.tenantId ?? '',
                    matchTag: policy.match?.tag ?? '',
                    matchModality: policy.match?.modality ?? '',
                });
            }
            else {
                setForm(EMPTY);
            }
        }
    }, [open, policy]);
    const update = (key, value) => {
        setForm((prev) => ({ ...prev, [key]: value }));
        if (errors[key])
            setErrors((prev) => ({ ...prev, [key]: undefined }));
    };
    const validate = () => {
        const next = {};
        if (!form.name.trim())
            next.name = 'Name is required';
        if (form.priority) {
            const n = Number(form.priority);
            if (Number.isNaN(n) || n < 0)
                next.priority = 'Priority must be a non-negative number';
        }
        setErrors(next);
        return Object.keys(next).length === 0;
    };
    const buildMatch = () => {
        const match = {};
        if (form.matchModel.trim())
            match.model = form.matchModel.trim();
        if (form.matchTenantId.trim())
            match.tenantId = form.matchTenantId.trim();
        if (form.matchTag.trim())
            match.tag = form.matchTag.trim();
        if (form.matchModality)
            match.modality = form.matchModality;
        return Object.keys(match).length > 0 ? match : undefined;
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate())
            return;
        setSubmitting(true);
        try {
            const body = {
                id: policy?.id,
                name: form.name.trim(),
                description: form.description.trim() || undefined,
                action: form.action,
                priority: Number(form.priority) || 0,
                enabled: form.enabled,
                match: buildMatch(),
            };
            const saved = await Admin.upsertPolicy(body);
            toast.success(isEdit ? 'Policy updated' : 'Policy created', { description: saved.name });
            onSaved?.();
            onOpenChange(false);
        }
        catch (err) {
            toast.error(isEdit ? 'Failed to update policy' : 'Failed to create policy', {
                description: err instanceof Error ? err.message : String(err),
            });
        }
        finally {
            setSubmitting(false);
        }
    };
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 max-h-[90vh]">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="size-4 text-fg-muted"/>
              <DialogTitle>{isEdit ? 'Edit policy' : 'New policy'}</DialogTitle>
            </div>
            <DialogDescription>
              {isEdit
            ? 'Update an existing routing or access policy.'
            : 'Define a routing rule, access control, or cost guard.'}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <Field>
              <FieldLabel required>
                <span className="inline-flex items-center gap-1.5">
                  <Hash className="size-3"/>
                  Name
                </span>
              </FieldLabel>
              <Input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Block expensive models for free tier" invalid={!!errors.name} autoFocus/>
              {errors.name && <FieldError>{errors.name}</FieldError>}
            </Field>

            <Field>
              <FieldLabel>Description</FieldLabel>
              <Input value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="Optional context shown in the policy list"/>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>Action</FieldLabel>
                <select value={form.action} onChange={(e) => update('action', e.target.value)} className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20">
                  {ACTIONS.map((a) => (<option key={a.id} value={a.id}>
                      {a.label}
                    </option>))}
                </select>
                <FieldDescription>
                  {ACTIONS.find((a) => a.id === form.action)?.description}
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel>
                  <span className="inline-flex items-center gap-1.5">
                    <Zap className="size-3"/>
                    Priority
                  </span>
                </FieldLabel>
                <Input type="number" min="0" value={form.priority} onChange={(e) => update('priority', e.target.value)} invalid={!!errors.priority}/>
                {errors.priority && <FieldError>{errors.priority}</FieldError>}
                <FieldDescription>
                  Higher priority rules evaluate first.
                </FieldDescription>
              </Field>
            </div>

            <div className="rounded-lg border border-border bg-surface-2/40 p-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-fg">Enabled</div>
                <div className="text-[11px] text-fg-muted">
                  Inactive rules are skipped at evaluation time.
                </div>
              </div>
              <Switch checked={form.enabled} onCheckedChange={(v) => update('enabled', v)} aria-label="Enabled"/>
            </div>

            <div>
              <div className="text-xs font-medium text-fg mb-2">Match conditions</div>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel className="text-[11px]">Model</FieldLabel>
                  <Input value={form.matchModel} onChange={(e) => update('matchModel', e.target.value)} placeholder="gpt-4*" mono/>
                </Field>
                <Field>
                  <FieldLabel className="text-[11px]">Tenant ID</FieldLabel>
                  <Input value={form.matchTenantId} onChange={(e) => update('matchTenantId', e.target.value)} placeholder="tenant-…" mono/>
                </Field>
                <Field>
                  <FieldLabel className="text-[11px]">
                    <span className="inline-flex items-center gap-1">
                      <Tag className="size-3"/>
                      Tag
                    </span>
                  </FieldLabel>
                  <Input value={form.matchTag} onChange={(e) => update('matchTag', e.target.value)} placeholder="prod, internal…"/>
                </Field>
                <Field>
                  <FieldLabel className="text-[11px]">
                    <span className="inline-flex items-center gap-1">
                      <Box className="size-3"/>
                      Modality
                    </span>
                  </FieldLabel>
                  <select value={form.matchModality} onChange={(e) => update('matchModality', e.target.value)} className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20">
                    <option value="">any</option>
                    {MODALITIES.map((m) => (<option key={m.id} value={m.id}>
                        {m.label}
                      </option>))}
                  </select>
                </Field>
              </div>
              <FieldDescription className="mt-2">
                Empty match fields are treated as wildcards.
              </FieldDescription>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} leftIcon={isEdit ? undefined : <Plus className="size-3.5"/>}>
              {isEdit ? 'Save changes' : 'Create policy'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
}
//# sourceMappingURL=PolicyDialog.js.map