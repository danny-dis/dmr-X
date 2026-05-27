import type { UnifiedRequest } from '@dmr-x/core';

export function extractCapabilities(request: UnifiedRequest): string[] {
  const capabilities: string[] = [];

  if (request.modality !== 'llm') {
    return capabilities;
  }

  // Vision detection
  if (request.messages?.some((msg) => {
    const content = msg.content;
    if (Array.isArray(content)) {
      return content.some((part) => part.type === 'image_url');
    }
    return false;
  })) {
    capabilities.push('vision');
  }

  // Tool use detection
  if (request.tools && request.tools.length > 0) {
    capabilities.push('tool_use');
  }

  // JSON mode detection
  if (request.response_format?.type === 'json_object') {
    capabilities.push('json_mode');
  }

  // Long context detection (rough estimate)
  if (request.messages) {
    const totalChars = request.messages.reduce((sum, msg) => {
      if (typeof msg.content === 'string') return sum + msg.content.length;
      if (Array.isArray(msg.content)) {
        return sum + msg.content.reduce((s, p) => {
          if (p.type === 'text') return s + p.text.length;
          return s;
        }, 0);
      }
      return sum;
    }, 0);
    if (totalChars > 50000) {
      capabilities.push('long_context');
    }
  }

  return capabilities;
}
