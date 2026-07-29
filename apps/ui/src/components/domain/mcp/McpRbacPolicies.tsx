import { Shield, Plus, Trash2, Lock, Unlock, Users } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/primitives/Dialog';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Switch } from '@/components/primitives/Switch';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import type { ApiRbacPolicy } from '@/types/api';

export function McpRbacPolicies() {
  // /admin/mcp/rbac/policies only returns { policies }. The `enabled` flag
  // lives on the combined /admin/mcp/config `rbac.enabled` field, so this
  // toggle is local-only until that's wired up.
  const config = useApiData<{ policies: ApiRbacPolicy[] }>(Admin.listRbacPolicies, []);
  const [saving, setSaving] = React.useState(false);
  const [enabled, setEnabled] = React.useState(true);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // New policy form
  const [policyName, setPolicyName] = React.useState('');
  const [policyEffect, setPolicyEffect] = React.useState<'allow' | 'deny'>('allow');
  const [policyPrincipals, setPolicyPrincipals] = React.useState('');
  const [policyActions, setPolicyActions] = React.useState('');
  const [policyResources, setPolicyResources] = React.useState('');

  const policies = config.data?.policies ?? [];

  const resetForm = () => {
    setPolicyName('');
    setPolicyEffect('allow');
    setPolicyPrincipals('');
    setPolicyActions('');
    setPolicyResources('');
  };

  const handleCreate = async () => {
    if (!policyName.trim()) {
      toast.error('Policy name is required');
      return;
    }
    setSaving(true);
    try {
      await Admin.createRbacPolicy({
        id: policyName.toLowerCase().replace(/\s+/g, '-'),
        name: policyName,
        effect: policyEffect,
        principals: policyPrincipals.split(',').map((s) => s.trim()).filter(Boolean),
        actions: policyActions.split(',').map((s) => s.trim()).filter(Boolean),
        resources: policyResources.split(',').map((s) => s.trim()).filter(Boolean),
      });
      toast.success('Policy created');
      setDialogOpen(false);
      resetForm();
      await config.refetch();
    } catch (err) {
      toast.error('Failed to create policy', { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await Admin.deleteRbacPolicy(id);
      toast.success('Policy deleted');
      await config.refetch();
    } catch (err) {
      toast.error('Failed to delete policy', { description: err instanceof Error ? err.message : String(err) });
    }
  };

  if (config.isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="size-4 text-primary" />
            RBAC Policy Engine
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">Enable RBAC</p>
              <p className="text-[10px] text-fg-muted">Cedar-like policy engine for tool-level access control</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </CardContent>
      </Card>

      {enabled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xs flex items-center gap-2">
              <Lock className="size-3.5 text-primary" />
              Policies
              <Badge tone="muted" size="sm" className="ml-auto">{policies.length}</Badge>
              <Button size="icon-sm" onClick={() => { resetForm(); setDialogOpen(true); }}>
                <Plus className="size-3" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {policies.length === 0 ? (
              <div className="text-center py-6">
                <Shield className="size-8 text-fg-subtle mx-auto mb-2" />
                <p className="text-xs text-fg-muted">No RBAC policies defined</p>
                <p className="text-[10px] text-fg-subtle mt-1">Create policies to control tool access</p>
              </div>
            ) : (
              <div className="space-y-2">
                {policies.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-start gap-3 p-3 bg-surface-2 rounded-lg"
                  >
                    <div className="mt-0.5">
                      {p.effect === 'allow' ? (
                        <Unlock className="size-4 text-success" />
                      ) : (
                        <Lock className="size-4 text-danger" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold">{p.name}</span>
                        <Badge
                          tone={p.effect === 'allow' ? 'primary' : 'danger'}
                          size="sm"
                        >
                          {p.effect}
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-[10px] text-fg-muted">
                          <Users className="size-2.5" />
                          Principals: {p.principals.join(', ') || '*'}
                        </div>
                        <div className="text-[10px] text-fg-muted">
                          Actions: {p.actions.join(', ') || '*'}
                        </div>
                        <div className="text-[10px] text-fg-muted">
                          Resources: {p.resources.join(', ') || '*'}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id)}
                      className="text-fg-subtle hover:text-danger transition-colors shrink-0"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create Policy Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create RBAC Policy</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <label className="text-xs font-medium">Policy Name</label>
              <Input
                value={policyName}
                onChange={(e) => setPolicyName(e.target.value)}
                placeholder="e.g., admin-full-access"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium">Effect</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPolicyEffect('allow')}
                  className={`p-2 text-xs rounded-lg border transition-colors flex items-center justify-center gap-2 ${
                    policyEffect === 'allow'
                      ? 'border-success bg-success/10 text-success'
                      : 'border-border bg-surface-2 text-fg-muted'
                  }`}
                >
                  <Unlock className="size-3" />
                  Allow
                </button>
                <button
                  type="button"
                  onClick={() => setPolicyEffect('deny')}
                  className={`p-2 text-xs rounded-lg border transition-colors flex items-center justify-center gap-2 ${
                    policyEffect === 'deny'
                      ? 'border-danger bg-danger/10 text-danger'
                      : 'border-border bg-surface-2 text-fg-muted'
                  }`}
                >
                  <Lock className="size-3" />
                  Deny
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium">Principals</label>
              <Input
                value={policyPrincipals}
                onChange={(e) => setPolicyPrincipals(e.target.value)}
                placeholder="user:admin, user:service:*, ..."
              />
              <p className="text-[10px] text-fg-subtle">Comma-separated (e.g., user:admin, user:service:*)</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium">Actions</label>
              <Input
                value={policyActions}
                onChange={(e) => setPolicyActions(e.target.value)}
                placeholder="tool:invoke, tool:list, *"
              />
              <p className="text-[10px] text-fg-subtle">Comma-separated (e.g., tool:invoke, tool:list)</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium">Resources</label>
              <Input
                value={policyResources}
                onChange={(e) => setPolicyResources(e.target.value)}
                placeholder="tool:*, tool:dmrx_chat, ..."
              />
              <p className="text-[10px] text-fg-subtle">Comma-separated (e.g., tool:*, tool:dmrx_chat)</p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} loading={saving}>
                Create Policy
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
