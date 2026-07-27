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

  // NOTE: context size is deliberately NOT expressed as a capability here.
  //
  // Everything this function returns is fed to `capabilityFilter`, which HARD
  // rejects any model missing a listed capability. Model capabilities come from
  // `RegistryService.extractCapabilities`, whose complete vocabulary is
  // streaming / vision / tool_use / json_mode / function_call / reasoning —
  // there is no `long_context` tag and never was. Requiring one therefore
  // emptied the candidate set outright, and every request over the threshold
  // failed with "All providers currently unavailable" without a single
  // provider being contacted.
  //
  // Context fit is already handled properly downstream: `classifyTask` records
  // `sizeEstimate.inputTokens`, the `context-optimized` strategy selects on
  // context window (and degrades to the largest window when nothing fits), and
  // `minContextWindow` feeds candidate scoring.

  return capabilities;
}
