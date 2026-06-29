import { logger } from '@dmr-x/utils';

/**
 * Handover Summarizer
 *
 * Inspired by workweave/router's handover summarizer that bounds the input
 * cost of model switches. When the planner decides SWITCH, this module
 * uses a small/cheap model to summarize the prior conversation history
 * before dispatching to the new model.
 *
 * Key behaviors:
 * - Respects context deadlines (never hangs on summarization)
 * - On timeout or error, falls back to full history (never silently drops)
 * - Uses the cheapest available model by default
 * - Bounds switch-turn input cost regardless of session length
 *
 * This is a pure service — no DB state. All I/O happens through the
 * adapter executor callback.
 */

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string }>;
}

export interface SummarizeInput {
  /** Full conversation history to summarize */
  messages: Message[];
  /** Maximum tokens for the summary */
  maxSummaryTokens?: number;
  /** Timeout in milliseconds for the summarization call */
  timeoutMs?: number;
}

export interface SummarizeResult {
  /** The summarized conversation history */
  messages: Message[];
  /** Whether summarization was used (false = fell back to full history) */
  summarized: boolean;
  /** Original token count (approximate) */
  originalTokens: number;
  /** Summarized token count (approximate) */
  summarizedTokens: number;
  /** The model used for summarization */
  summarizerModel: string;
}

/**
 * Callback type for executing the summarization LLM call.
 * This keeps the handover module I/O-free — the caller provides the executor.
 */
export type SummarizationExecutor = (input: {
  model: string;
  messages: Message[];
  max_tokens: number;
  temperature: number;
}) => Promise<{ content: string; tokens: number }>;

export class HandoverSummarizer {
  private defaultModel: string;
  private defaultMaxTokens: number;
  private defaultTimeoutMs: number;

  constructor() {
    this.defaultModel = process.env.DMRX_HANDOVER_MODEL || 'auto-fast';
    this.defaultMaxTokens = parseInt(process.env.DMRX_HANDOVER_MAX_TOKENS || '1024', 10);
    this.defaultTimeoutMs = parseInt(process.env.DMRX_HANDOVER_TIMEOUT_MS || '10000', 10);
  }

  /**
   * Summarize conversation history for model handover.
   *
   * If summarization fails or times out, returns the full original history
   * with `summarized: false`. This is the safe fallback — a pricier switch
   * turn beats silently dropping context the switched-to model needs.
   */
  async summarize(
    input: SummarizeInput,
    executor: SummarizationExecutor,
  ): Promise<SummarizeResult> {
    const { messages } = input;
    const maxTokens = input.maxSummaryTokens || this.defaultMaxTokens;
    const timeoutMs = input.timeoutMs || this.defaultTimeoutMs;
    const model = this.defaultModel;

    const originalTokens = this.estimateTokens(messages);

    // Don't summarize if conversation is short (under 500 tokens)
    if (originalTokens < 500) {
      return {
        messages,
        summarized: false,
        originalTokens,
        summarizedTokens: originalTokens,
        summarizerModel: model,
      };
    }

    // Build summarization prompt
    const summarizationMessages: Message[] = [
      {
        role: 'system',
        content: `You are a conversation summarizer. Your task is to create a concise but complete summary of the conversation history that preserves:
1. Key decisions and conclusions
2. Important context and constraints
3. User's stated goals and preferences
4. Any code, data, or technical details mentioned
5. The current state of any ongoing task

The summary should be written as if continuing the conversation — the next model will read this summary and continue where the previous model left off.

Keep the summary under ${maxTokens} tokens. Be concise but preserve all critical information.`,
      },
      {
        role: 'user',
        content: `Summarize this conversation history for handover to a new model:\n\n${this.formatMessages(messages)}`,
      },
    ];

    try {
      // Execute with timeout
      const result = await Promise.race([
        executor({
          model,
          messages: summarizationMessages,
          max_tokens: maxTokens,
          temperature: 0.3, // Low temperature for consistent summaries
        }),
        this.createTimeout(timeoutMs),
      ]);

      if (!result || !('content' in result)) {
        // Timeout — return full history
        logger.warn({ timeoutMs }, 'Handover summarization timed out, using full history');
        return {
          messages,
          summarized: false,
          originalTokens,
          summarizedTokens: originalTokens,
          summarizerModel: model,
        };
      }

      const summarizedTokens = this.estimateTokens([{ role: 'assistant', content: result.content }]);

      logger.info(
        {
          originalTokens,
          summarizedTokens,
          ratio: summarizedTokens / originalTokens,
          model,
        },
        'Handover summarization completed',
      );

      return {
        messages: [
          {
            role: 'system',
            content: `[Conversation Summary]\n${result.content}\n[/Conversation Summary]\n\nContinue the conversation from where the previous model left off.`,
          },
        ],
        summarized: true,
        originalTokens,
        summarizedTokens,
        summarizerModel: model,
      };
    } catch (err) {
      // Error — return full history (never silently drop)
      logger.warn({ error: String(err) }, 'Handover summarization failed, using full history');
      return {
        messages,
        summarized: false,
        originalTokens,
        summarizedTokens: originalTokens,
        summarizerModel: model,
      };
    }
  }

  /**
   * Trim message history to fit within a token budget.
   * Preserves the most recent messages and the system prompt.
   */
  trimToBudget(messages: Message[], maxTokens: number): Message[] {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const systemTokens = this.estimateTokens(systemMessages);
    const remainingBudget = maxTokens - systemTokens;

    if (remainingBudget <= 0) {
      // Just return system messages + last user message
      const lastUser = nonSystemMessages.filter((m) => m.role === 'user').slice(-1);
      return [...systemMessages, ...lastUser];
    }

    // Keep most recent messages that fit in budget
    const kept: Message[] = [];
    let tokensUsed = 0;

    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
      const msgTokens = this.estimateTokens([nonSystemMessages[i]]);
      if (tokensUsed + msgTokens > remainingBudget) break;
      kept.unshift(nonSystemMessages[i]);
      tokensUsed += msgTokens;
    }

    return [...systemMessages, ...kept];
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private formatMessages(messages: Message[]): string {
    return messages
      .map((m) => {
        const content = typeof m.content === 'string'
          ? m.content
          : m.content
              .filter((c) => c.type === 'text')
              .map((c) => c.text)
              .join('\n');
        return `[${m.role}]: ${content}`;
      })
      .join('\n\n');
  }

  private estimateTokens(messages: Message[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.text) totalChars += block.text.length;
        }
      }
    }
    // ~4 chars per token heuristic (same as DMR-X router)
    return Math.ceil(totalChars / 4);
  }

  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Summarization timeout')), ms);
    });
  }
}
