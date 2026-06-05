import * as React from 'react';
import { Send, RotateCcw } from 'lucide-react';
import { Card } from '@/components/primitives/Card';
import { Button } from '@/components/primitives/Button';
import { Input } from '@/components/primitives/Input';
import { Textarea } from '@/components/primitives/Textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Slider } from '@/components/primitives/Slider';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Badge } from '@/components/primitives/Badge';
import { Code } from '@/components/primitives/Code';
import type { ApiModel } from '@/types/api';

export interface AnthropicChatTabProps {
  models: { data?: ApiModel[] };
  modelsForTab: ApiModel[];
}

export function AnthropicChatTab({ modelsForTab }: AnthropicChatTabProps) {
  const [model, setModel] = React.useState('free');
  const [systemPrompt, setSystemPrompt] = React.useState('');
  const [messages, setMessages] = React.useState('[{"role": "user", "content": "Hello"}]');
  const [temperature, setTemperature] = React.useState(0.7);
  const [maxTokens, setMaxTokens] = React.useState(1024);
  const [topP, setTopP] = React.useState(1);
  const [response, setResponse] = React.useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [latency, setLatency] = React.useState(0);

  const label = (text: string) => (
    <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">{text}</label>
  );

  const onSend = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    const start = performance.now();
    try {
      let parsedMessages;
      try {
        parsedMessages = JSON.parse(messages);
      } catch {
        throw new Error('Invalid JSON in messages field');
      }
      const body: Record<string, unknown> = { model, messages: parsedMessages, max_tokens: maxTokens, temperature, top_p: topP, stream: false };
      if (systemPrompt.trim()) body.system = systemPrompt.trim();

      const res = await fetch('/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? 'Request failed');
      setResponse(data);
      setLatency(performance.now() - start);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onReset = () => {
    setSystemPrompt('');
    setMessages('[{"role": "user", "content": "Hello"}]');
    setTemperature(0.7);
    setMaxTokens(1024);
    setTopP(1);
    setResponse(null);
    setError(null);
    setLatency(0);
  };

  const tokens = response?.usage
    ? ((response.usage as Record<string, number>).input_tokens ?? 0) + ((response.usage as Record<string, number>).output_tokens ?? 0)
    : 0;

  const displayLatency = latency > 0 ? `${latency.toFixed(0)}ms` : null;

  return (
    <div className="flex flex-col gap-3">
      <Card padding="md">
        <div className="flex flex-col gap-3">
          {/* Model + Layer */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              {label('Model')}
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">free (auto-route)</SelectItem>
                  <SelectItem value="free-fast">free-fast</SelectItem>
                  <SelectItem value="free-smart">free-smart</SelectItem>
                  <SelectItem value="free-agentic">free-agentic</SelectItem>
                  <SelectItem value="free-coding">free-coding</SelectItem>
                  {modelsForTab.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} <span className="text-fg-subtle ml-1">· {m.provider}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              {label('Layer')}
              <Select defaultValue="auto">
                <SelectTrigger>
                  <SelectValue placeholder="auto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="brain">Brain</SelectItem>
                  <SelectItem value="thinker">Thinker</SelectItem>
                  <SelectItem value="executor">Executor</SelectItem>
                  <SelectItem value="worker">Worker</SelectItem>
                  <SelectItem value="temp_worker">Temp Worker</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* System prompt */}
          <div>
            {label('System prompt (optional)')}
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              placeholder="You are a helpful assistant..."
              className="font-mono text-xs"
            />
          </div>

          {/* Messages */}
          <div>
            {label('Messages (JSON)')}
            <Textarea
              value={messages}
              onChange={(e) => setMessages(e.target.value)}
              rows={4}
              className="font-mono text-xs"
            />
          </div>

          {/* Sliders row */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                {label('Temperature')}
                <span className="text-[10px] text-fg font-mono">{temperature}</span>
              </div>
              <Slider value={[temperature]} min={0} max={2} step={0.1} onValueChange={(v) => setTemperature(v[0] ?? 0.7)} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                {label('Top P')}
                <span className="text-[10px] text-fg font-mono">{topP}</span>
              </div>
              <Slider value={[topP]} min={0} max={1} step={0.05} onValueChange={(v) => setTopP(v[0] ?? 1)} />
            </div>
            <div>
              {label('Max tokens')}
              <Input type="number" min={1} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value) || 1024)} />
            </div>
          </div>

          {/* Send / Reset */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={onReset}>
              <RotateCcw className="size-3" />
              Reset
            </Button>
            <Button onClick={onSend} loading={loading}>
              <Send className="size-3" />
              Send
            </Button>
          </div>
        </div>
      </Card>

      {/* Response */}
      <Card padding="md">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-fg">Response</h3>
          {(latency > 0 || tokens > 0) && (
            <div className="flex items-center gap-3 text-[10px]">
              {displayLatency && (
                <span className="text-fg-muted">
                  <span className="text-fg-subtle">latency</span>{' '}
                  <span className="text-fg font-mono">{displayLatency}</span>
                </span>
              )}
              {tokens > 0 && (
                <span className="text-fg-muted">
                  <span className="text-fg-subtle">tokens</span>{' '}
                  <span className="text-fg font-mono">{tokens}</span>
                </span>
              )}
              {response?.model && (
                <Badge tone="primary" size="sm">{(response.model as string).split('/').pop()}</Badge>
              )}
            </div>
          )}
        </div>
        {loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : error ? (
          <div className="text-sm text-destructive whitespace-pre-wrap">{error}</div>
        ) : response ? (
          <Code inline={false} copyable>
            {JSON.stringify(response, null, 2)}
          </Code>
        ) : (
          <div className="py-12 text-center text-fg-subtle text-sm">
            Send a request to see the response
          </div>
        )}
      </Card>
    </div>
  );
}
