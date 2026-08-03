import { Archive, FileText, Github, Loader2, Upload } from 'lucide-react';
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/primitives/Dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/primitives/Field';
import { Input } from '@/components/primitives/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { Textarea } from '@/components/primitives/Textarea';
import { toast } from '@/components/primitives/Toast';
import { Button } from '@/components/primitives/Button';
import { Admin } from '@/lib/admin';
import { keys } from '@/lib/queryClient';

/** Local category list — mirrors AgentForm's CATEGORIES (the UI-side
 *  vocabulary; the backend accepts any string and maps to its own set). */
const CATEGORIES = [
  'general', 'coding', 'research', 'writing', 'data', 'devops', 'security',
  'support', 'sales', 'marketing', 'finance', 'legal', 'education',
  'productivity', 'creative', 'analysis', 'automation', 'testing', 'other',
];

const MODEL_TIERS = [
  { value: 'auto', label: 'Auto — router decides' },
  { value: 'premium', label: 'Premium' },
  { value: 'budget', label: 'Budget' },
] as const;

export interface ImportAgentsResult {
  agents: { imported: number; skipped: number; errors: string[]; agents: unknown[] };
  skills: { imported: number; errors: string[]; skills: unknown[] };
  artifacts: { dir: string; zip: string } | null;
}

export interface ImportAgentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Source = 'github' | 'text' | 'zip';

/**
 * Modal that imports agent definitions from a GitHub repo, a pasted
 * .md/.agent/.json file, or a ZIP archive.
 *
 * Backs on to the existing POST /v1/agents/import endpoint (github/zip
 * fetch many files; text imports a single pasted definition). Skills are
 * imported alongside agents in the same call.
 */
