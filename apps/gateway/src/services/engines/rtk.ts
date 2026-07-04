/**
 * RTK (Rust Token Killer) style compression engine.
 * Compresses command outputs and structured data by:
 * - Deduplicating repeated lines
 * - Collapsing long arrays/objects
 * - Removing redundant whitespace
 * - Compressing JSON structures
 */

export interface RTKResult {
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  saved: number;
}

export interface RTKOptions {
  /** Max repeated lines to keep before collapsing (default: 2) */
  maxRepeated?: number;
  /** Max array/object items to keep before collapsing (default: 3) */
  maxItems?: number;
  /** Remove trailing whitespace (default: true) */
  trimWhitespace?: boolean;
  /** Collapse consecutive blank lines (default: true) */
  collapseBlankLines?: boolean;
}

const DEFAULT_OPTIONS: Required<RTKOptions> = {
  maxRepeated: 2,
  maxItems: 3,
  trimWhitespace: true,
  collapseBlankLines: true,
};

export function compressRTK(input: string, options?: RTKOptions): RTKResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const originalTokens = estimateTokens(input);

  let result = input;

  // Step 1: Trim whitespace
  if (opts.trimWhitespace) {
    result = result.split('\n').map(l => l.trimEnd()).join('\n');
  }

  // Step 2: Collapse consecutive blank lines
  if (opts.collapseBlankLines) {
    result = result.replace(/\n{3,}/g, '\n\n');
  }

  // Step 3: Deduplicate repeated lines
  result = deduplicateLines(result, opts.maxRepeated);

  // Step 4: Compress JSON structures
  result = compressJSON(result, opts.maxItems);

  const compressedTokens = estimateTokens(result);

  return {
    compressed: result,
    originalTokens,
    compressedTokens,
    saved: originalTokens - compressedTokens,
  };
}

function deduplicateLines(text: string, maxRepeated: number): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    let count = 1;

    // Count consecutive identical lines
    while (i + count < lines.length && lines[i + count] === line) {
      count++;
    }

    if (count <= maxRepeated) {
      // Keep all lines if count is within threshold
      for (let j = 0; j < count; j++) {
        result.push(line);
      }
    } else {
      // Keep first N, then collapse rest
      for (let j = 0; j < maxRepeated; j++) {
        result.push(line);
      }
      const collapsed = count - maxRepeated;
      result.push(`  [... ${collapsed} repeated lines omitted]`);
    }

    i += count;
  }

  return result.join('\n');
}

function compressJSON(text: string, maxItems: number): string {
  // Try to parse as JSON
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(compressValue(parsed, maxItems));
  } catch {
    // Not JSON, try to find JSON blocks in the text
    return compressJSONBlocks(text, maxItems);
  }
}

function compressJSONBlocks(text: string, maxItems: number): string {
  // Find JSON-like blocks and compress them
  const jsonPattern = /(\{[\s\S]*?\}|\[[\s\S]*?\])/g;
  let result = text;
  let match;

  while ((match = jsonPattern.exec(text)) !== null) {
    const block = match[1];
    try {
      const parsed = JSON.parse(block);
      const compressed = JSON.stringify(compressValue(parsed, maxItems));
      if (compressed.length < block.length) {
        result = result.replace(block, compressed);
      }
    } catch {
      // Skip invalid JSON blocks
    }
  }

  return result;
}

function compressValue(value: any, maxItems: number): any {
  if (Array.isArray(value)) {
    if (value.length <= maxItems) {
      return value.map(v => compressValue(v, maxItems));
    }
    // Keep first N items, add marker
    const kept = value.slice(0, maxItems).map(v => compressValue(v, maxItems));
    kept.push(`[... ${value.length - maxItems} items]`);
    return kept;
  }

  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length <= maxItems) {
      const result: Record<string, any> = {};
      for (const key of keys) {
        result[key] = compressValue(value[key], maxItems);
      }
      return result;
    }
    // Keep first N keys, add marker
    const result: Record<string, any> = {};
    for (const key of keys.slice(0, maxItems)) {
      result[key] = compressValue(value[key], maxItems);
    }
    result['...'] = `${keys.length - maxItems} more fields`;
    return result;
  }

  return value;
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token
  return Math.ceil(text.length / 4);
}
