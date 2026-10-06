/**
 * StepTrace — formatted event trace for agentic/agent streams.
 *
 * Replaces the raw JSON event dump with readable step cards.
 * Each event has an icon, a title, and formatted content.
 */

import * as React from 'react';
import {
  MessageSquare,
  Wrench,
  CheckCircle,
  AlertCircle,
  Check,
  Brain,
  Zap,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StreamingEvent } from '@/store/usePlaygroundStore';

interface StepTraceProps {
  events: StreamingEvent[];
}

function getEventIcon(name: string) {
  switch (name) {
    case 'turn':
      return MessageSquare;
    case 'tool_calls':
      return Wrench;
    case 'tool_results':
      return CheckCircle;
    case 'error':
      return AlertCircle;
    case 'done':
      return Check;
    case 'thinking':
      return Brain;
    case 'step':
      return Zap;
    default:
      return Info;
  }
}

function getEventColor(name: string): string {
  switch (name) {
    case 'turn':
      return 'text-primary';
    case 'tool_calls':
      return 'text-warning';
    case 'tool_results':
      return 'text-success';
    case 'error':
      return 'text-danger';
    case 'done':
      return 'text-success';
    case 'thinking':
      return 'text-accent';
    case 'step':
      return 'text-fg-muted';
    default:
      return 'text-fg-muted';
  }
}

function formatEventData(name: string, data: any): string {
  if (!data) return '';

  // Turn events: show the message content
  if (name === 'turn' && data.message) {
    const content = typeof data.message.content === 'string'
      ? data.message.content
      : JSON.stringify(data.message.content, null, 2);
    return content;
  }

  // Tool calls: show tool name and arguments
  if (name === 'tool_calls' && data.tool_calls) {
    return data.tool_calls
      .map((tc: any) => {
        const fn = tc.function ?? tc;
        const args = fn.arguments ?? '';
        return `${fn.name}(${args})`;
      })
      .join('\n');
  }

  // Tool results: show result content
  if (name === 'tool_results' && data.tool_results) {
    return data.tool_results
      .map((tr: any) => {
        const content = tr.content ?? tr.result ?? JSON.stringify(tr);
        return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
      })
      .join('\n');
  }

  // Error events
  if (name === 'error') {
    return data.error?.message ?? data.message ?? JSON.stringify(data, null, 2);
  }

  // Done events
  if (name === 'done') {
    return data.message ?? 'Complete';
  }

  // Default: pretty-print JSON
  return JSON.stringify(data, null, 2);
}

export function StepTrace({ events }: StepTraceProps) {
  if (!events || events.length === 0) return null;

  return (
    <div className="ml-0 mt-2 space-y-1.5 sm:ml-12">
      {events.map((evt, i) => {
        const Icon = getEventIcon(evt.name);
        const color = getEventColor(evt.name);
        const content = formatEventData(evt.name, evt.data);

        return (
          <div
            key={i}
            className="flex items-start gap-2 rounded-lg border border-border bg-surface-1/80 p-2"
          >
            <Icon className={cn('mt-0.5 size-3.5 shrink-0', color)} />
            <div className="min-w-0 flex-1">
              <div className={cn('text-[10px] font-medium uppercase tracking-wider', color)}>
                {evt.name.replace(/_/g, ' ')}
              </div>
              {content && (
                <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[10px] text-fg-muted">
                  {content}
                </pre>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
