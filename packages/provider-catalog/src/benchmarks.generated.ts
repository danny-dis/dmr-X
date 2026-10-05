/**
 * GENERATED FILE — do not edit by hand.
 * Rebuild with: bun scripts/sync-benchmarks.ts
 *
 * Artificial Analysis benchmark indices (OpenRouter, 2026-10-05).
 * 147 models carry an intelligence_index.
 *
 * intelligenceRank consumers map the index to a 1-10 rank via
 * getBenchmarkIntelligenceRank() in this package (index.ts).
 */
export interface BenchmarkEntry {
  intelligenceIndex: number;
  codingIndex?: number;
  agenticIndex?: number;
}

export const MODEL_BENCHMARKS: Record<string, BenchmarkEntry> = {
  "inclusionai/ling-3.1-flash": {
    "intelligenceIndex": 41.1
  },
  "openai/gpt-6.1-sol": {
    "intelligenceIndex": 51.8
  },
  "anthropic/claude-sonnet-5.5": {
    "intelligenceIndex": 56
  },
  "anthropic/claude-sonnet-5.5:batch": {
    "intelligenceIndex": 56
  },
  "upstage/solar-mini4": {
    "intelligenceIndex": 24.1
  },
  "openai/gpt-6-luna": {
    "intelligenceIndex": 38.1
  },
  "openai/gpt-6-luna:batch": {
    "intelligenceIndex": 38.1
  },
  "openai/gpt-6-sol": {
    "intelligenceIndex": 47.6
  },
  "openai/gpt-6-sol:batch": {
    "intelligenceIndex": 47.6
  },
  "anthropic/claude-opus-5.5": {
    "intelligenceIndex": 57.6
  },
  "anthropic/claude-opus-5.5:batch": {
    "intelligenceIndex": 57.6
  },
  "xiaomi/mimo-v2.6-flash": {
    "intelligenceIndex": 37.9
  },
  "xiaomi/mimo-v2.6-pro": {
    "intelligenceIndex": 46.3
  },
  "x-ai/grok-4.7": {
    "intelligenceIndex": 46.4
  },
  "inclusionai/ling-3.0-flash-vl": {
    "intelligenceIndex": 24.6,
    "codingIndex": 57,
    "agenticIndex": 28.7
  },
  "deepseek/deepseek-v4.1-flash": {
    "intelligenceIndex": 39.5
  },
  "deepseek/deepseek-v4.1-flash:batch": {
    "intelligenceIndex": 39.5
  },
  "inception/mercury-2.5": {
    "intelligenceIndex": 12.3
  },
  "openai/gpt-6-astra": {
    "intelligenceIndex": 52.7,
    "codingIndex": 76.9,
    "agenticIndex": 51
  },
  "openai/gpt-6-astra:batch": {
    "intelligenceIndex": 52.7,
    "codingIndex": 76.9,
    "agenticIndex": 51
  },
  "qwen/qwen3.8-max-0902": {
    "intelligenceIndex": 45.4,
    "codingIndex": 76.2,
    "agenticIndex": 56
  },
  "google/gemini-3.8-flash": {
    "intelligenceIndex": 40.9,
    "codingIndex": 76.3,
    "agenticIndex": 40.2
  },
  "google/gemini-3.8-flash:batch": {
    "intelligenceIndex": 40.9,
    "codingIndex": 76.3,
    "agenticIndex": 40.2
  },
  "anthropic/claude-fable-5.1": {
    "intelligenceIndex": 53.4,
    "codingIndex": 81.6,
    "agenticIndex": 57.9
  },
  "anthropic/claude-fable-5.1:batch": {
    "intelligenceIndex": 53.4,
    "codingIndex": 81.6,
    "agenticIndex": 57.9
  },
  "ibm-granite/granite-4.2-8b": {
    "intelligenceIndex": 11.1,
    "codingIndex": 22.4,
    "agenticIndex": 1.3
  },
  "inclusionai/ling-3.0-flash-fin": {
    "intelligenceIndex": 22.6,
    "codingIndex": 55.6,
    "agenticIndex": 27.9
  },
  "z-ai/glm-5.3-flash": {
    "intelligenceIndex": 41.8,
    "codingIndex": 71.5,
    "agenticIndex": 50.9
  },
  "z-ai/glm-5.3-flash:batch": {
    "intelligenceIndex": 41.8,
    "codingIndex": 71.5,
    "agenticIndex": 50.9
  },
  "z-ai/glm-5.3": {
    "intelligenceIndex": 44.8,
    "codingIndex": 74.8,
    "agenticIndex": 53.1
  },
  "z-ai/glm-5.3:batch": {
    "intelligenceIndex": 44.8,
    "codingIndex": 74.8,
    "agenticIndex": 53.1
  },
  "qwen/qwen3.8-27b": {
    "intelligenceIndex": 33.7,
    "codingIndex": 68.1,
    "agenticIndex": 45.8
  },
  "qwen/qwen3.8-27b:free": {
    "intelligenceIndex": 33.7,
    "codingIndex": 68.1,
    "agenticIndex": 45.8
  },
  "google/gemini-3.7-flash": {
    "intelligenceIndex": 39.1,
    "codingIndex": 76.1,
    "agenticIndex": 35.2
  },
  "google/gemini-3.7-flash:batch": {
    "intelligenceIndex": 39.1,
    "codingIndex": 76.1,
    "agenticIndex": 35.2
  },
  "qwen/qwen3.8-2.4t-a95b": {
    "intelligenceIndex": 39.9,
    "codingIndex": 71.9,
    "agenticIndex": 50.1
  },
  "deepseek/deepseek-v4-pro-0813": {
    "intelligenceIndex": 36,
    "codingIndex": 68.8,
    "agenticIndex": 41.3
  },
  "x-ai/grok-4.6": {
    "intelligenceIndex": 44.3,
    "codingIndex": 76.8,
    "agenticIndex": 53
  },
  "nvidia/nemotron-3.5-lightning": {
    "intelligenceIndex": 12.9,
    "codingIndex": 26.8,
    "agenticIndex": 3.5
  },
  "nvidia/nemotron-3.5-lightning:free": {
    "intelligenceIndex": 12.9,
    "codingIndex": 26.8,
    "agenticIndex": 3.5
  },
  "meta/muse-spark-1.2": {
    "intelligenceIndex": 39.6,
    "codingIndex": 72.2,
    "agenticIndex": 43.2
  },
  "deepseek/deepseek-v4-flash-0731": {
    "intelligenceIndex": 34.3,
    "codingIndex": 69.1,
    "agenticIndex": 41
  },
  "thinkingmachines/inkling-small": {
    "intelligenceIndex": 25.7,
    "codingIndex": 52.9,
    "agenticIndex": 23.5
  },
  "thinkingmachines/inkling-small:free": {
    "intelligenceIndex": 25.7,
    "codingIndex": 52.9,
    "agenticIndex": 23.5
  },
  "anthropic/claude-opus-5": {
    "intelligenceIndex": 50.8,
    "codingIndex": 78,
    "agenticIndex": 56.5
  },
  "anthropic/claude-opus-5:batch": {
    "intelligenceIndex": 50.8,
    "codingIndex": 78,
    "agenticIndex": 56.5
  },
  "inclusionai/ling-3.0-flash": {
    "intelligenceIndex": 20.1,
    "codingIndex": 50.6,
    "agenticIndex": 19.3
  },
  "google/gemini-3.6-flash": {
    "intelligenceIndex": 34,
    "codingIndex": 69.2,
    "agenticIndex": 29
  },
  "google/gemini-3.6-flash:batch": {
    "intelligenceIndex": 34,
    "codingIndex": 69.2,
    "agenticIndex": 29
  },
  "google/gemini-3.5-flash-lite": {
    "intelligenceIndex": 22.2,
    "codingIndex": 49.3,
    "agenticIndex": 14.3
  },
  "google/gemini-3.5-flash-lite:batch": {
    "intelligenceIndex": 22.2,
    "codingIndex": 49.3,
    "agenticIndex": 14.3
  },
  "meituan/longcat-2.0": {
    "intelligenceIndex": 19.1,
    "codingIndex": 45.3,
    "agenticIndex": 14
  },
  "thinkingmachines/inkling": {
    "intelligenceIndex": 25,
    "codingIndex": 52.1,
    "agenticIndex": 22.5
  },
  "thinkingmachines/inkling:free": {
    "intelligenceIndex": 25,
    "codingIndex": 52.1,
    "agenticIndex": 22.5
  },
  "moonshotai/kimi-k3": {
    "intelligenceIndex": 43.6,
    "codingIndex": 76.2,
    "agenticIndex": 50
  },
  "moonshotai/kimi-k3:batch": {
    "intelligenceIndex": 43.6,
    "codingIndex": 76.2,
    "agenticIndex": 50
  },
  "meta/muse-spark-1.1": {
    "intelligenceIndex": 33.7,
    "codingIndex": 71.3,
    "agenticIndex": 25.8
  },
  "openai/gpt-5.6-luna": {
    "intelligenceIndex": 37.3,
    "codingIndex": 71.4,
    "agenticIndex": 42.1
  },
  "openai/gpt-5.6-luna:batch": {
    "intelligenceIndex": 37.3,
    "codingIndex": 71.4,
    "agenticIndex": 42.1
  },
  "openai/gpt-5.6-terra": {
    "intelligenceIndex": 42.1,
    "codingIndex": 76.7,
    "agenticIndex": 43.2
  },
  "openai/gpt-5.6-terra:batch": {
    "intelligenceIndex": 42.1,
    "codingIndex": 76.7,
    "agenticIndex": 43.2
  },
  "openai/gpt-5.6-sol": {
    "intelligenceIndex": 47,
    "codingIndex": 77.4,
    "agenticIndex": 50.2
  },
  "openai/gpt-5.6-sol:batch": {
    "intelligenceIndex": 47,
    "codingIndex": 77.4,
    "agenticIndex": 50.2
  },
  "x-ai/grok-4.5": {
    "intelligenceIndex": 38.8,
    "codingIndex": 72.4,
    "agenticIndex": 41.2
  },
  "anthropic/claude-sonnet-5": {
    "intelligenceIndex": 38.2,
    "codingIndex": 71.5,
    "agenticIndex": 43.6
  },
  "anthropic/claude-sonnet-5:batch": {
    "intelligenceIndex": 38.2,
    "codingIndex": 71.5,
    "agenticIndex": 43.6
  },
  "cohere/north-mini-code:free": {
    "intelligenceIndex": 9.9,
    "codingIndex": 36.5,
    "agenticIndex": 1.1
  },
  "z-ai/glm-5.2": {
    "intelligenceIndex": 33.7,
    "codingIndex": 68.8,
    "agenticIndex": 38.4
  },
  "moonshotai/kimi-k2.7-code": {
    "intelligenceIndex": 25.8,
    "codingIndex": 60.8,
    "agenticIndex": 21
  },
  "anthropic/claude-fable-5": {
    "intelligenceIndex": 49.6,
    "codingIndex": 76.5,
    "agenticIndex": 50.7
  },
  "anthropic/claude-fable-5:batch": {
    "intelligenceIndex": 49.6,
    "codingIndex": 76.5,
    "agenticIndex": 50.7
  },
  "nvidia/nemotron-3-ultra-550b-a55b": {
    "intelligenceIndex": 22.9,
    "codingIndex": 49.3,
    "agenticIndex": 20.1
  },
  "nvidia/nemotron-3-ultra-550b-a55b:free": {
    "intelligenceIndex": 22.9,
    "codingIndex": 49.3,
    "agenticIndex": 20.1
  },
  "qwen/qwen3.7-plus": {
    "intelligenceIndex": 25.2,
    "codingIndex": 55.9,
    "agenticIndex": 17.5
  },
  "minimax/minimax-m3": {
    "intelligenceIndex": 29.2,
    "codingIndex": 58.6,
    "agenticIndex": 29.5
  },
  "anthropic/claude-opus-4.8": {
    "intelligenceIndex": 41.8,
    "codingIndex": 74.3,
    "agenticIndex": 41.9
  },
  "anthropic/claude-opus-4.8:batch": {
    "intelligenceIndex": 41.8,
    "codingIndex": 74.3,
    "agenticIndex": 41.9
  },
  "qwen/qwen3.7-max": {
    "intelligenceIndex": 29.5,
    "codingIndex": 66,
    "agenticIndex": 22.5
  },
  "google/gemini-3.5-flash": {
    "intelligenceIndex": 32.6,
    "codingIndex": 70.1,
    "agenticIndex": 26
  },
  "google/gemini-3.5-flash:batch": {
    "intelligenceIndex": 32.6,
    "codingIndex": 70.1,
    "agenticIndex": 26
  },
  "x-ai/grok-4.3": {
    "intelligenceIndex": 24.9,
    "codingIndex": 42.2,
    "agenticIndex": 15.5
  },
  "x-ai/grok-4.3:batch": {
    "intelligenceIndex": 24.9,
    "codingIndex": 42.2,
    "agenticIndex": 15.5
  },
  "mistralai/mistral-medium-3-5": {
    "intelligenceIndex": 14.2,
    "codingIndex": 46.9,
    "agenticIndex": 7
  },
  "mistralai/mistral-medium-3-5:batch": {
    "intelligenceIndex": 14.2,
    "codingIndex": 46.9,
    "agenticIndex": 7
  },
  "qwen/qwen3.6-35b-a3b": {
    "intelligenceIndex": 18.2,
    "codingIndex": 41.9,
    "agenticIndex": 13.1
  },
  "qwen/qwen3.6-27b": {
    "intelligenceIndex": 21.4,
    "codingIndex": 53.7,
    "agenticIndex": 18.5
  },
  "openai/gpt-5.5": {
    "intelligenceIndex": 38.4,
    "codingIndex": 74.9,
    "agenticIndex": 36.4
  },
  "openai/gpt-5.5:batch": {
    "intelligenceIndex": 38.4,
    "codingIndex": 74.9,
    "agenticIndex": 36.4
  },
  "deepseek/deepseek-v4-pro": {
    "intelligenceIndex": 30.4,
    "codingIndex": 59.4,
    "agenticIndex": 26.3
  },
  "deepseek/deepseek-v4-flash": {
    "intelligenceIndex": 24.4,
    "codingIndex": 52,
    "agenticIndex": 26.3
  },
  "tencent/hy3-preview": {
    "intelligenceIndex": 25.3,
    "codingIndex": 58.8,
    "agenticIndex": 24.1
  },
  "xiaomi/mimo-v2.5-pro": {
    "intelligenceIndex": 26,
    "codingIndex": 60.2,
    "agenticIndex": 21.3
  },
  "moonshotai/kimi-k2.6": {
    "intelligenceIndex": 27,
    "codingIndex": 61.8,
    "agenticIndex": 20.5
  },
  "z-ai/glm-5.1": {
    "intelligenceIndex": 26.1,
    "codingIndex": 55.8,
    "agenticIndex": 23.9
  },
  "google/gemma-4-31b-it": {
    "intelligenceIndex": 14.7,
    "codingIndex": 43.4,
    "agenticIndex": 4.2
  },
  "google/gemma-4-31b-it:free": {
    "intelligenceIndex": 14.7,
    "codingIndex": 43.4,
    "agenticIndex": 4.2
  },
  "arcee-ai/trinity-large-thinking": {
    "intelligenceIndex": 10.8,
    "codingIndex": 25.8,
    "agenticIndex": 1
  },
  "minimax/minimax-m2.7": {
    "intelligenceIndex": 22.8,
    "codingIndex": 52.6,
    "agenticIndex": 15.3
  },
  "openai/gpt-5.4-nano": {
    "intelligenceIndex": 20.7,
    "codingIndex": 56.1,
    "agenticIndex": 16
  },
  "openai/gpt-5.4-nano:batch": {
    "intelligenceIndex": 20.7,
    "codingIndex": 56.1,
    "agenticIndex": 16
  },
  "openai/gpt-5.4-mini": {
    "intelligenceIndex": 24.1,
    "codingIndex": 56.1,
    "agenticIndex": 17.9
  },
  "openai/gpt-5.4-mini:batch": {
    "intelligenceIndex": 24.1,
    "codingIndex": 56.1,
    "agenticIndex": 17.9
  },
  "mistralai/mistral-small-2603": {
    "intelligenceIndex": 11.3,
    "codingIndex": 26.6,
    "agenticIndex": 0.8
  },
  "mistralai/mistral-small-2603:batch": {
    "intelligenceIndex": 11.3,
    "codingIndex": 26.6,
    "agenticIndex": 0.8
  },
  "nvidia/nemotron-3-super-120b-a12b": {
    "intelligenceIndex": 12.8,
    "codingIndex": 37.7,
    "agenticIndex": 1.7
  },
  "nvidia/nemotron-3-super-120b-a12b:free": {
    "intelligenceIndex": 12.8,
    "codingIndex": 37.7,
    "agenticIndex": 1.7
  },
  "qwen/qwen3.5-9b": {
    "intelligenceIndex": 11.2,
    "codingIndex": 28.7,
    "agenticIndex": 1.2
  },
  "google/gemini-3.1-flash-lite-preview": {
    "intelligenceIndex": 15.6,
    "codingIndex": 34.7,
    "agenticIndex": 1.6
  },
  "qwen/qwen3.5-122b-a10b": {
    "intelligenceIndex": 15.6,
    "codingIndex": 45.7,
    "agenticIndex": 7.6
  },
  "google/gemini-3.1-pro-preview": {
    "intelligenceIndex": 29.7,
    "codingIndex": 68.8,
    "agenticIndex": 8.2
  },
  "google/gemini-3.1-pro-preview:batch": {
    "intelligenceIndex": 29.7,
    "codingIndex": 68.8,
    "agenticIndex": 8.2
  },
  "anthropic/claude-sonnet-4.6": {
    "intelligenceIndex": 30.1,
    "codingIndex": 63,
    "agenticIndex": 31.8
  },
  "anthropic/claude-sonnet-4.6:batch": {
    "intelligenceIndex": 30.1,
    "codingIndex": 63,
    "agenticIndex": 31.8
  },
  "qwen/qwen3.5-397b-a17b": {
    "intelligenceIndex": 18.4,
    "codingIndex": 48.2,
    "agenticIndex": 8.3
  },
  "qwen/qwen3-coder-next": {
    "intelligenceIndex": 9.2,
    "codingIndex": 36.2,
    "agenticIndex": 0.9
  },
  "upstage/solar-pro-3": {
    "intelligenceIndex": 7.8,
    "codingIndex": 16.2,
    "agenticIndex": 1.4
  },
  "nvidia/nemotron-3-nano-30b-a3b": {
    "intelligenceIndex": 8.9,
    "codingIndex": 14.4,
    "agenticIndex": 1
  },
  "mistralai/devstral-2512": {
    "intelligenceIndex": 8.6,
    "codingIndex": 31.3,
    "agenticIndex": 2.3
  },
  "mistralai/ministral-14b-2512": {
    "intelligenceIndex": 6,
    "codingIndex": 14.4,
    "agenticIndex": 1.1
  },
  "mistralai/ministral-8b-2512": {
    "intelligenceIndex": 5.5,
    "codingIndex": 9.7,
    "agenticIndex": 0.6
  },
  "mistralai/ministral-8b-2512:batch": {
    "intelligenceIndex": 5.5,
    "codingIndex": 9.7,
    "agenticIndex": 0.6
  },
  "mistralai/ministral-3b-2512": {
    "intelligenceIndex": 4.8,
    "codingIndex": 4.8,
    "agenticIndex": 0.8
  },
  "mistralai/mistral-large-2512": {
    "intelligenceIndex": 9.3,
    "codingIndex": 20.1,
    "agenticIndex": 1
  },
  "mistralai/mistral-large-2512:batch": {
    "intelligenceIndex": 9.3,
    "codingIndex": 20.1,
    "agenticIndex": 1
  },
  "anthropic/claude-haiku-4.5": {
    "intelligenceIndex": 16.9,
    "codingIndex": 43.9,
    "agenticIndex": 8
  },
  "anthropic/claude-haiku-4.5:batch": {
    "intelligenceIndex": 16.9,
    "codingIndex": 43.9,
    "agenticIndex": 8
  },
  "anthropic/claude-sonnet-4.5": {
    "intelligenceIndex": 20.7,
    "codingIndex": 52.1,
    "agenticIndex": 15.8
  },
  "anthropic/claude-sonnet-4.5:batch": {
    "intelligenceIndex": 20.7,
    "codingIndex": 52.1,
    "agenticIndex": 15.8
  },
  "deepseek/deepseek-v3.1-terminus": {
    "intelligenceIndex": 14.8,
    "codingIndex": 43.5,
    "agenticIndex": 6.8
  },
  "qwen/qwen3-30b-a3b-thinking-2507": {
    "intelligenceIndex": 9.8,
    "codingIndex": 12.1,
    "agenticIndex": 0.9
  },
  "mistralai/mistral-medium-3.1": {
    "intelligenceIndex": 9.2,
    "codingIndex": 20.5,
    "agenticIndex": 1.9
  },
  "mistralai/mistral-medium-3.1:batch": {
    "intelligenceIndex": 9.2,
    "codingIndex": 20.5,
    "agenticIndex": 1.9
  },
  "openai/gpt-5-mini": {
    "intelligenceIndex": 16.8,
    "codingIndex": 15.6,
    "agenticIndex": 6.8
  },
  "openai/gpt-5-mini:batch": {
    "intelligenceIndex": 16.8,
    "codingIndex": 15.6,
    "agenticIndex": 6.8
  },
  "openai/gpt-oss-120b": {
    "intelligenceIndex": 11.6,
    "codingIndex": 30.4,
    "agenticIndex": 3.7
  },
  "openai/gpt-oss-120b:batch": {
    "intelligenceIndex": 11.6,
    "codingIndex": 30.4,
    "agenticIndex": 3.7
  },
  "openai/gpt-oss-20b": {
    "intelligenceIndex": 9,
    "codingIndex": 20.7,
    "agenticIndex": 1.2
  },
  "openai/gpt-oss-20b:batch": {
    "intelligenceIndex": 9,
    "codingIndex": 20.7,
    "agenticIndex": 1.2
  },
  "qwen/qwen3-235b-a22b-thinking-2507": {
    "intelligenceIndex": 12.7,
    "codingIndex": 22.1,
    "agenticIndex": 1.3
  },
  "google/gemini-2.5-pro": {
    "intelligenceIndex": 16.1,
    "codingIndex": 33.3,
    "agenticIndex": 1.6
  },
  "google/gemini-2.5-pro:batch": {
    "intelligenceIndex": 16.1,
    "codingIndex": 33.3,
    "agenticIndex": 1.6
  },
  "deepseek/deepseek-chat-v3-0324": {
    "intelligenceIndex": 9.7,
    "codingIndex": 21.2,
    "agenticIndex": 0.8
  },
  "google/gemma-3-12b-it": {
    "intelligenceIndex": 3.8,
    "codingIndex": 5.8,
    "agenticIndex": 0.1
  },
  "cohere/command-a": {
    "intelligenceIndex": 13.1,
    "codingIndex": 27.8,
    "agenticIndex": 1
  },
  "google/gemma-3-27b-it": {
    "intelligenceIndex": 4.9,
    "codingIndex": 10.1,
    "agenticIndex": 0.1
  },
  "openai/o3-mini-high": {
    "intelligenceIndex": 11,
    "codingIndex": 16.3,
    "agenticIndex": 0.9
  },
  "deepseek/deepseek-r1": {
    "intelligenceIndex": 11.4,
    "codingIndex": 24.6,
    "agenticIndex": 1.1
  }
};
