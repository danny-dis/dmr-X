/**
 * GodmodeClassicPanel — GODMODE CLASSIC (L1B3RT4S).
 *
 * Lets the user pick one or more Hall of Fame combos (or "Race All"),
 * type a query, and fire each combo's system/user prompts at the
 * existing godmode chat endpoint. Each combo streams its response into
 * its own colour-accented card; "Race All" runs them in parallel and
 * highlights the first to finish. Each completed result gets an inline
 * rating control (Feature B) posting to /v1/godmode/feedback.
 */

import {
  Flame,
  Play,
  RotateCcw,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trophy,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Checkbox } from '@/components/primitives/Checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/primitives/Select';
import { Textarea } from '@/components/primitives/Textarea';
import { toast } from '@/components/primitives/Toast';
import { fetchAuthenticated } from '@/lib/api';
import { cn } from '@/lib/utils';

import {
  HALL_OF_FAME,
  applyHallOfFameCombo,
  type HallOfFameCombo,
} from './godmodeClassic';

type ContextType = 'code' | 'creative' | 'analytical' | 'conversational' | 'chaotic';

interface ComboResult {
  comboId: string;
  model: string;
  color: string;
  codename: string;
  text: string;
  status: 'idle' | 'streaming' | 'done' | 'error';
  finishOrder: number | null; // 1-based order of completion (for winner)
}

function hashString(input: string): string {
  // Small, stable FNV-1a-ish hash for a content-addressed message id.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

async function* parseSseStream(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        let dataStr = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('data:')) dataStr += line.slice(5).trim();
        }
        if (!dataStr) continue;
        yield dataStr;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function extractContent(dataStr: string): string | null {
  if (dataStr === '[DONE]') return null;
  try {
    const json = JSON.parse(dataStr);
    // OpenAI-style chat completions delta
    const delta = json?.choices?.[0]?.delta;
    if (delta && typeof delta.content === 'string') return delta.content;
    if (json?.choices?.[0]?.text) return String(json.choices[0].text);
    if (typeof json?.content === 'string') return json.content;
    if (typeof json?.text === 'string') return json.text;
    if (typeof json?.message === 'string') return json.message;
    if (typeof json?.answer === 'string') return json.answer;
  } catch {
    // Not JSON — treat the raw line as content.
    return dataStr;
  }
  return null;
}

