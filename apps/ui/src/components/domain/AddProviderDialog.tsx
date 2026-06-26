import {
  Plus, KeyRound, Globe, Cpu, Server, ExternalLink, Loader2, CheckCircle2, AlertCircle, Clock,
} from 'lucide-react';
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
import type { ApiCatalogEntry, ApiProviderOAuthStart } from '@/types/api';

export interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: ApiCatalogEntry | null;
  onCreated?: () => void;
  /** Force the key tier. When set, all keys added through this dialog
   * will be tagged with this tier instead of relying on the backend
   * default. The Free Tier page passes 'free' here. */
  forceTier?: 'free' | 'paid';
}

const ADAPTER_PRESETS: { id: string; label: string; baseUrl?: string }[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com' },
  { id: 'cohere', label: 'Cohere', baseUrl: 'https://api.cohere.ai/v1' },
  { id: 'google', label: 'Google', baseUrl: 'https://generativelanguage.googleapis.com/v1' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1' },
  { id: 'pollinations', label: 'Pollinations (free, no key)', baseUrl: 'https://text.pollinations.ai/openai' },
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

type OAuthStep =
  | 'idle'
  | 'creating_provider'
  | 'authorizing'
  | 'waiting_for_auth'
  | 'polling'
  | 'completed'
  | 'error';

interface OAuthState {
  step: OAuthStep;
  providerId: string | null;
  response: ApiProviderOAuthStart | null;
  errorMessage: string;
}

const OAUTH_IDLE: OAuthState = { step: 'idle', providerId: null, response: null, errorMessage: '' };

const DEVICE_CODE_POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEVICE_CODE_POLL_INTERVAL_MS = 3000; // 3 seconds

export function AddProviderDialog({
  open,
  onOpenChange,
  template,
  onCreated,
  forceTier,
}: AddProviderDialogProps) {
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({});
  const [oauth, setOauth] = React.useState<OAuthState>(OAUTH_IDLE);

  const popupRef = React.useRef<Window | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = React.useRef(true);

  const hasOAuthConfig = !!(template?.authMethod === 'oauth' || template?.oauthConfig?.flow);
  const oauthFlowType = hasOAuthConfig
    ? (template!.oauthConfig?.flow ?? 'authorization_code')
    : undefined;
  const isOAuthFlowActive = oauth.step !== 'idle' && oauth.step !== 'completed' && oauth.step !== 'error';

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const stopPolling = React.useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null; }
  }, []);

  const closePopup = React.useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }
    popupRef.current = null;
  }, []);

  React.useEffect(() => {
    if (!open) {
      stopPolling();
      closePopup();
      setOauth(OAUTH_IDLE);
    }
  }, [open, stopPolling, closePopup]);

  React.useEffect(() => {
    if (open) {
      setErrors({});
      setOauth(OAUTH_IDLE);
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

  const setOAuthStep = (partial: Partial<OAuthState>) => {
    setOauth((prev) => ({ ...prev, ...partial }));
  };

  const triggerAuthorizeFlow = async () => {
    if (!template) return;
    setOAuthStep({ step: 'creating_provider', errorMessage: '' });
    try {
      const { provider } = await Admin.activateProvider({ template_id: template.id, tier: forceTier });
      const providerId = provider.id;
      setOAuthStep({ step: 'authorizing', providerId });

      const oauthResp = await Admin.startProviderOAuth(providerId);
      setOAuthStep({ step: 'waiting_for_auth', providerId, response: oauthResp });

      const authUrl = oauthResp.authorizationUrl ?? oauthResp.authUrl;
      if (!authUrl) {
        throw new Error('No authorization URL returned from server');
      }

      popupRef.current = window.open(authUrl, 'oauth-popup', 'width=600,height=700');
      if (!popupRef.current) {
        throw new Error('Popup was blocked. Please allow popups for this site and try again.');
      }

      const checkPopupClosed = () => {
        if (!popupRef.current || popupRef.current.closed) {
          popupRef.current = null;
          clearInterval(pollRef.current!);
          pollRef.current = null;
          handleOAuthCallback(providerId);
        }
      };
      pollRef.current = setInterval(checkPopupClosed, 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOAuthStep({ step: 'error', errorMessage: msg });
      toast.error('OAuth authorization failed', { description: msg });
    }
  };

  const handleOAuthCallback = async (providerId: string) => {
    if (!mountedRef.current) return;
    try {
      const status = await Admin.getProviderOAuthStatus(providerId);
      if (status.hasOAuth && !status.isExpired) {
        setOAuthStep({ step: 'completed', providerId });
        toast.success('Provider authorized successfully');
        onCreated?.();
        onOpenChange(false);
      } else {
        setOAuthStep({ step: 'error', providerId, errorMessage: 'Authorization was not completed. Please try again.' });
        toast.error('OAuth not completed', { description: 'Authorization did not complete successfully.' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOAuthStep({ step: 'error', providerId, errorMessage: msg });
      toast.error('Failed to verify OAuth status', { description: msg });
    }
  };

  const triggerDeviceCodeFlow = async () => {
    if (!template) return;
    setOAuthStep({ step: 'creating_provider', errorMessage: '' });
    try {
      const { provider } = await Admin.activateProvider({ template_id: template.id, tier: forceTier });
      const providerId = provider.id;
      setOAuthStep({ step: 'authorizing', providerId });

      const oauthResp = await Admin.startProviderOAuth(providerId);
      if (!oauthResp.deviceCode) {
        throw new Error('No device code returned from server');
      }
      setOAuthStep({ step: 'waiting_for_auth', providerId, response: oauthResp });

      const deviceCode = oauthResp.deviceCode;

      pollTimeoutRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        stopPolling();
        setOAuthStep({
          step: 'error',
          providerId,
          errorMessage: 'Device code expired. Please try again.',
        });
        toast.error('Device code timed out', { description: 'Authorization took longer than 5 minutes.' });
      }, DEVICE_CODE_POLL_TIMEOUT_MS);

      const doPoll = async () => {
        if (!mountedRef.current) return;
        try {
          const result = await Admin.pollProviderOAuthDeviceCode(providerId, deviceCode);
          if (!mountedRef.current) return;

          if (result.status === 'authorized') {
            stopPolling();
            setOAuthStep({ step: 'completed', providerId });
            toast.success('Provider authorized successfully');
            onCreated?.();
            onOpenChange(false);
          } else if (result.status === 'expired' || result.status === 'denied') {
            stopPolling();
            const msg = result.status === 'expired' ? 'Authorization expired.' : 'Authorization denied.';
            setOAuthStep({ step: 'error', providerId, errorMessage: msg });
            toast.error('Authorization failed', { description: msg });
          }
        } catch (err) {
          if (!mountedRef.current) return;
          const msg = err instanceof Error ? err.message : String(err);
          setOAuthStep({ step: 'error', providerId, errorMessage: msg });
          toast.error('Polling failed', { description: msg });
          stopPolling();
        }
      };

      pollRef.current = setInterval(doPoll, DEVICE_CODE_POLL_INTERVAL_MS);
      doPoll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOAuthStep({ step: 'error', errorMessage: msg });
      toast.error('OAuth authorization failed', { description: msg });
    }
  };

  const triggerClientCredentialsFlow = async () => {
    if (!template) return;
    setOAuthStep({ step: 'creating_provider', errorMessage: '' });
    try {
      const { provider } = await Admin.activateProvider({ template_id: template.id, tier: forceTier });
      const providerId = provider.id;
      setOAuthStep({ step: 'authorizing', providerId });

      await Admin.startProviderOAuth(providerId);
      setOAuthStep({ step: 'completed', providerId });
      toast.success('Provider connected successfully');
      onCreated?.();
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOAuthStep({ step: 'error', errorMessage: msg });
      toast.error('OAuth connection failed', { description: msg });
    }
  };

  const handleOAuthCancel = () => {
    stopPolling();
    closePopup();
    setOauth(OAUTH_IDLE);
  };

  const getOAuthActionLabel = (): string => {
    switch (oauthFlowType) {
      case 'authorization_code':
      case 'pkce':
        return 'Authorize with Provider';
      case 'device_code':
        return 'Connect Provider';
      case 'client_credentials':
        return 'Connect with OAuth';
      default:
        return 'Authorize';
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
    if (!validate() || isOAuthFlowActive) return;
    if (oauth.step === 'completed') {
      onCreated?.();
      onOpenChange(false);
      return;
    }
    setSubmitting(true);
    try {
      const apiKeyProvided = !!form.apiKey.trim();
      if (hasOAuthConfig && !apiKeyProvided) {
        switch (oauthFlowType) {
          case 'authorization_code':
          case 'pkce':
            await triggerAuthorizeFlow();
            return;
          case 'device_code':
            await triggerDeviceCodeFlow();
            return;
          case 'client_credentials':
            await triggerClientCredentialsFlow();
            return;
        }
      }
      const oauthAccessToken = form.oauthAccessToken.trim();
      const apiKey = form.apiKey.trim();
      const created = template
        ? (await Admin.activateProvider({
            template_id: template.id,
            api_key: apiKey || undefined,
            oauth_access_token: oauthAccessToken || undefined,
            auth_method: oauthAccessToken ? 'oauth' : 'api_key',
            tier: forceTier,
          })).provider
        : await Admin.createProvider({
            name: form.name.trim(),
            adapterType: form.adapterType.trim(),
            baseUrl: form.baseUrl.trim() || null,
            apiKeyRef: apiKey || null,
            config: {
              region: form.region.trim() || undefined,
              priority: Number(form.priority) || 0,
              enabled: true,
            },
            tier: forceTier,
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
              {forceTier === 'free' && (
                <Badge tone="success" size="sm" className="mt-1">
                  Free-tier key
                </Badge>
              )}
            </Field>

            {hasOAuthConfig ? (
              <div className="space-y-3 rounded-lg border border-border bg-surface-2/30 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <KeyRound className="size-3.5 text-fg-muted" />
                  <span className="text-[10px] text-fg-muted uppercase tracking-wider font-semibold">
                    OAuth Authorization
                  </span>
                  {oauth.step === 'completed' && (
                    <Badge tone="success" className="ml-auto text-[10px]">Connected</Badge>
                  )}
                </div>

                {/* IDLE state — info text */}
                {oauth.step === 'idle' && (
                  <p className="text-[11px] text-fg-muted leading-relaxed">
                    {oauthFlowType === 'authorization_code' || oauthFlowType === 'pkce'
                      ? 'Authorize this provider via OAuth. Click "Authorize with Provider" below to start.'
                      : oauthFlowType === 'device_code'
                        ? 'Use a device code to authorize this provider. Click "Connect Provider" below to start.'
                        : 'Connect this provider using client credentials OAuth flow.'}
                  </p>
                )}

                {/* CREATING_PROVIDER / AUTHORIZING state — spinner */}
                {(oauth.step === 'creating_provider' || oauth.step === 'authorizing') && (
                  <div className="flex items-center gap-2.5 py-2">
                    <Loader2 className="size-4 animate-spin text-primary" />
                    <span className="text-[11px] text-fg-muted">
                      {oauth.step === 'creating_provider' ? 'Creating provider...' : 'Initiating authorization...'}
                    </span>
                  </div>
                )}

                {/* WAITING_FOR_AUTH — device code or popup waiting */}
                {oauth.step === 'waiting_for_auth' && oauthFlowType === 'device_code' && oauth.response && (
                  <div className="rounded-lg border border-border bg-surface-2/50 p-3 space-y-2.5">
                    <div className="flex items-start gap-2">
                      <Clock className="size-3.5 text-fg-muted shrink-0 mt-0.5" />
                      <div className="text-[11px] text-fg-muted leading-relaxed space-y-1">
                        <p>
                          <span className="text-fg font-medium">1.</span> Visit{' '}
                          <code className="bg-surface-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-primary">
                            {oauth.response.verificationUri ?? 'the provider\'s website'}
                          </code>
                        </p>
                        <p>
                          <span className="text-fg font-medium">2.</span> Enter code:{' '}
                          <code className="bg-surface-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-primary font-bold select-all">
                            {oauth.response.userCode ?? oauth.response.deviceCode}
                          </code>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-fg-muted">
                      <Loader2 className="size-3 animate-spin" />
                      <span>Waiting for you to authorize...</span>
                    </div>
                  </div>
                )}

                {oauth.step === 'waiting_for_auth' && (oauthFlowType === 'authorization_code' || oauthFlowType === 'pkce') && (
                  <div className="flex items-center gap-2.5 py-2">
                    <Loader2 className="size-4 animate-spin text-primary" />
                    <span className="text-[11px] text-fg-muted">
                      Please complete authorization in the popup window...
                    </span>
                  </div>
                )}

                {oauth.step === 'waiting_for_auth' && oauthFlowType === 'client_credentials' && (
                  <div className="flex items-center gap-2.5 py-2">
                    <Loader2 className="size-4 animate-spin text-primary" />
                    <span className="text-[11px] text-fg-muted">Exchanging credentials...</span>
                  </div>
                )}

                {/* POLLING state */}
                {oauth.step === 'polling' && (
                  <div className="flex items-center gap-2.5 py-2">
                    <Loader2 className="size-4 animate-spin text-primary" />
                    <span className="text-[11px] text-fg-muted">Completing authorization...</span>
                  </div>
                )}

                {/* ERROR state */}
                {oauth.step === 'error' && (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="size-3.5 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-red-500 leading-relaxed">{oauth.errorMessage}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleOAuthCancel}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}

                {/* Cancel button during active flow */}
                {(oauth.step === 'waiting_for_auth' || oauth.step === 'polling') && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleOAuthCancel}
                    className="text-fg-muted"
                  >
                    Cancel
                  </Button>
                )}
              </div>
            ) : (
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
            )}

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
              disabled={submitting || isOAuthFlowActive}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={submitting || isOAuthFlowActive}
              disabled={isOAuthFlowActive}
              leftIcon={
                oauth.step === 'completed'
                  ? <CheckCircle2 className="size-3.5" />
                  : hasOAuthConfig
                    ? <ExternalLink className="size-3.5" />
                    : <Plus className="size-3.5" />
              }
            >
              {oauth.step === 'completed'
                ? 'Done'
                : hasOAuthConfig
                  ? getOAuthActionLabel()
                  : 'Create provider'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
