import { logger, eventBus, SystemEvents } from '@dmr-x/utils';
import type { UnifiedRequest, UnifiedResponse } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';

export interface EvaluationResult {
  winner: 'A' | 'B' | 'Tie';
  reasoning: string;
  scores: {
    accuracy: number;
    formatting: number;
    tone: number;
  };
}

/**
 * JudgeService uses a high-capability LLM to evaluate and compare model outputs.
 * This is the "LLM-as-a-Judge" implementation.
 */
export class JudgeService {
  constructor(private router: Router) {}

  /**
   * Compare two model responses head-to-head.
   */
  async compare(
    prompt: string,
    responseA: string,
    responseB: string,
    judgeModelId: string = 'gpt-4o'
  ): Promise<EvaluationResult> {
    logger.info({ judgeModelId }, 'Starting head-to-head evaluation');

    const judgePrompt = `
      You are an impartial judge evaluating the quality of two AI responses to the same prompt.
      
      Original User Prompt: 
      "${prompt}"
      
      Response A:
      "${responseA}"
      
      Response B:
      "${responseB}"
      
      Evaluate both responses based on Accuracy, Instruction Following, and Tone.
      Which response is better? You must pick a winner ('A', 'B', or 'Tie').
      
      Return your evaluation in the following JSON format:
      {
        "winner": "A" | "B" | "Tie",
        "reasoning": "Detailed explanation of why you picked the winner",
        "scores": {
          "accuracy": 0-10,
          "formatting": 0-10,
          "tone": 0-10
        }
      }
    `;

    try {
      const judgeRequest: UnifiedRequest = {
        modality: 'llm',
        model: judgeModelId,
        messages: [{ role: 'user', content: judgePrompt }],
        max_tokens: 500,
        response_format: { type: 'json_object' },
        stream: false,
        metadata: {
          is_internal: true,
          purpose: 'benchmarking'
        }
      };

      // Route the judge request to the best available judge model
      const { response } = await this.router.route(judgeRequest, {
        path: '/v1/chat/completions',
        qualityTarget: 'frontier'
      });

      const content = response.message?.content;
      if (typeof content !== 'string') {
        throw new Error('Judge returned empty response');
      }

      const result = JSON.parse(content) as EvaluationResult;
      return result;
    } catch (err) {
      logger.error({ err }, 'Judge evaluation failed');
      throw err;
    }
  }

  /**
   * Single model evaluation (grading without a competitor).
   */
  async grade(
    prompt: string,
    response: string,
    judgeModelId: string = 'gpt-4o'
  ): Promise<number> {
    const judgePrompt = `
      You are an impartial judge evaluating the quality of an AI response.
      
      Original User Prompt: 
      "${prompt}"
      
      Response:
      "${response}"
      
      Grade the response on a scale of 0.0 to 1.0 based on Accuracy and Instruction Following.
      Return ONLY the number.
    `;

    try {
      const judgeRequest: UnifiedRequest = {
        modality: 'llm',
        model: judgeModelId,
        messages: [{ role: 'user', content: judgePrompt }],
        max_tokens: 10,
        stream: false,
        metadata: { is_internal: true }
      };

      const { response: judgeResponse } = await this.router.route(judgeRequest, {
        path: '/v1/chat/completions'
      });

      const content = judgeResponse.message?.content;
      const score = parseFloat(typeof content === 'string' ? content : '0');
      return isNaN(score) ? 0.5 : score;
    } catch (err) {
      logger.error({ err }, 'Judge grading failed');
      return 0.5;
    }
  }
}
