/**
 * Caveman-style prompt compression engine.
 * Removes filler words, condenses prose, and makes text more terse.
 * Inspired by the "why use many token when few token do trick" philosophy.
 */

export interface CavemanResult {
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  saved: number;
}

export interface CavemanOptions {
  /** Aggressiveness level: 1 (light) to 3 (heavy) (default: 2) */
  aggressiveness?: number;
  /** Keep technical terms untouched (default: true) */
  preserveTechnical?: boolean;
  /** Maximum line length before splitting (default: 200) */
  maxLineLength?: number;
}

const DEFAULT_OPTIONS: Required<CavemanOptions> = {
  aggressiveness: 2,
  preserveTechnical: true,
  maxLineLength: 200,
};

// Filler words and phrases to remove at different aggressiveness levels
const FILLER_LEVEL_1 = [
  /\bactually\b/gi,
  /\bbasically\b/gi,
  /\bliterally\b/gi,
  /\bhonestly\b/gi,
  /\breally\b/gi,
  /\bjust\b/gi,
  /\bvery\b/gi,
  /\bquite\b/gi,
  /\bpretty\b/gi,
  /\bsomewhat\b/gi,
  /\bfairly\b/gi,
];

const FILLER_LEVEL_2 = [
  /\bin order to\b/gi,
  /\bdue to the fact that\b/gi,
  /\bat this point in time\b/gi,
  /\bfor the purpose of\b/gi,
  /\bin the event that\b/gi,
  /\bwith regard to\b/gi,
  /\bin the process of\b/gi,
  /\bit is important to note that\b/gi,
  /\bit should be noted that\b/gi,
  /\bas a matter of fact\b/gi,
  /\bfor all intents and purposes\b/gi,
];

const FILLER_LEVEL_3 = [
  /\bthat is to say\b/gi,
  /\bin light of the fact that\b/gi,
  /\bgiven the fact that\b/gi,
  /\bon a daily basis\b/gi,
  /\bat the present time\b/gi,
  /\bin the near future\b/gi,
  /\bprior to\b/gi,
  /\bsubsequent to\b/gi,
  /\bin the vicinity of\b/gi,
  /\bwith respect to\b/gi,
];

// Contraction rules
const CONTRACTIONS: [RegExp, string][] = [
  [/\bdo not\b/gi, "don't"],
  [/\bcannot\b/gi, "can't"],
  [/\bwill not\b/gi, "won't"],
  [/\bshould not\b/gi, "shouldn't"],
  [/\bwould not\b/gi, "wouldn't"],
  [/\bcould not\b/gi, "couldn't"],
  [/\bis not\b/gi, "isn't"],
  [/\bare not\b/gi, "aren't"],
  [/\bwas not\b/gi, "wasn't"],
  [/\bwere not\b/gi, "weren't"],
  [/\bhas not\b/gi, "hasn't"],
  [/\bhave not\b/gi, "haven't"],
  [/\bhad not\b/gi, "hadn't"],
  [/\bit is\b/gi, "it's"],
  [/\bthat is\b/gi, "that's"],
  [/\bthere is\b/gi, "there's"],
  [/\bwe are\b/gi, "we're"],
  [/\byou are\b/gi, "you're"],
  [/\bthey are\b/gi, "they're"],
  [/\bI am\b/gi, "I'm"],
];

// Abbreviation rules
const ABBREVIATIONS: [RegExp, string][] = [
  [/\bbecause\b/gi, "bc"],
  [/\bwith\b/gi, "w/"],
  [/\bwithout\b/gi, "w/o"],
  [/\bapproximately\b/gi, "~"],
  [/\bfor example\b/gi, "e.g."],
  [/\bthat is\b/gi, "i.e."],
  [/\betcetera\b/gi, "etc"],
];

export function compressCaveman(input: string, options?: CavemanOptions): CavemanResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const originalTokens = estimateTokens(input);

  let result = input;

  // Step 1: Remove filler words (based on aggressiveness)
  result = removeFillers(result, opts.aggressiveness);

  // Step 2: Apply contractions
  result = applyContractions(result);

  // Step 3: Apply abbreviations (only at high aggressiveness)
  if (opts.aggressiveness >= 3) {
    result = applyAbbreviations(result, opts.preserveTechnical);
  }

  // Step 4: Condense whitespace
  result = condenseWhitespace(result);

  // Step 5: Remove redundant punctuation
  result = removeRedundantPunctuation(result);

  const compressedTokens = estimateTokens(result);

  return {
    compressed: result,
    originalTokens,
    compressedTokens,
    saved: originalTokens - compressedTokens,
  };
}

function removeFillers(text: string, aggressiveness: number): string {
  let result = text;

  if (aggressiveness >= 1) {
    for (const pattern of FILLER_LEVEL_1) {
      result = result.replace(pattern, '');
    }
  }

  if (aggressiveness >= 2) {
    for (const pattern of FILLER_LEVEL_2) {
      result = result.replace(pattern, '');
    }
  }

  if (aggressiveness >= 3) {
    for (const pattern of FILLER_LEVEL_3) {
      result = result.replace(pattern, '');
    }
  }

  return result;
}

function applyContractions(text: string): string {
  let result = text;
  for (const [pattern, replacement] of CONTRACTIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function applyAbbreviations(text: string, preserveTechnical: boolean): string {
  let result = text;

  // Don't abbreviate inside code blocks or technical terms
  if (preserveTechnical) {
    // Split by code blocks and only abbreviate non-code parts
    const parts = result.split(/(```[\s\S]*?```|`[^`]+`)/g);
    return parts.map((part, i) => {
      // Odd indices are code blocks
      if (i % 2 === 1) return part;
      for (const [pattern, replacement] of ABBREVIATIONS) {
        part = part.replace(pattern, replacement);
      }
      return part;
    }).join('');
  }

  for (const [pattern, replacement] of ABBREVIATIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function condenseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')  // Multiple spaces → single space
    .replace(/\n{3,}/g, '\n\n')  // Multiple blank lines → double newline
    .trim();
}

function removeRedundantPunctuation(text: string): string {
  return text
    .replace(/\.{4,}/g, '...')  // Multiple dots → ellipsis
    .replace(/-{4,}/g, '---')  // Multiple dashes → em dash
    .replace(/!{2,}/g, '!')  // Multiple exclamations → single
    .replace(/\?{2,}/g, '?');  // Multiple questions → single
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
