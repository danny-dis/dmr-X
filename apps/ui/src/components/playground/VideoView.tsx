import { Send, Video as VideoIcon, Clapperboard } from 'lucide-react';
import * as React from 'react';

import { Button, Input, Switch, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { fetchAuthenticated } from '@/lib/api';
import type { ApiModel } from '@/types/api';

export function VideoView() {
  const [prompt, setPrompt] = React.useState('');
  const [model, setModel] = React.useState('auto');
  const [duration, setDuration] = React.useState(5);
  const [fps, setFps] = React.useState(24);
  const [aspectRatio, setAspectRatio] = React.useState('16:9');
  const [resolution, setResolution] = React.useState('720p');
  const [quality, setQuality] = React.useState('standard');
  const [negPrompt, setNegPrompt] = React.useState('');
  const [genAudio, setGenAudio] = React.useState(true);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const models = useApiData<ApiModel[]>(
    () => Admin.listModels({ available_only: 'true' }) as Promise<ApiModel[]>,
    [],
    { refetchInterval: 30000 },
  );

  const run = async () => {
    if (!prompt.trim() || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        model: model === 'auto' ? undefined : model,
        prompt,
        duration,
        fps,
        aspect_ratio: aspectRatio,
        resolution,
        quality,
        generate_audio: genAudio,
      };
      if (negPrompt.trim()) body.negative_prompt = negPrompt;

      const res = await fetchAuthenticated('/v1/video/generations', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);

      const url = data.url ?? data.video?.url ?? (data.video?.b64_json ? `data:video/mp4;base64,${data.video.b64_json}` : null);
      if (url) setResult(url);
      else setError('No video URL in response');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:flex-row">
      {/* Form */}
      <div className="w-full space-y-3 md:w-96 md:shrink-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Clapperboard className="size-4 text-primary" /> Video Generation
        </div>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the video..."
          className="min-h-[80px] text-sm"
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">Duration (s)</span>
            <Input type="number" value={duration} onChange={(e) => setDuration(+e.target.value)} min={2} max={120} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">FPS</span>
            <Input type="number" value={fps} onChange={(e) => setFps(+e.target.value)} min={1} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">Aspect Ratio</span>
            <Select value={aspectRatio} onValueChange={setAspectRatio}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21', 'auto'].map((v) => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">Resolution</span>
            <Select value={resolution} onValueChange={setResolution}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['480p', '720p', '1080p', '4k'].map((v) => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">Quality</span>
            <Select value={quality} onValueChange={setQuality}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">standard</SelectItem>
                <SelectItem value="hd">hd</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">Negative Prompt</span>
            <Input value={negPrompt} onChange={(e) => setNegPrompt(e.target.value)} placeholder="What to avoid..." />
          </label>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-1 px-3 py-2">
          <span className="text-xs text-fg-muted">Generate audio</span>
          <Switch checked={genAudio} onCheckedChange={setGenAudio} />
        </div>
        <Button onClick={run} disabled={!prompt.trim() || running} className="w-full">
          <Send className="size-4" /> {running ? 'Generating...' : 'Generate Video'}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {/* Result */}
      <div className="min-w-0 flex-1">
        <div className="flex h-full items-center justify-center rounded-xl border border-border bg-surface-1">
          {result ? (
            <video src={result} controls className="max-h-full max-w-full rounded-lg" />
          ) : (
            <div className="text-center text-fg-subtle">
              <VideoIcon className="mx-auto mb-2 size-12 opacity-30" />
              <p className="text-sm">Video result will appear here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
