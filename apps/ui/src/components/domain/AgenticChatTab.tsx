import * as React from 'react';
import {
  Send, RotateCcw, Settings2, ChevronDown, ShieldAlert,
  CheckCircle2, XCircle, Copy, Trash2, Terminal, MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/primitives/Button';
import { Input } from '@/components/primitives/Input';
import { Textarea } from '@/components/primitives/Textarea';
import { Badge } from '@/components/primitives/Badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/primitives/Select';
import { Switch } from '@/components/primitives/Switch';
import { Skeleton } from '@/components/primitives/Skeleton';
import { toast } from '@/components/primitives/Toast';
import { cn } from '@/lib/utils';
import type { UseApiDataResult } from '@/hooks/useApiData';
import type { ApiModel } from '@/types/api';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface AgenticChatTabProps {
  models: UseApiDataResult<ApiModel[]>;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ApprovalDecision {
  tool_call_id: string;
  approved: boolean;
}

interface AgentStep {
  turn: number;
  message?: { role: string; content: string };
  tool_calls?: Array<{ id: string; name: string; arguments: Record<string, unknown>; result?: unknown }>;
  tool_results?: Array<{ tool_call_id: string; result: unknown }>;
}

interface AgentResponse {
  id?: string;
  object?: string;
  choices?: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number; cost?: number };
  conversationId?: string;
  steps_completed?: number;
  all_steps?: AgentStep[];
  status?: string;
  pending_tool_calls?: ToolCall[];
  provider?: string;
  model?: string;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const LAYERS = ['auto', 'brain', 'thinker', 'executor', 'worker', 'temp_worker'] as const;

const DEFAULT_TOOLS = JSON.stringify([
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get the current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City and state' },
          unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web for information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
], null, 2);

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function AgenticChatTab({ models }: AgenticChatTabProps) {
  /* ---- Configuration state ---- */
  const [model, setModel] = React.useState('free');
  const [layer, setLayer] = React.useState('auto');
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [maxSteps, setMaxSteps] = React.useState(10);
  const [approvalRequired, setApprovalRequired] = React.useState(false);
  const [stopStepCount, setStopStepCount] = React.useState('');
  const [stopToolCall, setStopToolCall] = React.useState('');
  const [stopTextMatch, setStopTextMatch] = React.useState('');
  const [toolDefinitions, setToolDefinitions] = React.useState(DEFAULT_TOOLS);
  const [showConfig, setShowConfig] = React.useState(true);
  const [showStopConditions, setShowStopConditions] = React.useState(false);
  const [showTools, setShowTools] = React.useState(false);

  /* ---- Conversation state ---- */
  const [messages, setMessages] = React.useState<Array<{ role: string; content: string }>>([]);
  const [input, setInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [pendingApprovals, setPendingApprovals] = React.useState<ToolCall[]>([]);
  const [allSteps, setAllSteps] = React.useState<AgentStep[]>([]);
  const [conversationStatus, setConversationStatus] = React.useState<'idle' | 'active' | 'awaiting_approval' | 'completed'>('idle');
  const [usage, setUsage] = React.useState<{ tokens: number; cost: number; provider: string; model: string } | null>(null);

  /* ---- Derived ---- */
  const llmModels = React.useMemo(
    () => (models.data ?? []).filter((m) => m.modality === 'llm'),
    [models.data],
  );

  /* ---- Handlers ---- */

  const resetConversation = () => {
    setConversationId(null);
    setMessages([]);
    setAllSteps([]);
    setPendingApprovals([]);
    setConversationStatus('idle');
    setUsage(null);
    toast.success('Conversation reset');
  };

  const onSend = async (approvalDecisions?: ApprovalDecision[]) => {
    const hasInput = input.trim().length > 0;
    const hasApprovals = approvalDecisions && approvalDecisions.length > 0;
    if (!hasInput && !hasApprovals) return;

    setLoading(true);

    try {
      const body: Record<string, unknown> = {
        model,
        messages: [
          ...messages,
          ...(hasInput ? [{ role: 'user' as const, content: input.trim() }] : []),
        ],
        max_steps: maxSteps,
        approvalRequired,
        stream: false,
      };

      if (conversationId) body.conversationId = conversationId;
      if (layer !== 'auto') body.layer = layer;

      if (hasApprovals) {
        body.approvalDecisions = approvalDecisions;
      }

      const stopWhen: Array<{ type: string; value: unknown }> = [];
      if (stopStepCount) stopWhen.push({ type: 'step_count', value: Number(stopStepCount) });
      if (stopToolCall) stopWhen.push({ type: 'tool_call', value: stopToolCall });
      if (stopTextMatch) stopWhen.push({ type: 'text_match', value: stopTextMatch });
      if (stopWhen.length > 0) body.stopWhen = stopWhen;

      try {
        const parsed = JSON.parse(toolDefinitions);
        if (Array.isArray(parsed) && parsed.length > 0) {
          body.tools = parsed;
        }
      } catch { /* ignore invalid JSON */ }

      const res = await fetch('/v1/agentic/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data: AgentResponse = await res.json();
      if (!res.ok) {
        throw new Error((data as unknown as { error?: { message?: string } }).error?.message ?? 'Request failed');
      }

      if (data.conversationId) setConversationId(data.conversationId);

      /* -- Rebuild display messages from steps -- */
      if (data.all_steps) {
        setAllSteps(data.all_steps);
        const displayMessages: Array<{ role: string; content: string }> = [];
        for (const step of data.all_steps) {
          if (step.message) displayMessages.push(step.message);
          if (step.tool_calls) {
            for (const tc of step.tool_calls) {
              displayMessages.push({
                role: 'assistant',
                content: `Tool call: ${tc.name}(${JSON.stringify(tc.arguments)})`,
              });
            }
          }
          if (step.tool_results) {
            for (const tr of step.tool_results) {
              const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
              displayMessages.push({
                role: 'tool',
                content: `Result: ${resultStr}`,
              });
            }
          }
        }
        setMessages(displayMessages);
      }

      /* -- Handle awaiting approval -- */
      if (data.status === 'awaiting_approval' && data.pending_tool_calls) {
        setPendingApprovals(data.pending_tool_calls);
        setConversationStatus('awaiting_approval');
      } else {
        setPendingApprovals([]);
        setConversationStatus('completed');
      }

      /* -- Usage -- */
      if (data.usage) {
        setUsage((prev) => ({
          tokens: data.usage.total_tokens ?? prev?.tokens ?? 0,
          cost: data.usage.cost ?? prev?.cost ?? 0,
          provider: data.provider ?? prev?.provider ?? 'auto',
          model: data.model ?? prev?.model ?? model,
        }));
      }

      if (hasInput) setInput('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onApproveAll = () => {
    const decisions = pendingApprovals.map((tc) => ({
      tool_call_id: tc.id,
      approved: true,
    }));
    setPendingApprovals([]);
    setConversationStatus('active');
    void onSend(decisions);
  };

  const onRejectAll = () => {
    const decisions = pendingApprovals.map((tc) => ({
      tool_call_id: tc.id,
      approved: false,
    }));
    setPendingApprovals([]);
    setConversationStatus('active');
    void onSend(decisions);
  };

  const onApproveOne = (id: string) => {
    const decisions = pendingApprovals
      .filter((tc) => tc.id === id)
      .map((tc) => ({ tool_call_id: tc.id, approved: true }));
    const remaining = pendingApprovals.filter((tc) => tc.id !== id);
    setPendingApprovals(remaining);
    setConversationStatus('active');
    void onSend(decisions);
  };

  const onRejectOne = (id: string) => {
    const decisions = pendingApprovals
      .filter((tc) => tc.id === id)
      .map((tc) => ({ tool_call_id: tc.id, approved: false }));
    const remaining = pendingApprovals.filter((tc) => tc.id !== id);
    setPendingApprovals(remaining);
    setConversationStatus('active');
    void onSend(decisions);
  };

  const copyConversationId = () => {
    if (conversationId) {
      void navigator.clipboard.writeText(conversationId);
      toast.success('Conversation ID copied');
    }
  };

  /* ---- Render ---- */

  const canSend = (input.trim().length > 0 || pendingApprovals.length > 0) && !loading;

  const configRow = (label: string, className?: string) => (
    <label className={cn('text-[10px] text-fg-muted mb-0.5 block uppercase tracking-wider', className)}>{label}</label>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* ======== Section 1: Configuration Bar ======== */}
      <div className="rounded-lg border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setShowConfig(!showConfig)}
          className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Settings2 className="size-3" />
            Agent configuration
          </span>
          <ChevronDown className={`size-3.5 transition-transform ${showConfig ? 'rotate-180' : ''}`} />
        </button>

        {showConfig && (
          <div className="px-3 pb-3 pt-1 border-t border-border bg-surface-1/50 space-y-3">
            {/* Model + Layer row */}
            <div className="grid grid-cols-5 gap-3">
              <div className="col-span-3">
                {configRow('Model')}
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
                    {llmModels.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} <span className="text-fg-subtle ml-1">· {m.provider}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                {configRow('Layer')}
                <Select value={layer} onValueChange={setLayer}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LAYERS.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l === 'auto' ? 'Auto' : l.charAt(0).toUpperCase() + l.slice(1).replace('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Conversation ID + Max steps + Approval */}
            <div className="grid grid-cols-5 gap-3 items-end">
              <div className="col-span-2">
                {configRow('Conversation ID')}
                <div className="flex items-center gap-1">
                  <Input
                    value={conversationId ?? '(new)'}
                    readOnly
                    size="sm"
                    className="text-[11px] font-mono text-fg-muted"
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={copyConversationId}
                    disabled={!conversationId}
                    title="Copy conversation ID"
                  >
                    <Copy className="size-3" />
                  </Button>
                </div>
              </div>
              <div>
                {configRow('Max steps')}
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={maxSteps}
                  onChange={(e) => setMaxSteps(Number(e.target.value) || 10)}
                  size="sm"
                />
              </div>
              <div className="col-span-2 flex items-end gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={approvalRequired}
                    onCheckedChange={setApprovalRequired}
                    id="approval-toggle"
                  />
                  <label htmlFor="approval-toggle" className="text-[10px] text-fg-muted uppercase tracking-wider cursor-pointer">
                    Approval required
                  </label>
                </div>
                <Button variant="ghost" size="sm" onClick={resetConversation}>
                  <Trash2 className="size-3" />
                  New conversation
                </Button>
              </div>
            </div>

            {/* Stop conditions */}
            <div className="rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setShowStopConditions(!showStopConditions)}
                className="flex items-center justify-between w-full px-2.5 py-1.5 text-[10px] font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
              >
                <span>Stop conditions</span>
                <ChevronDown className={`size-3 transition-transform ${showStopConditions ? 'rotate-180' : ''}`} />
              </button>
              {showStopConditions && (
                <div className="px-2.5 pb-2.5 pt-1 border-t border-border grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-fg-muted mb-0.5 block">Step count</label>
                    <Input
                      type="number"
                      min={1}
                      value={stopStepCount}
                      onChange={(e) => setStopStepCount(e.target.value)}
                      placeholder="e.g. 5"
                      size="sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-fg-muted mb-0.5 block">Tool call name</label>
                    <Input
                      value={stopToolCall}
                      onChange={(e) => setStopToolCall(e.target.value)}
                      placeholder="e.g. get_weather"
                      size="sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-fg-muted mb-0.5 block">Text match</label>
                    <Input
                      value={stopTextMatch}
                      onChange={(e) => setStopTextMatch(e.target.value)}
                      placeholder="e.g. FINISHED"
                      size="sm"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Tools JSON editor */}
            <div className="rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setShowTools(!showTools)}
                className="flex items-center justify-between w-full px-2.5 py-1.5 text-[10px] font-medium text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors"
              >
                <span>Tool definitions (JSON)</span>
                <ChevronDown className={`size-3 transition-transform ${showTools ? 'rotate-180' : ''}`} />
              </button>
              {showTools && (
                <div className="px-2.5 pb-2.5 pt-1 border-t border-border">
                  <Textarea
                    value={toolDefinitions}
                    onChange={(e) => setToolDefinitions(e.target.value)}
                    rows={8}
                    className="font-mono text-[11px]"
                    placeholder="[{...}]"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ======== Section 2: Conversation + Details Panel ======== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 min-h-[300px]">
        {/* Conversation Display */}
        <div className="lg:col-span-2 rounded-lg border border-border bg-surface-1 flex flex-col">
          <div className="flex-1 overflow-y-auto p-3 space-y-3 max-h-[500px]">
            {messages.length === 0 && !loading && (
              <div className="py-12 text-center text-fg-subtle text-sm">
                <MessageSquare className="size-8 mx-auto mb-2 text-fg-subtle/50" />
                Send a message to start the agentic conversation
              </div>
            )}

            {allSteps.length > 0 && (
              <div className="space-y-4">
                {allSteps.map((step) => (
                  <div key={step.turn}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-[10px] uppercase tracking-wider text-fg-muted font-medium">
                        Turn {step.turn + 1}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                    </div>

                    {step.message && (
                      <div className={`flex ${step.message.role === 'user' ? 'justify-end' : 'justify-start'} mb-2`}>
                        <div
                          className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                            step.message.role === 'user'
                              ? 'bg-primary/20 text-fg'
                              : step.message.role === 'tool'
                                ? 'bg-surface-2/60 text-fg-muted font-mono text-[11px]'
                                : 'bg-surface-2 text-fg'
                          }`}
                        >
                          {step.message.content}
                        </div>
                      </div>
                    )}

                    {step.tool_calls && step.tool_calls.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {step.tool_calls.map((tc) => (
                          <div
                            key={tc.id}
                            className="rounded-lg border border-accent/20 bg-accent/5 px-2.5 py-1.5 text-xs"
                          >
                            <div className="flex items-center gap-1 text-accent font-medium">
                              <Terminal className="size-3" />
                              <span>{tc.name}</span>
                            </div>
                            <pre className="text-[10px] text-fg-muted mt-0.5 font-mono whitespace-pre-wrap">
                              {JSON.stringify(tc.arguments, null, 1)}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}

                    {step.tool_results && step.tool_results.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {step.tool_results.map((tr, idx) => (
                          <div
                            key={`${step.turn}-result-${idx}`}
                            className="rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5 text-xs"
                          >
                            <div className="flex items-center gap-1 text-fg-muted">
                              <CheckCircle2 className="size-3 text-success" />
                              <span className="text-[10px] font-medium">Result</span>
                            </div>
                            <pre className="text-[10px] text-fg-muted mt-0.5 font-mono whitespace-pre-wrap line-clamp-2">
                              {typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Approval gate */}
            {conversationStatus === 'awaiting_approval' && pendingApprovals.length > 0 && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldAlert className="size-4 text-warning" />
                  <span className="text-sm font-medium text-fg">Tool execution requires approval</span>
                </div>
                {pendingApprovals.map((tc) => (
                  <div key={tc.id} className="bg-surface-2 rounded-lg p-3 mb-2">
                    <div className="flex items-center gap-1.5">
                      <Terminal className="size-3.5 text-accent" />
                      <p className="text-xs font-mono text-fg font-medium">{tc.name}</p>
                    </div>
                    <pre className="text-[10px] text-fg-muted mt-1 font-mono whitespace-pre-wrap">
                      {JSON.stringify(tc.arguments, null, 2)}
                    </pre>
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" onClick={() => onApproveOne(tc.id)}>
                        <CheckCircle2 className="size-3" />
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onRejectOne(tc.id)}>
                        <XCircle className="size-3" />
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="flex gap-2 mt-3">
                  <Button size="sm" onClick={onApproveAll}>
                    <CheckCircle2 className="size-3" />
                    Approve All
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onRejectAll}>
                    <XCircle className="size-3" />
                    Reject All
                  </Button>
                </div>
              </div>
            )}

            {loading && (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="border-t border-border p-3 space-y-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={3}
              placeholder="Type your message…"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) void onSend();
                }
              }}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] text-fg-muted">
                {conversationId && (
                  <Badge tone="primary" size="sm">
                    {conversationStatus === 'awaiting_approval' ? 'Awaiting approval' : conversationStatus}
                  </Badge>
                )}
                {allSteps.length > 0 && (
                  <span>{allSteps.length} turn{allSteps.length !== 1 ? 's' : ''}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setInput('')} disabled={!input}>
                  <RotateCcw className="size-3" />
                  Clear
                </Button>
                <Button
                  onClick={() => void onSend()}
                  loading={loading}
                  disabled={!canSend}
                  size="sm"
                >
                  <Send className="size-3" />
                  Send
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Response Details Panel */}
        <div className="rounded-lg border border-border bg-surface-1 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-fg">Response Details</h3>

          <div className="space-y-3">
            <div>
              <span className="text-[10px] text-fg-muted uppercase tracking-wider block mb-0.5">Status</span>
              <Badge
                tone={
                  conversationStatus === 'idle' ? 'muted' :
                  conversationStatus === 'active' ? 'info' :
                  conversationStatus === 'awaiting_approval' ? 'warning' :
                  'success'
                }
                size="sm"
              >
                {conversationStatus === 'idle' ? 'Idle' :
                 conversationStatus === 'active' ? 'Active' :
                 conversationStatus === 'awaiting_approval' ? 'Awaiting Approval' :
                 'Completed'}
              </Badge>
            </div>

            <div>
              <span className="text-[10px] text-fg-muted uppercase tracking-wider block mb-0.5">Conversation ID</span>
              <p className="text-xs font-mono text-fg truncate">
                {conversationId ?? <span className="text-fg-subtle">—</span>}
              </p>
            </div>

            <div>
              <span className="text-[10px] text-fg-muted uppercase tracking-wider block mb-0.5">Steps completed</span>
              <p className="text-xs font-mono text-fg">{allSteps.length}</p>
            </div>

            <div className="border-t border-border pt-3">
              <span className="text-[10px] text-fg-muted uppercase tracking-wider block mb-1">Usage</span>
              {usage ? (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-fg-muted">Tokens</span>
                    <span className="font-mono text-fg">{usage.tokens.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-fg-muted">Cost</span>
                    <span className="font-mono text-fg">${usage.cost.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-fg-muted">Model</span>
                    <span className="font-mono text-fg text-right max-w-[140px] truncate" title={usage.model}>{usage.model}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-fg-muted">Provider</span>
                    <span className="font-mono text-fg text-right max-w-[140px] truncate" title={usage.provider}>{usage.provider}</span>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-fg-subtle">No usage data yet</p>
              )}
            </div>

            <div className="border-t border-border pt-3">
              <span className="text-[10px] text-fg-muted uppercase tracking-wider block mb-1">Messages</span>
              <p className="text-xs font-mono text-fg">{messages.length}</p>
            </div>

            <div>
              <span className="text-[10px] text-fg-muted uppercase tracking-wider block mb-0.5">Approval</span>
              <Badge tone={approvalRequired ? 'warning' : 'muted'} size="sm">
                {approvalRequired ? 'Required' : 'Not required'}
              </Badge>
            </div>

            <div>
              <span className="text-[10px] text-fg-muted uppercase tracking-wider block mb-0.5">Max steps</span>
              <p className="text-xs font-mono text-fg">{maxSteps}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
