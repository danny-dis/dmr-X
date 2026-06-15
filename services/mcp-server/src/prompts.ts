/**
 * MCP Prompts for DMR-X.
 *
 * Prompts are reusable prompt templates surfaced as slash commands or
 * UI elements in MCP clients. They guide LLM behavior for common tasks.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// The MCP SDK types each prompt arg as
// `ZodType<string, ZodTypeDef, string> | ZodOptional<...>`. Zod 3.23's
// ZodString / ZodOptional<ZodString> add `~standard` and `~validate` props
// that newer zod versions don't, so direct assignment fails structurally.
// `toPromptArgs()` re-projects the schema object to the SDK's expected shape
// in one cast. Each call site still goes through zod's runtime validators.
const toPromptArgs = <T extends Record<string, unknown>>(args: T): any => args;

// `registerPrompt` is a typed wrapper around `server.prompt` that lets us
// pass a callback with destructured args without the SDK's strict
// `PromptArgsRawShape` inference tripping over the zod 3.23 mismatch.
function registerPrompt<A extends Record<string, unknown>, R>(
  server: McpServer,
  name: string,
  description: string,
  args: A,
  cb: (args: A) => R,
): void {
  (server.prompt as any).call(server, name, description, toPromptArgs(args), cb);
}

/**
 * Registers MCP prompts on the given server.
 */
export function registerPrompts(server: McpServer): void {
  // -----------------------------------------------------------------------
  // Prompt: summarize-conversation
  // -----------------------------------------------------------------------
  registerPrompt(
    server,
    'summarize-conversation',
    'Summarize a conversation with configurable detail level',
    {
      conversation: z.string().describe('The conversation text to summarize'),
      detail: z.enum(['brief', 'standard', 'detailed']).optional().describe('Level of detail in the summary'),
    },
    ({ conversation, detail }) => {
      const detailLevel: 'brief' | 'standard' | 'detailed' =
        (detail as unknown as 'brief' | 'standard' | 'detailed' | undefined) || 'standard';
      const instructions: Record<'brief' | 'standard' | 'detailed', string> = {
        brief: 'Provide a 2-3 sentence summary focusing on key decisions and outcomes.',
        standard: 'Provide a paragraph summary covering main topics, decisions, and action items.',
        detailed: 'Provide a comprehensive summary with sections for: Key Topics, Decisions Made, Action Items, and Open Questions.',
      };

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `${instructions[detailLevel]}\n\nConversation:\n${conversation}`,
            },
          },
        ],
      };
    }
  );

  // -----------------------------------------------------------------------
  // Prompt: code-review
  // -----------------------------------------------------------------------
  registerPrompt(
    server,
    'code-review',
    'Review code with structured feedback',
    {
      code: z.string().describe('The code to review'),
      language: z.string().optional().describe('Programming language (e.g., "typescript", "python")'),
      focus: z.enum(['security', 'performance', 'readability', 'all']).optional().describe('Review focus area'),
    },
    ({ code, language, focus }) => {
      const lang = language || 'the given language';
      const focusArea: 'security' | 'performance' | 'readability' | 'all' =
        (focus as unknown as 'security' | 'performance' | 'readability' | 'all' | undefined) || 'all';
      const focusInstructions: Record<'security' | 'performance' | 'readability' | 'all', string> = {
        security: 'Focus on security vulnerabilities, injection risks, and authentication issues.',
        performance: 'Focus on performance bottlenecks, memory leaks, and optimization opportunities.',
        readability: 'Focus on code clarity, naming conventions, and maintainability.',
        all: 'Provide a comprehensive review covering security, performance, readability, and best practices.',
      };

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Review the following ${lang} code. ${focusInstructions[focusArea]}\n\nProvide feedback in this format:\n1. Issues Found (with severity: critical/high/medium/low)\n2. Suggestions for Improvement\n3. Overall Assessment\n\nCode:\n\`\`\`${lang}\n${code}\n\`\`\``,
            },
          },
        ],
      };
    }
  );

  // -----------------------------------------------------------------------
  // Prompt: translate
  // -----------------------------------------------------------------------
  registerPrompt(
    server,
    'translate',
    'Translate text between languages',
    {
      text: z.string().describe('Text to translate'),
      target_language: z.string().describe('Target language (e.g., "Spanish", "Japanese")'),
      style: z.enum(['formal', 'casual', 'technical']).optional().describe('Translation style'),
    },
    ({ text, target_language, style }) => {
      const styleInstruction = style ? `Use a ${style} tone.` : 'Use a natural, conversational tone.';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Translate the following text to ${target_language}. ${styleInstruction}\n\nProvide only the translation without explanations.\n\nText:\n${text}`,
            },
          },
        ],
      };
    }
  );

  // -----------------------------------------------------------------------
  // Prompt: explain-like-im-5
  // -----------------------------------------------------------------------
  registerPrompt(
    server,
    'explain-like-im-5',
    'Explain a complex topic in simple terms',
    {
      topic: z.string().describe('The topic to explain'),
      audience: z.string().optional().describe('Target audience (e.g., "beginner", "non-technical")'),
    },
    ({ topic, audience }) => {
      const targetAudience = audience || 'a complete beginner';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Explain "${topic}" to ${targetAudience}.\n\nUse simple language, avoid jargon, and include analogies where helpful. Keep it concise but complete.`,
            },
          },
        ],
      };
    }
  );

  // -----------------------------------------------------------------------
  // Prompt: generate-test-cases
  // -----------------------------------------------------------------------
  registerPrompt(
    server,
    'generate-test-cases',
    'Generate test cases for a function or module',
    {
      code: z.string().describe('The code to generate tests for'),
      language: z.string().optional().describe('Programming language'),
      framework: z.string().optional().describe('Testing framework (e.g., "jest", "vitest", "pytest")'),
    },
    ({ code, language, framework }) => {
      const lang = language || 'the given language';
      const fw = framework || 'the standard testing framework';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Generate comprehensive test cases for the following ${lang} code using ${fw}.\n\nInclude:\n1. Happy path tests\n2. Edge cases\n3. Error handling tests\n4. Boundary condition tests\n\nCode:\n\`\`\`${lang}\n${code}\n\`\`\`\n\nProvide the test code with clear descriptions for each test case.`,
            },
          },
        ],
      };
    }
  );
}
