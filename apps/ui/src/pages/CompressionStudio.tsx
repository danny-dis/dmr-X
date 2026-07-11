import { Play, Pause, RotateCcw, Gauge, ArrowRight, Minus, PackageMinus } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Slider } from '@/components/primitives/Slider';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Admin } from '@/lib/admin';
import type { CompressionEngineKind, CompressionPreview, CompressionStage } from '@/types/compression-studio';

const SAMPLE = `Here is the tool result from the build step.

Actually, let me clarify what happened. The build succeeded without any errors.
I think we should also run the lint check just to be safe.

\`\`\`json
{
  "status": "success",
  "files": ["src/index.ts", "src/app.ts", "src/util.ts"],
  "warnings": ["unused import on line 12", "unused import on line 40"]
}
\`\`\`

Please note that this is just a preliminary result and may change.
We can proceed with the deployment now that everything looks good.`;

const ENGINE_LABELS: Record<CompressionEngineKind, string> = {
  headroom: 'Headroom',
  rtk: 'RTK',
  caveman: 'Caveman',
  'comment-strip': 'Comment strip',
  auto: 'Auto',
};

const SPEEDS = [0.3, 1, 3] as const;

/**
 * Very small sequence-alignment diff to mark which input lines survive
 * compression. Good enough to render a keep/drop heatmap without pulling in a
 * diff library. Output lines that are not present verbatim in the input are
 * treated as "kept" (rewritten) so we don't over-flag.
 */
function computeKeptLines(input: string, output: string): boolean[] {
  const inputLines = input.split('\n');
  const outputSet = new Set(output.split('\n').map((l) => l.trim()));
  return inputLines.map((l) => outputSet.has(l.trim()) || l.trim() === '');
}

function formatTokens(n: number) {
  return n.toLocaleString();
}

