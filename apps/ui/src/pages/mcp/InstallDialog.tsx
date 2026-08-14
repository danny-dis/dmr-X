import { ExternalLink } from 'lucide-react';
import * as React from 'react';

import { TestResultPanel } from './TestResultPanel';

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
import { interpretError } from '@/components/primitives/ErrorState';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/primitives/Field';
import { Input } from '@/components/primitives/Input';
import { toast } from '@/components/primitives/Toast';
import {
  useInstallMcpServer,
  useTestMcpServer,
  type McpCatalogEntry,
  type McpTestResult,
} from '@/lib/queries/mcp';

/**
 * Install a catalog entry.
 *
 * The credential form is generated from the entry's `requiredEnv` rather than
 * hand-written per server, so adding a server to the catalog needs no UI
 * change. Values are substituted into `{{TOKEN}}` args where the server takes
 * them positionally (filesystem, postgres) and exported as env vars otherwise.
 */
export function InstallDialog({
  entry,
  onClose,
}: {
  entry: McpCatalogEntry | null;
  onClose: () => void;
}) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [test, setTest] = React.useState<McpTestResult | null>(null);
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});

  const testMutation = useTestMcpServer();
  const installMutation = useInstallMcpServer();

  // Reset whenever a different catalog entry is opened.
  React.useEffect(() => {
    setValues({});
    setTest(null);
    setTouched({});
  }, [entry?.id]);

  if (!entry) return null;

  const missing = entry.requiredEnv.filter((v) => !v.optional && !values[v.key]?.trim());
  const canSubmit = missing.length === 0;

  /**
   * Build the same server config the install endpoint will, so "Test" proves
   * the actual configuration rather than an approximation of it.
   */
  const buildPreview = () => {
    const consumed = new Set(
      (entry.args ?? []).flatMap((a) => [...a.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])),
    );
    const args = (entry.args ?? []).map((a) =>
      a.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => values[key]?.trim() || whole),
    );
    const env = Object.fromEntries(
      Object.entries(values).filter(([k, v]) => !consumed.has(k) && v.trim() !== ''),
    );

    let apiKey: string | undefined;
    if (entry.transport === 'http' || entry.transport === 'sse') {
      const secretKeys = new Set(entry.requiredEnv.filter((v) => v.secret).map((v) => v.key));
      for (const key of secretKeys) {
        if (env[key]) {
          apiKey = apiKey ?? env[key];
          delete env[key];
        }
      }
    }

    return {
      name: entry.name,
      transport: entry.transport,
      ...(entry.command ? { command: entry.command } : {}),
      ...(args.length ? { args } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      ...(entry.url ? { url: entry.url } : {}),
    };
  };

  return (
    <Dialog open={!!entry} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Install {entry.name}</DialogTitle>
          <DialogDescription>{entry.description}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {entry.requiredEnv.length === 0 ? (
            <p className="text-sm text-fg-muted">
              This server needs no configuration — install it directly.
            </p>
          ) : (
            entry.requiredEnv.map((v) => {
              const fieldError =
                touched[v.key] && !v.optional && !values[v.key]?.trim() ? `${v.label} is required.` : null;
              return (
                <Field key={v.key}>
                  <FieldLabel htmlFor={`env-${v.key}`}>
                    {v.label}
                    {v.optional && <span className="ml-1.5 text-2xs text-fg-subtle">optional</span>}
                  </FieldLabel>
                  <Input
                    id={`env-${v.key}`}
                    type={v.secret ? 'password' : 'text'}
                    autoComplete="off"
                    placeholder={v.placeholder}
                    value={values[v.key] ?? ''}
                    invalid={!!fieldError}
                    onChange={(e) => {
                      setValues((prev) => ({ ...prev, [v.key]: e.target.value }));
                      setTest(null);
                    }}
                    onBlur={() => setTouched((t) => ({ ...t, [v.key]: true }))}
                  />
                  {fieldError && <FieldError>{fieldError}</FieldError>}
                  {v.help && <FieldDescription>{v.help}</FieldDescription>}
                </Field>
              );
            })
          )}

          <div className="rounded-lg border border-border bg-surface-2 p-2.5">
            <div className="mb-1 text-2xs uppercase tracking-wide text-fg-subtle">Command</div>
            <code className="block break-all font-mono text-2xs text-fg-muted">
              {entry.transport === 'stdio'
                ? `${entry.command} ${(buildPreview().args ?? []).join(' ')}`
                : entry.url}
            </code>
          </div>

          {test && <TestResultPanel result={test} />}

          {entry.docsUrl && (
            <a
              href={entry.docsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              Documentation <ExternalLink className="size-3" />
            </a>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {entry.requiredEnv.length === 0 ? (
            <Button
              loading={installMutation.isPending}
              onClick={() =>
                installMutation.mutate(
                  { catalogId: entry.id, values },
                  {
                    onSuccess: (server) => {
                      toast.success(`${entry.name} installed`, {
                        description: `${server.toolCount} tool${server.toolCount === 1 ? '' : 's'} available.`,
                      });
                      onClose();
                    },
                    onError: (e) => {
                      const interpreted = interpretError(e);
                      toast.error(`Could not install ${entry.name}`, { description: interpreted.description });
                    },
                  },
                )
              }
            >
              Install
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                disabled={!canSubmit}
                loading={testMutation.isPending}
                onClick={() =>
                  testMutation.mutate(buildPreview() as never, {
                    onSuccess: setTest,
                    onError: (e) => {
                      const interpreted = interpretError(e);
                      toast.error(`Could not test ${entry.name}`, { description: interpreted.description });
                    },
                  })
                }
              >
                Test
              </Button>
              <Button
                disabled={!canSubmit}
                loading={installMutation.isPending}
                onClick={() =>
                  installMutation.mutate(
                    { catalogId: entry.id, values },
                    {
                      onSuccess: (server) => {
                        toast.success(`${entry.name} installed`, {
                          description: `${server.toolCount} tool${server.toolCount === 1 ? '' : 's'} available.`,
                        });
                        onClose();
                      },
                      onError: (e) => {
                        const interpreted = interpretError(e);
                        toast.error(`Could not install ${entry.name}`, { description: interpreted.description });
                      },
                    },
                  )
                }
              >
                Install
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
