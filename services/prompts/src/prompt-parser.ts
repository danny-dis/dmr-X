/**
 * Prompt Parser — parses L1B3RT4S .mkd files into structured prompts.
 *
 * Each .mkd file contains multiple prompts separated by headers.
 * The parser extracts individual prompts with metadata.
 */

import type { PromptEntry } from './types.js';

/**
 * Parse a .mkd file content into prompt entries
 */
export function parseMkdFile(
  content: string,
  provider: string,
  filename: string
): PromptEntry[] {
  const prompts: PromptEntry[] = [];

  // Normalize literal \n sequences to real newlines (JSON stores them as two chars)
  const normalized = content.replace(/\\n/g, '\n');

  const sections = normalized.split(/^#{1,3}\s+/m).filter(s => s.trim());

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const lines = section.split('\n');
    const title = lines[0]?.trim() || `Prompt ${i + 1}`;
    const body = lines.slice(1).join('\n').trim();

    if (!body) continue;

    // Extract description from first paragraph or line
    const firstParagraph = body.split('\n\n')[0]?.trim() || '';
    const description = firstParagraph.length > 200
      ? firstParagraph.slice(0, 197) + '...'
      : firstParagraph;

    // Generate ID from provider and title
    const id = `${provider}-${filename}-${i}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Extract tags from content (look for common patterns)
    const tags = extractTags(body, provider);

    prompts.push({
      id,
      provider: provider.toUpperCase(),
      category: detectCategory(title, body),
      title,
      description: description || `Prompt for ${provider}`,
      content: body,
      tags,
      source: 'l1b3rt4s',
    });
  }

  return prompts;
}

/**
 * Extract tags from prompt content
 */
function extractTags(content: string, provider: string): string[] {
  const tags: string[] = [provider.toLowerCase()];

  // Detect common patterns
  const patterns = [
    { pattern: /jailbreak/i, tag: 'jailbreak' },
    { pattern: /system\s*prompt/i, tag: 'system-prompt' },
    { pattern: /roleplay/i, tag: 'roleplay' },
    { pattern: /dan|do\s*anything/i, tag: 'dan' },
    { pattern: /越狱|突破/i, tag: 'jailbreak' },
    { pattern: /red\s*team/i, tag: 'red-team' },
    { pattern: /prompt\s*injection/i, tag: 'injection' },
    { pattern: /bypass|override/i, tag: 'bypass' },
    { pattern: /creative|story|fiction/i, tag: 'creative' },
    { pattern: /code|coding|programming/i, tag: 'coding' },
    { pattern: /research|analysis/i, tag: 'research' },
  ];

  for (const { pattern, tag } of patterns) {
    if (pattern.test(content) && !tags.includes(tag)) {
      tags.push(tag);
    }
  }

  return tags;
}

/**
 * Detect prompt category from title and content
 */
function detectCategory(title: string, content: string): string {
  const text = `${title} ${content}`.toLowerCase();

  if (/system\s*prompt|system\s*message/i.test(text)) return 'system-prompts';
  if (/jailbreak|dan|bypass|override/i.test(text)) return 'jailbreaks';
  if (/roleplay|character|persona/i.test(text)) return 'roleplay';
  if (/code|coding|programming|developer/i.test(text)) return 'coding';
  if (/research|analysis|academic/i.test(text)) return 'research';
  if (/creative|story|fiction|writing/i.test(text)) return 'creative';
  if (/red\s*team|security|penetration/i.test(text)) return 'security';
  if (/business|marketing|sales/i.test(text)) return 'business';

  return 'general';
}
