import { logger } from '@dmr-x/utils';
import { memoryService } from './memory.service.js';
import type { Message } from '@dmr-x/core';

export interface CaptureContext {
  tenantId?: string;
  requestId?: string;
  model?: string;
  provider?: string;
  messages: Message[];
}

export class AutoCapture {
  private enabled = true;
  private minContentLength = 20;

  captureToolResult(ctx: CaptureContext, toolName: string, result: string): void {
    if (!this.enabled) return;
    if (result.length < this.minContentLength) return;

    memoryService.create({
      tenantId: ctx.tenantId || 'local',
      content: `[Tool: ${toolName}] ${result.slice(0, 2000)}`,
      namespace: 'tool-results',
      source: 'auto',
      metadata: {
        requestId: ctx.requestId,
        toolName,
        model: ctx.model,
        provider: ctx.provider,
      },
    }).catch(err => {
      logger.warn({ error: String(err) }, 'Auto-capture tool result failed');
    });
  }

  captureConversationSummary(ctx: CaptureContext): void {
    if (!this.enabled) return;
    if (ctx.messages.length < 3) return;

    const summary = ctx.messages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(' | ')
      .slice(0, 2000);

    if (summary.length < this.minContentLength) return;

    memoryService.create({
      tenantId: ctx.tenantId || 'local',
      content: `[Conversation] ${summary}`,
      namespace: 'conversations',
      source: 'auto',
      metadata: {
        requestId: ctx.requestId,
        messageCount: ctx.messages.length,
        model: ctx.model,
        provider: ctx.provider,
      },
    }).catch(err => {
      logger.warn({ error: String(err) }, 'Auto-capture conversation failed');
    });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

export const autoCapture = new AutoCapture();