function StageNode({
  label,
  engine,
  tokensIn,
  tokensOut,
  active,
  done,
}: {
  label: string;
  engine: CompressionEngineKind;
  tokensIn: number;
  tokensOut: number;
  active: boolean;
  done: boolean;
}) {
  const saved = tokensIn - tokensOut;
  const pct = tokensIn > 0 ? (saved / tokensIn) * 100 : 0;
  return (
    <div
      className={[
        'rounded-lg border bg-surface-2 p-3 transition-all duration-300 w-56',
        active ? 'border-primary ring-2 ring-primary/40 scale-[1.02]' : 'border-border',
        done && !active ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-fg">{label}</span>
        <Badge tone="neutral" size="sm">
          {ENGINE_LABELS[engine]}
        </Badge>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-fg-muted font-mono">
        <span>{formatTokens(tokensIn)}</span>
        <ArrowRight className="size-3" />
        <span className={saved > 0 ? 'text-success' : 'text-fg'}>{formatTokens(tokensOut)}</span>
      </div>
      {saved > 0 && (
        <p className="text-[11px] text-success mt-0.5">
          <PackageMinus className="size-3 inline mr-1" />
          {formatTokens(saved)} saved ({pct.toFixed(0)}%)
        </p>
      )}
    </div>
  );
}

export function CompressionStudio() {
  const [text, setText] = React.useState(SAMPLE);
  const [engine, setEngine] = React.useState<CompressionEngineKind>('auto');
  const [minTokens, setMinTokens] = React.useState(100);
  const [preview, setPreview] = React.useState<CompressionPreview | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Replay state
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<(typeof SPEEDS)[number]>(1);
  const [step, setStep] = React.useState(0); // index up to which stages are "done"
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const runPreview = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await Admin.previewCompression({
        text,
        engine,
        minTokensToCompress: minTokens,
      });
      setPreview(res);
      setStep(0);
      setPlaying(false);
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [text, engine, minTokens]);

  // Auto-run on mount
  React.useEffect(() => {
    void runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replay loop
  React.useEffect(() => {
    if (!playing || !preview) return;
    const total = preview.stages.length + 1; // +1 for output node
    timer.current = setInterval(() => {
      setStep((s) => {
        if (s >= total) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 900 / speed);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, speed, preview]);

  const total = preview ? preview.stages.length + 1 : 0;
  const reset = () => {
    setPlaying(false);
    setStep(0);
  };

  const stages: Array<{ label: string; engine: CompressionEngineKind; tokensIn: number; tokensOut: number }> = preview
    ? [
        { label: 'Input', engine: 'auto', tokensIn: preview.originalTokens, tokensOut: preview.originalTokens },
        ...preview.stages.map((s: CompressionStage) => ({
          label: s.name,
          engine: s.engine,
          tokensIn: s.tokensIn,
          tokensOut: s.tokensOut,
        })),
        { label: 'Output', engine: 'auto', tokensIn: preview.compressedTokens, tokensOut: preview.compressedTokens },
      ]
    : [];

  const keptLines = preview ? computeKeptLines(preview.input, preview.output) : [];

  return (
    <div className="space-y-4">
      <Card padding="md">
        <CardHeader className="px-0 pt-0">
          <CardTitle>Compression Pipeline</CardTitle>
          <p className="text-[11px] text-fg-muted mt-0.5">
            Visualize how DMR-X shrinks a prompt before it reaches a provider. Each stage runs a
            real engine (RTK, Caveman, comment-strip) on the sample text.
          </p>
        </CardHeader>
        <CardContent className="px-0 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-fg">Sample text</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={7}
              className="w-full rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs text-fg resize-y focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="Paste a tool result, code block, or long prompt…"
            />
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-fg">Engine</label>
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value as CompressionEngineKind)}
                className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {(Object.keys(ENGINE_LABELS) as CompressionEngineKind[]).map((k) => (
                  <option key={k} value={k}>
                    {ENGINE_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-56 space-y-1">
              <label className="text-xs font-medium text-fg">Min tokens to compress</label>
              <Slider
                value={[minTokens]}
                min={0}
                max={1000}
                step={10}
                onValueChange={(v) => setMinTokens(v[0] ?? 100)}
              />
              <p className="text-[10px] text-fg-muted text-right">{minTokens} tokens</p>
            </div>

            <Button size="sm" onClick={runPreview} loading={loading}>
              <Gauge className="size-3" />
              Run preview
            </Button>
          </div>

          {error && (
            <p className="text-xs text-danger">Preview failed: {error}</p>
          )}
        </CardContent>
      </Card>

      {loading && !preview ? (
        <Skeleton className="h-64 w-full" />
      ) : preview ? (
        preview.stages.length === 0 ? (
          <Card padding="md">
            <p className="text-sm text-fg-muted">
              Below the minimum-token threshold ({minTokens} tokens) — nothing was compressed.
              Lower the “Min tokens to compress” slider or paste a longer sample.
            </p>
          </Card>
        ) : (
          <>
          {/* Replay controls + summary */}
          <Card padding="md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button size="sm" variant={playing ? 'secondary' : 'primary'} onClick={() => setPlaying((p) => !p)}>
                  {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
                  {playing ? 'Pause' : 'Play'}
                </Button>
                <Button size="sm" variant="ghost" onClick={reset} disabled={step === 0}>
                  <RotateCcw className="size-3" />
                  Reset
                </Button>
                <div className="flex items-center gap-1 ml-2">
                  {SPEEDS.map((sp) => (
                    <button
                      key={sp}
                      onClick={() => setSpeed(sp)}
                      className={[
                        'px-2 py-1 rounded text-[11px] border',
                        speed === sp
                          ? 'border-primary text-primary bg-primary/10'
                          : 'border-border text-fg-muted hover:text-fg',
                      ].join(' ')}
                    >
                      {sp}×
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Badge tone="success" size="sm">
                  {formatTokens(preview.saved)} tokens saved
                </Badge>
                <Badge tone="neutral" size="sm">
                  {preview.ratio > 0 ? `${(preview.ratio * 100).toFixed(1)}%` : '0%'} reduction
                </Badge>
                <span className="text-fg-muted text-xs">
                  {formatTokens(preview.originalTokens)} → {formatTokens(preview.compressedTokens)}
                </span>
              </div>
            </div>
          </Card>

          {/* Pipeline canvas (custom, dependency-free) */}
          <Card padding="md">
            <CardHeader className="px-0 pt-0">
              <CardTitle>Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <div className="flex flex-wrap items-stretch gap-2 overflow-x-auto pb-2">
                {stages.map((s, i) => {
                  const isOutput = i === stages.length - 1;
                  const isInput = i === 0;
                  const stageDone = i <= step;
                  const stageActive = i === step;
                  const prevDone = i - 1 <= step;
                  return (
                    <React.Fragment key={i}>
                      <StageNode
                        label={s.label}
                        engine={s.engine}
                        tokensIn={s.tokensIn}
                        tokensOut={s.tokensOut}
                        active={stageActive}
                        done={stageDone}
                      />
                      {!isOutput && (
                        <div className="flex items-center self-center text-fg-muted">
                          {prevDone ? (
                            <ArrowRight className={stageActive ? 'size-5 text-primary' : 'size-5'} />
                          ) : (
                            <Minus className="size-5" />
                          )}
                        </div>
                      )}
                      {isInput && null}
                    </React.Fragment>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Waterfall: cumulative savings */}
          <Card padding="md">
            <CardHeader className="px-0 pt-0">
              <CardTitle>Cumulative Savings</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <div className="space-y-1.5">
                {preview.stages.map((s: CompressionStage, i) => {
                  const cumulativeSaved = preview.stages.slice(0, i + 1).reduce((a, s) => a + (s.tokensIn - s.tokensOut), 0);
                  const maxTokens = preview.originalTokens || 1;
                  const widthPct = Math.max(2, (cumulativeSaved / maxTokens) * 100);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-40 text-[11px] text-fg-muted truncate">{s.name}</span>
                      <div className="flex-1 h-4 rounded bg-surface-2 overflow-hidden">
                        <div
                          className="h-full bg-success/70 transition-all duration-500"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                      <span className="w-24 text-right text-[11px] text-success font-mono">
                        -{formatTokens(cumulativeSaved)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Keep / drop heatmap */}
          <Card padding="md">
            <CardHeader className="px-0 pt-0">
              <CardTitle>Keep / Drop Heatmap</CardTitle>
              <p className="text-[11px] text-fg-muted mt-0.5">
                Lines present in the original but removed by compression are dimmed. This shows what
                was discarded versus preserved.
              </p>
            </CardHeader>
            <CardContent className="px-0">
              <div className="rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed max-h-80 overflow-auto">
                {preview.input.split('\n').map((line, i) => {
                  const kept = keptLines[i];
                  return (
                    <div
                      key={i}
                      className={kept ? 'text-fg' : 'text-fg-muted line-through opacity-50'}
                    >
                      {kept ? <span className="text-success mr-2">✔</span> : <span className="text-danger mr-2">✕</span>}
                      {line || ' '}
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-fg-muted mt-2">
                Output ({formatTokens(preview.compressedTokens)} tokens):
              </p>
              <pre className="rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs text-fg whitespace-pre-wrap max-h-60 overflow-auto">
                {preview.output}
              </pre>
            </CardContent>
          </Card>
          </>
        )
      ) : null}
    </div>
  );
}