export function GodmodeClassicPanel() {
  const [selected, setSelected] = React.useState<Set<string>>(new Set([HALL_OF_FAME[0]!.id]));
  const [query, setQuery] = React.useState('');
  const [useStream, setUseStream] = React.useState(true);
  const [running, setRunning] = React.useState(false);
  const [results, setResults] = React.useState<Record<string, ComboResult>>({});
  const finishCounter = React.useRef(0);
  const [winnerId, setWinnerId] = React.useState<string | null>(null);

  const toggleCombo = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activeCombos = HALL_OF_FAME.filter((c) => selected.has(c.id) || selected.size === 0);

  const runOne = React.useCallback(
    async (combo: HallOfFameCombo, q: string): Promise<{ comboId: string; finishOrder: number }> => {
      const { system, user } = applyHallOfFameCombo(combo, q);
      const body = {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        model: combo.model,
        stream: useStream,
      };

      const res = await fetchAuthenticated('/v1/godmode/chat', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      let order = 0;
      if (useStream && res.body) {
        for await (const dataStr of parseSseStream(res.body)) {
          const chunk = extractContent(dataStr);
          if (chunk === null) continue;
          setResults((prev) => {
            const cur = prev[combo.id];
            if (!cur) return prev;
            return { ...prev, [combo.id]: { ...cur, text: cur.text + chunk } };
          });
        }
        // Finalize
        order = ++finishCounter.current;
        setResults((prev) => {
          const cur = prev[combo.id];
          if (!cur) return prev;
          return { ...prev, [combo.id]: { ...cur, status: 'done', finishOrder: order } };
        });
      } else {
        const data = await res.json().catch(() => ({}));
        const text =
          data?.choices?.[0]?.message?.content ??
          data?.content ??
          data?.text ??
          data?.answer ??
          '';
        order = ++finishCounter.current;
        setResults((prev) => {
          const cur = prev[combo.id];
          if (!cur) return prev;
          return { ...prev, [combo.id]: { ...cur, text: String(text), status: 'done', finishOrder: order } };
        });
      }
      return { comboId: combo.id, finishOrder: order };
    },
    [useStream]
  );

  const runRace = async () => {
    if (!query.trim() || running) return;
    setRunning(true);
    finishCounter.current = 0;
    setWinnerId(null);

    const combos = activeCombos;
    const initial: Record<string, ComboResult> = {};
    for (const c of combos) {
      initial[c.id] = {
        comboId: c.id,
        model: c.model,
        color: c.color,
        codename: c.codename,
        text: '',
        status: 'streaming',
        finishOrder: null,
      };
    }
    setResults(initial);

    try {
      const finishes = await Promise.all(
        combos.map((c) =>
          runOne(c, query).catch((err) => {
            setResults((prev) => {
              const cur = prev[c.id];
              if (!cur) return prev;
              return { ...prev, [c.id]: { ...cur, status: 'error' } };
            });
            toast.error(`Combo ${c.codename} failed`, {
              description: err instanceof Error ? err.message : 'Request failed',
            });
            return null;
          })
        )
      );
      // First finisher (lowest finishOrder) wins.
      const done = finishes.filter((f): f is { comboId: string; finishOrder: number } => f !== null);
      if (done.length > 0) {
        const win = [...done].sort((a, b) => a.finishOrder - b.finishOrder)[0]!;
        setWinnerId(win.comboId);
      }
      toast.success('Race complete');
    } finally {
      setRunning(false);
    }
  };

  const reset = () => {
    setResults({});
    setWinnerId(null);
    finishCounter.current = 0;
  };

  return (
    <div className="space-y-4">
      {/* Combo selector */}
      <Card padding="md">
        <h3 className="text-sm font-semibold text-fg mb-3 flex items-center gap-2">
          <Flame className="size-4 text-primary" />
          L1B3RT4S — Hall of Fame Combos
        </h3>
        <div className="flex flex-wrap gap-2">
          {HALL_OF_FAME.map((combo) => {
            const checked = selected.has(combo.id);
            return (
              <label
                key={combo.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-colors',
                  checked ? 'border-primary/50 bg-primary/10' : 'border-border bg-surface-2/40'
                )}
              >
                <Checkbox checked={checked} onCheckedChange={() => toggleCombo(combo.id)} />
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ backgroundColor: combo.color }} />
                  <div>
                    <div className="text-xs font-medium text-fg">{combo.codename}</div>
                    <div className="text-[10px] text-fg-muted">{combo.model}</div>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-fg-muted">{HALL_OF_FAME.length} proven model+prompt combos. Select any to race, or hit Race All.</p>
      </Card>

      {/* Query + controls */}
      <Card padding="md">
        <h3 className="text-sm font-semibold text-fg mb-3">Query</h3>
        <div className="flex gap-3">
          <Textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type the query to run against each combo..."
            className="flex-1 min-h-[80px]"
            disabled={running}
          />
          <div className="flex flex-col items-stretch gap-2 self-end">
            <label className="flex items-center gap-2 px-1">
              <Checkbox checked={useStream} onCheckedChange={(c) => setUseStream(c === true)} disabled={running} />
              <span className="text-xs text-fg-muted whitespace-nowrap">Stream (Liquid)</span>
            </label>
            <Button onClick={runRace} disabled={!query.trim() || running}>
              {running ? 'Racing...' : (<><Play className="size-3" />Race All</>)}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={running || Object.keys(results).length === 0}>
              <RotateCcw className="size-3" />
              Reset
            </Button>
          </div>
        </div>
      </Card>

      {/* Results */}
      {Object.keys(results).length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {Object.values(results).map((r) => (
            <ComboResultCard
              key={r.comboId}
              result={r}
              isWinner={winnerId === r.comboId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ComboResultCardProps {
  result: ComboResult;
  isWinner: boolean;
}

function ComboResultCard({ result, isWinner }: ComboResultCardProps) {
  const [rating, setRating] = React.useState<1 | -1 | null>(null);
  const [contextType, setContextType] = React.useState<ContextType>('analytical');
  const [notes, setNotes] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const submitFeedback = async () => {
    if (rating === null) {
      toast.error('Pick a rating');
      return;
    }
    setSubmitting(true);
    try {
      const messageId = hashString(`${result.model}:${result.text}`);
      const res = await fetchAuthenticated('/v1/godmode/feedback', {
        method: 'POST',
        body: JSON.stringify({
          message_id: messageId,
          context_type: contextType,
          model: result.model,
          rating,
          params: {},
          response_text: result.text,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Failed: ${res.status}`);
      }
      toast.success('Feedback recorded');
    } catch (err) {
      toast.error('Failed to submit feedback', {
        description: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card padding="md" className={cn(isWinner && 'ring-2')} style={isWinner ? { boxShadow: `0 0 0 2px ${result.color}` } : undefined}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ backgroundColor: result.color }} />
            {result.codename}
          </CardTitle>
          <div className="flex items-center gap-2">
            {isWinner && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                style={{ backgroundColor: result.color }}
              >
                <Trophy className="size-3" />
                Winner
              </span>
            )}
            <span className="text-[10px] text-fg-muted">{result.model}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2/50 p-3 text-xs text-fg"
          style={{ borderLeft: `3px solid ${result.color}` }}
        >
          {result.status === 'streaming' && !result.text ? 'Streaming…' : result.text || '—'}
        </div>

        {result.status === 'done' && (
          <div className="space-y-2 rounded-lg border border-border bg-surface-2/30 p-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-fg-muted">Rate:</span>
              <Button
                size="icon-sm"
                variant={rating === 1 ? 'primary' : 'ghost'}
                onClick={() => setRating(1)}
                title="Thumbs up"
              >
                <ThumbsUp className="size-3" />
              </Button>
              <Button
                size="icon-sm"
                variant={rating === -1 ? 'danger' : 'ghost'}
                onClick={() => setRating(-1)}
                title="Thumbs down"
              >
                <ThumbsDown className="size-3" />
              </Button>
              <Select value={contextType} onValueChange={(v) => setContextType(v as ContextType)}>
                <SelectTrigger className="h-7 text-[11px] w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="code">code</SelectItem>
                  <SelectItem value="creative">creative</SelectItem>
                  <SelectItem value="analytical">analytical</SelectItem>
                  <SelectItem value="conversational">conversational</SelectItem>
                  <SelectItem value="chaotic">chaotic</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes…"
              rows={2}
              size="sm"
            />
            <Button size="sm" variant="secondary" onClick={submitFeedback} disabled={submitting}>
              <Star className="size-3" />
              Submit feedback
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
