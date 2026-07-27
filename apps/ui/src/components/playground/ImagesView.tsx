import { Upload, Download, Image as ImageIcon, X, Send } from 'lucide-react';
import * as React from 'react';

import { Button, Textarea } from '@/components/primitives';
import { useApiData } from '@/hooks/useApiData';
import { Admin, fetchAuthenticated } from '@/lib/admin';
import type { ApiModel } from '@/types/api';

export function ImagesView() {
  const [prompt, setPrompt] = React.useState('');
  const [model, setModel] = React.useState('auto');
  const [sourceImages, setSourceImages] = React.useState<string[]>([]);
  const [results, setResults] = React.useState<string[]>([]);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const models = useApiData<ApiModel[]>(
    () => Admin.listModels({ available_only: 'true' }) as Promise<ApiModel[]>,
    [],
    { refetchInterval: 30000 },
  );

  const imageModels = React.useMemo(
    () => (models.data ?? []).filter((m) => m.modality === 'diffusion'),
    [models.data],
  );

  const handleUpload = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        if (result) setSourceImages((prev) => [...prev, result]);
      };
      reader.readAsDataURL(file);
    });
  };

  const run = async () => {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetchAuthenticated('/v1/images/generations', {
        method: 'POST',
        body: JSON.stringify({ model, prompt, n: 1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);

      const newImages = (data.data ?? []).map((d: any) =>
        d.url ? d.url : d.b64_json ? `data:image/png;base64,${d.b64_json}` : '',
      ).filter(Boolean);

      setResults((prev) => [...newImages, ...prev]);
      setPrompt('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const downloadImage = (url: string, idx: number) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `image-${Date.now()}-${idx}.png`;
    a.click();
  };

  return (
    <div className="flex h-full flex-col p-4">
      {/* Gallery */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {results.length === 0 ? (
          <div className="flex h-full items-center justify-center text-fg-subtle">
            <div className="text-center">
              <ImageIcon className="mx-auto mb-2 size-12 opacity-30" />
              <p className="text-sm">Generated images will appear here</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {results.map((url, i) => (
              <button
                key={i}
                onClick={() => downloadImage(url, i)}
                className="group relative overflow-hidden rounded-lg border border-border"
              >
                <img src={url} alt="" className="aspect-square w-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                  <Download className="size-6 text-white" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Source images */}
      {sourceImages.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {sourceImages.map((img, i) => (
            <div key={i} className="relative">
              <img src={img} alt="" className="size-12 rounded-lg border border-border object-cover" />
              <button
                onClick={() => setSourceImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -right-1 -top-1 rounded-full border border-border bg-surface-1 p-0.5 text-fg-muted hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="mt-3 rounded-xl border border-border bg-surface-2 p-2">
        <div className="mb-2 flex items-center gap-2">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-8 rounded-md border border-border bg-surface-2 px-2 text-xs text-fg outline-none"
          >
            {imageModels.length === 0 && <option value="auto">Auto</option>}
            {imageModels.map((m) => (
              <option key={m.id} value={m.model_id ?? m.id}>
                {m.display_name ?? m.name ?? m.model_id}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
            <Upload className="size-3.5" /> Source
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
        </div>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the image..."
          className="min-h-[60px] resize-none border-0 bg-transparent text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
          }}
        />
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        <div className="mt-2 flex justify-end">
          <Button onClick={run} disabled={!prompt.trim() || running} size="sm">
            <Send className="size-3.5" /> {running ? 'Generating...' : 'Generate'}
          </Button>
        </div>
      </div>
    </div>
  );
}
