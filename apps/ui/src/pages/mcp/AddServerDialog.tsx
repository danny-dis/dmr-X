import { CheckCircle2 } from 'lucide-react';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { toast } from '@/components/primitives/Toast';
import { useAddMcpServer, useTestMcpServer, type McpServerInput, type McpTestResult } from '@/lib/queries/mcp';

/**
 * Add a server manually.
 *
 * Test-before-save is the whole point: the operator can prove the command or
 * URL works, and see the tools it exposes, before anything is written. A
 * failing configuration is refused by the server rather than persisted in a
 * broken state.
 */
export function AddServerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [transport, setTransport] = React.useState<'stdio' | 'sse'>('stdio');
  const [name, setName] = React.useState('');
  const [command, setCommand] = React.useState('npx');
  const [argsText, setArgsText] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [test, setTest] = React.useState<McpTestResult | null>(null);
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});

  const testMutation = useTestMcpServer();
  const addMutation = useAddMcpServer();

  const reset = () => {
    setTransport('stdio');
    setName('');
    setCommand('npx');
    setArgsText('');
    setUrl('');
    setApiKey('');
    setTest(null);
    setTouched({});
  };

  const markTouched = (field: string) => setTouched((t) => ({ ...t, [field]: true }));

  const nameError = touched.name && !name.trim() ? 'Name is required.' : null;
  const commandError =
    touched.command && transport === 'stdio' && !command.trim() ? 'Command is required.' : null;
  const urlError = touched.url && transport === 'sse' && !url.trim() ? 'URL is required.' : null;

  const build = (): McpServerInput => ({
    name: name.trim(),
    transport,
    ...(transport === 'stdio'
      ? {
          command: command.trim(),
          // Split on whitespace but keep quoted segments together, so a path
          // with spaces survives.
          args: (argsText.match(/"[^"]*"|\S+/g) ?? []).map((a) => a.replace(/^"|"$/g, '')),
        }
      : { url: url.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }),
  });

  const canSubmit =
    name.trim().length > 0 && (transport === 'stdio' ? command.trim().length > 0 : url.trim().length > 0);

  const handleTest = () => {
    setTest(null);
    testMutation.mutate(build(), {
      onSuccess: setTest,
      onError: (e) => {
        const interpreted = interpretError(e);
        toast.error(`Could not test "${name.trim()}"`, { description: interpreted.description });
      },
    });
  };

  const handleSave = () => {
    addMutation.mutate(build(), {
      onSuccess: (server) => {
        toast.success(`${server.name} connected`, {
          description: `${server.toolCount} tool${server.toolCount === 1 ? '' : 's'} available.`,
        });
        reset();
        onOpenChange(false);
      },
      onError: (e) => {
        const interpreted = interpretError(e);
        toast.error(`Could not add "${name.trim()}"`, { description: interpreted.description });
      },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Add MCP server</DialogTitle>
          <DialogDescription>
            The connection is tested before anything is saved, so a bad command or URL is reported
            here rather than failing later inside an agent run.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <Tabs value={transport} onValueChange={(v) => { setTransport(v as 'stdio' | 'sse'); setTest(null); }}>
            <TabsList>
              <TabsTrigger value="stdio">Local process (stdio)</TabsTrigger>
              <TabsTrigger value="sse">Remote (SSE)</TabsTrigger>
            </TabsList>
          </Tabs>

          <Field>
            <FieldLabel htmlFor="mcp-name">Name</FieldLabel>
            <Input
              id="mcp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => markTouched('name')}
              invalid={!!nameError}
              placeholder="My filesystem server"
            />
            {nameError && <FieldError>{nameError}</FieldError>}
          </Field>

          {transport === 'stdio' ? (
            <>
              <Field>
                <FieldLabel htmlFor="mcp-command">Command</FieldLabel>
                <Input
                  id="mcp-command"
                  value={command}
                  onChange={(e) => { setCommand(e.target.value); setTest(null); }}
                  onBlur={() => markTouched('command')}
                  invalid={!!commandError}
                  placeholder="npx"
                />
                {commandError && <FieldError>{commandError}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-args">Arguments</FieldLabel>
                <Input
                  id="mcp-args"
                  value={argsText}
                  onChange={(e) => { setArgsText(e.target.value); setTest(null); }}
                  placeholder='-y @modelcontextprotocol/server-filesystem "/Users/me/projects"'
                />
                <FieldDescription>
                  Space-separated. Wrap a value containing spaces in double quotes.
                </FieldDescription>
              </Field>
            </>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="mcp-url">URL</FieldLabel>
                <Input
                  id="mcp-url"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setTest(null); }}
                  onBlur={() => markTouched('url')}
                  invalid={!!urlError}
                  placeholder="https://example.com/sse"
                />
                {urlError && <FieldError>{urlError}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-key">API key</FieldLabel>
                <Input
                  id="mcp-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setTest(null); }}
                  placeholder="Optional"
                />
                <FieldDescription>Sent as a bearer token. Stored server-side, never echoed back.</FieldDescription>
              </Field>
            </>
          )}

          {test && <TestResultPanel result={test} />}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={handleTest}
            disabled={!canSubmit}
            loading={testMutation.isPending}
          >
            Test connection
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSubmit}
            loading={addMutation.isPending}
            leftIcon={test?.ok ? <CheckCircle2 className="size-4" /> : undefined}
          >
            Save &amp; connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
