import { Send, Square } from 'lucide-react';
import * as React from 'react';

import { Button, Textarea } from '@/components/primitives';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { fetchAuthenticated } from '@/lib/api';
import type { ApiModel } from '@/types/api';

export function CompletionsView() {
  const [text, setText] = React.useState('');
  const [model, setModel] = React.useState('auto');
  const [running, setRunning] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  const models = useApiData<ApiModel[]>(
    () => Admin.listModels({ available_only: 'true' }) as Promise<ApiModel[]>,
    [],
    { refetchInterval: 30000 },
  );

  const llmModels = React.useMemo(
    () => (models.data ?? []).filter((m) => m.modality === 'llm'),
    [models.data],
  );

  const run = async () => {
    if (!text.trim() || running) return;
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetchAuthenticated('/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: model === 'auto' ? undefined : model,
          messages: [{ role: 'assistant', content: text }],
          stream: true,
        }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => res.statusText);
        setText((t) => t + `\n\nError: ${res.status} ${err}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let got = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          if (line === 'data: [DONE]') break;
          try {
            const data = JSON.parse(line.slice(6));
            const delta = data.choices?.[0]?.delta?.content;
            if (delta) {
              got += delta;
              setText((t) => t + delta);
            }
          } catch { /* skip */ }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setText((t) => t + `\n\nError: ${e.message}`);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center gap-3">
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-primary/40"
        >
          <option value="auto">Auto (router decides)</option>
          {llmModels.map((m) => (
            <option key={m.id} value={m.model_id ?? m.id}>
              {m.display_name ?? m.name ?? m.model_id} ({m.provider})
            </option>
          ))}
        </select>
      </div>

      <Textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type your text here. Click Run to complete..."
        className="min-h-0 flex-1 resize-none font-mono text-sm"
      />

      <div className="mt-3 flex justify-end gap-2">
        {running ? (
          <Button variant="secondary" onClick={stop}>
            <Square className="size-4" /> Cancel
          </Button>
        ) : (
          <Button onClick={run} disabled={!text.trim()}>
            <Send className="size-4" /> Run
          </Button>
        )}
      </div>
    </div>
  );
}
