import * as React from 'react';
import { Image as ImageIcon, Video, Sparkles, X, Loader2 } from 'lucide-react';

import { Button, Input, Textarea } from '@/components/primitives';
import { apiPost } from '@/lib/api';
import { usePlaygroundStore } from '@/store/usePlaygroundStore';

type GenKind = 'image' | 'video';

const SIZES: Record<GenKind, string[]> = {
  image: ['1024x1024', '1792x1024', '1024x1792', '512x512'],
  video: ['1280x720', '720x1280', '1920x1080'],
};

/**
 * Compact Image / Video generate affordance for the Normal chat composer.
 * Opens a small inline popover (no separate page), posts to the existing
 * gateway endpoints, and renders the result inside the message thread.
 */
export function GenerateButtons() {
  const [open, setOpen] = React.useState<GenKind | null>(null);
  const [prompt, setPrompt] = React.useState('');
  const [size, setSize] = React.useState(SIZES.image[0]);
  const [model, setModel] = React.useState('auto');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const appendMessage = usePlaygroundStore(s => s.appendMessage);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const run = async (kind: GenKind) => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'image') {
        const [width, height] = size.split('x').map(Number);
        // Surface the user prompt as a message, then the result.
        await appendMessage({ role: 'user', content: `🖼️ Generate image: ${prompt}` });
        const res = await apiPost<{ data: Array<{ url?: string; b64_json?: string }> }>(
          '/v1/images/generations',
          { prompt, model: model === 'auto' ? undefined : model, width, height, n: 1 },
        );
        const item = res?.data?.[0];
        const url = item?.url ?? (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : undefined);
        if (!url) throw new Error('No image returned');
        await appendMessage({ role: 'assistant', content: 'Here is your generated image:', imageUrl: url });
      } else {
        await appendMessage({ role: 'user', content: `🎬 Generate video: ${prompt}` });
        const res = await apiPost<{ data: { videos: string[] } }>(
          '/v1/video/generations',
          { prompt, model: model === 'auto' ? undefined : model },
        );
        const video = res?.data?.videos?.[0];
        if (!video) throw new Error('No video returned');
        await appendMessage({ role: 'assistant', content: 'Here is your generated video:', videoUrl: video });
      }
      setOpen(null);
      setPrompt('');
    } catch (e: any) {
      setError(e?.message ?? 'Generation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title="Generate image"
          onClick={() => { setOpen(open === 'image' ? null : 'image'); setSize(SIZES.image[0]); }}
          className={open === 'image' ? 'bg-accent text-accent-foreground' : ''}
        >
          <ImageIcon className="h-4 w-4" /> Image
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title="Generate video"
          onClick={() => { setOpen(open === 'video' ? null : 'video'); setSize(SIZES.video[0]); }}
          className={open === 'video' ? 'bg-accent text-accent-foreground' : ''}
        >
          <Video className="h-4 w-4" /> Video
        </Button>
      </div>

      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-80 rounded-lg border bg-popover p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="h-4 w-4" />
              {open === 'image' ? 'Generate image' : 'Generate video'}
            </span>
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <label className="mb-1 block text-xs text-muted-foreground">Prompt</label>
          <Textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={open === 'image' ? 'A serene mountain lake at sunset…' : 'A cinematic drone shot over a city…'}
            rows={3}
            className="mb-2"
          />

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">Size</label>
              <select
                value={size}
                onChange={e => setSize(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-popover px-2 text-sm text-foreground outline-none focus:border-primary/40"
              >
                {SIZES[open].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <label className="mb-1 block text-xs text-muted-foreground">Model</label>
              <Input value={model} onChange={e => setModel(e.target.value)} placeholder="auto" />
            </div>
          </div>

          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

          <Button
            type="button"
            size="sm"
            className="mt-3 w-full"
            disabled={busy || !prompt.trim()}
            onClick={() => run(open)}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? 'Generating…' : 'Generate'}
          </Button>
        </div>
      )}
    </div>
  );
}
