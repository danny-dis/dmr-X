/**
 * Prompt Library Types
 */

export interface PromptEntry {
  id: string;
  provider: string;
  category: string;
  title: string;
  description: string;
  content: string;
  tags: string[];
  source: 'l1b3rt4s' | 'custom';
}

export interface PromptCategory {
  id: string;
  name: string;
  provider: string;
  count: number;
}

export interface PromptPreviewRequest {
  prompt_id: string;
  sample_input?: string;
}

export interface PromptPreviewResponse {
  prompt_id: string;
  prompt_content: string;
  preview: string;
}