export function ImportAgentsDialog({ open, onOpenChange }: ImportAgentsDialogProps) {
  const qc = useQueryClient();

  const [source, setSource] = React.useState<Source>('github');
  const [githubUrl, setGithubUrl] = React.useState('');
  const [content, setContent] = React.useState('');
  const [filename, setFilename] = React.useState('');
  const [zipFile, setZipFile] = React.useState<File | null>(null);
  const [category, setCategory] = React.useState('');
  const [modelTier, setModelTier] = React.useState<'auto' | 'premium' | 'budget'>('auto');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ImportAgentsResult | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const reset = React.useCallback(() => {
    setSource('github');
    setGithubUrl('');
    setContent('');
    setFilename('');
    setZipFile(null);
    setCategory('');
    setModelTier('auto');
    setPending(false);
    setError(null);
    setResult(null);
  }, []);

  const handleClose = (next: boolean) => {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  };

  const validate = (): string | null => {
    if (source === 'github' && !githubUrl.trim()) return 'Enter a GitHub repository URL';
    if (source === 'text' && !content.trim()) return 'Paste an agent definition to import';
    if (source === 'zip' && !zipFile) return 'Choose a ZIP file to import';
    return null;
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const res = (await Admin.importAgents({
        source,
        githubUrl: source === 'github' ? githubUrl.trim() : undefined,
        content: source === 'text' ? content : undefined,
        filename: source === 'text' ? filename || 'pasted.md' : undefined,
        zipFile: source === 'zip' ? (zipFile ?? undefined) : undefined,
        modelTier,
        category: category || undefined,
      })) as unknown as ImportAgentsResult;

      setResult(res);
      // Import creates agents AND skills, so invalidate the whole subtree.
      qc.invalidateQueries({ queryKey: keys.agents.all });

      const { imported, skipped, errors } = res.agents ?? { imported: 0, skipped: 0, errors: [] };
      toast.success(
        imported > 0 ? `${imported} agent${imported === 1 ? '' : 's'} imported` : 'Nothing imported',
        {
          description:
            errors.length > 0
              ? `${errors.length} definition${errors.length === 1 ? '' : 's'} failed`
              : skipped > 0
                ? `${skipped} skipped (already exist)`
                : 'Your agents list has been refreshed.',
        },
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Import failed';
      setError(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Import agents</DialogTitle>
          <DialogDescription>
            Pull agent definitions from a GitHub repo, paste a single file, or upload a ZIP
            archive. Skills are imported alongside agents.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {result ? (
            <ImportSummary result={result} />
          ) : (
            <>
              <Tabs value={source} onValueChange={(v) => setSource(v as Source)}>
                <TabsList>
                  <TabsTrigger value="github" variant="pills">
                    <Github className="size-3.5" /> GitHub
                  </TabsTrigger>
                  <TabsTrigger value="text" variant="pills">
                    <FileText className="size-3.5" /> Markdown
                  </TabsTrigger>
                  <TabsTrigger value="zip" variant="pills">
                    <Archive className="size-3.5" /> ZIP
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="github">
                  <Field>
                    <FieldLabel htmlFor="import-github-url">Repository URL</FieldLabel>
                    <Input
                      id="import-github-url"
                      value={githubUrl}
                      onChange={(e) => setGithubUrl(e.target.value)}
                      placeholder="https://github.com/owner/repo"
                      autoFocus
                    />
                    <FieldDescription>
                      All markdown agent definitions in the repo (and nested folders) are fetched
                      and imported.
                    </FieldDescription>
                  </Field>
                </TabsContent>

                <TabsContent value="text">
                  <Field>
                    <FieldLabel htmlFor="import-text-file">File (optional)</FieldLabel>
                    <div className="flex items-center gap-2">
                      <Input
                        id="import-text-file"
                        value={filename}
                        onChange={(e) => setFilename(e.target.value)}
                        placeholder="filename.md"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        leftIcon={<Upload className="size-3.5" />}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Browse
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".md,.agent,.json,.txt,text/markdown,application/json"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setFilename(file.name);
                          setContent(await file.text());
                          e.target.value = '';
                        }}
                      />
                    </div>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="import-text-content">Definition</FieldLabel>
                    <Textarea
                      id="import-text-content"
                      rows={8}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder={'---\nname: My Agent\ndescription: ...\n---\n\n...'}
                    />
                    <FieldDescription>
                      Paste a single .md (or .agent/.json) agent definition. If a file is chosen
                      it fills this field and its name is used as the filename.
                    </FieldDescription>
                  </Field>
                </TabsContent>

                <TabsContent value="zip">
                  <Field>
                    <FieldLabel htmlFor="import-zip-file">ZIP archive</FieldLabel>
                    <input
                      id="import-zip-file"
                      type="file"
                      accept=".zip,application/zip"
                      className="block w-full text-xs text-fg-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-fg hover:file:bg-surface-3"
                      onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
                    />
                    <FieldDescription>
                      Any .md files inside the archive are imported (nested folders included).
                    </FieldDescription>
                  </Field>
                </TabsContent>
              </Tabs>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="import-category">Category (optional)</FieldLabel>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger id="import-category">
                      <SelectValue placeholder="Detect from content" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>Overrides each definition&apos;s category.</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="import-tier">Model tier</FieldLabel>
                  <Select value={modelTier} onValueChange={(v) => setModelTier(v as 'auto' | 'premium' | 'budget')}>
                    <SelectTrigger id="import-tier"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODEL_TIERS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {error && <FieldError>{error}</FieldError>}
            </>
          )}
        </DialogBody>

        <DialogFooter>
          {result ? (
            <Button onClick={() => handleClose(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => handleClose(false)} disabled={pending}>
                Cancel
              </Button>
              <Button
                leftIcon={pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                loading={pending}
                onClick={handleSubmit}
              >
                Import
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportSummary({ result }: { result: ImportAgentsResult }) {
  const agents = result.agents ?? { imported: 0, skipped: 0, errors: [], agents: [] };
  const skills = result.skills ?? { imported: 0, errors: [], skills: [] };

  const rows: Array<{ label: string; value: string; tone: 'ok' | 'muted' | 'bad' }> = [
    { label: 'Agents imported', value: String(agents.imported), tone: agents.imported > 0 ? 'ok' : 'muted' },
    { label: 'Skipped (already exist)', value: String(agents.skipped ?? 0), tone: 'muted' },
    { label: 'Skills imported', value: String(skills.imported ?? 0), tone: (skills.imported ?? 0) > 0 ? 'ok' : 'muted' },
  ];
  if (agents.errors?.length) {
    rows.push({ label: 'Agent errors', value: String(agents.errors.length), tone: 'bad' });
  }
  if (skills.errors?.length) {
    rows.push({ label: 'Skill errors', value: String(skills.errors.length), tone: 'bad' });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface-2/60 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {rows.map((r) => (
            <div key={r.label}>
              <div className={`text-lg font-semibold ${r.tone === 'bad' ? 'text-danger' : r.tone === 'ok' ? 'text-success' : 'text-fg'}`}>
                {r.value}
              </div>
              <div className="text-2xs text-fg-muted">{r.label}</div>
            </div>
          ))}
        </div>
      </div>

      {(agents.errors?.length || 0) > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-fg">Failed definitions</div>
          <ul className="max-h-32 space-y-1 overflow-y-auto">
            {agents.errors.slice(0, 20).map((err, i) => (
              <li key={i} className="truncate text-xs text-danger">{err}</li>
            ))}
            {agents.errors.length > 20 && (
              <li className="text-xs text-fg-muted">…and {agents.errors.length - 20} more</li>
            )}
          </ul>
        </div>
      )}

      {result.artifacts?.zip && (
        <div className="text-xs text-fg-muted">
          An archive of the imported definitions was written to the gateway&apos;s artifact store.
        </div>
      )}
    </div>
  );
}
