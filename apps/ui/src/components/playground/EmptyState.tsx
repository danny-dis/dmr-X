import { MessageSquare, Image, Volume2, ArrowUpDown, Zap, ShieldAlert, Cpu, Workflow, Sparkles } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/primitives/Button';
import { usePlaygroundStore, PlaygroundMode } from '@/store/usePlaygroundStore';

interface SamplePrompt {
  mode: PlaygroundMode;
  icon: typeof MessageSquare;
  title: string;
  prompt: string;
}

const samplePrompts: SamplePrompt[] = [
  {
    mode: 'chat',
    icon: MessageSquare,
    title: 'Explain quantum entanglement',
    prompt: 'Explain quantum entanglement in simple terms.',
  },
  {
    mode: 'chat',
    icon: MessageSquare,
    title: 'Write a TypeScript function',
    prompt: 'Write a TypeScript function that debounces a function call.',
  },
  {
    mode: 'chat',
    icon: MessageSquare,
    title: 'Create a haiku',
    prompt: 'Write a haiku about a lonely satellite.',
  },
  {
    mode: 'image',
    icon: Image,
    title: 'Generate a cyberpunk image',
    prompt: 'A futuristic Tokyo street at night, neon signs, rainy reflections, cinematic lighting, 8k',
  },
  {
    mode: 'tts',
    icon: Volume2,
    title: 'Generate speech',
    prompt: 'Hello and welcome to the DMR-X universal AI gateway.',
  },
  {
    mode: 'embed',
    icon: ArrowUpDown,
    title: 'Embed text',
    prompt: 'The quick brown fox jumps over the lazy dog.',
  },
  {
    mode: 'rerank',
    icon: Zap,
    title: 'Rerank documents',
    prompt: 'Rank these documents by relevance to machine learning.',
  },
  {
    mode: 'moderate',
    icon: ShieldAlert,
    title: 'Check content safety',
    prompt: 'Is this content appropriate for all audiences?',
  },
  {
    mode: 'agentic',
    icon: Cpu,
    title: 'Start an agentic task',
    prompt: 'Research the latest developments in quantum computing and summarize the top 3 breakthroughs.',
  },
  {
    mode: 'tool-loop',
    icon: Workflow,
    title: 'Run a tool loop',
    prompt: 'Use the available tools to solve this problem step by step.',
  },
];

const MODE_CONFIG: Record<PlaygroundMode, { icon: typeof MessageSquare; title: string; description: string }> = {
  chat: { icon: MessageSquare, title: 'Start a conversation', description: 'Send a message to get started. Your conversations are saved automatically.' },
  image: { icon: Image, title: 'Generate an image', description: 'Describe what you want to create and let the AI generate it.' },
  embed: { icon: ArrowUpDown, title: 'Create embeddings', description: 'Convert text into vector representations for semantic search.' },
  tts: { icon: Volume2, title: 'Convert text to speech', description: 'Enter text and hear it spoken in a natural voice.' },
  rerank: { icon: Zap, title: 'Rerank documents', description: 'Score and reorder documents by relevance to a query.' },
  moderate: { icon: ShieldAlert, title: 'Check content safety', description: 'Analyze text for policy violations and safety concerns.' },
  agentic: { icon: Cpu, title: 'Run an agentic task', description: 'Let the AI plan and execute multi-step tasks autonomously.' },
  'tool-loop': { icon: Workflow, title: 'Execute a tool loop', description: 'Run iterative tool-calling workflows to accomplish complex goals.' },
  godmode: { icon: Sparkles, title: 'Run a G0DM0D3 pipeline', description: 'Multi-model chat with ULTRAPLINIAN / CONSORTIUM and prompt-obfuscation pipelines.' },
};

// Defensive fallback: if a PlaygroundMode is ever added to the type but
// forgotten here, MODE_CONFIG[mode] would be undefined and the old code
// threw "Cannot read properties of undefined (reading 'icon')", white-screening
// the whole Playground. Fall back instead of crashing.
const MODE_CONFIG_FALLBACK: { icon: typeof MessageSquare; title: string; description: string } = {
  icon: MessageSquare,
  title: 'Start a conversation',
  description: 'Send a message to get started.',
};

function getModeConfig(mode: PlaygroundMode) {
  const config = MODE_CONFIG[mode];
  if (!config) {
    if (import.meta.env.DEV) {
      console.error(`[EmptyState] No MODE_CONFIG entry for mode "${mode}" — using fallback.`);
    }
    return MODE_CONFIG_FALLBACK;
  }
  return config;
}

function EmptyStateComponent() {
  const mode = usePlaygroundStore(s => s.mode);
  const setPromptSeed = usePlaygroundStore(s => s.setPromptSeed);

  const config = getModeConfig(mode);
  const Icon = config.icon;

  // Clicking a sample-prompt tile seeds the prompt input via the store.
  const handleSampleClick = (sample: SamplePrompt) => {
    setPromptSeed(sample.prompt);
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 sm:p-10">
      <div className="w-full max-w-2xl text-center">
        <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-xl border border-border bg-surface-1 shadow-sm">
          <Icon className="size-8 text-fg-muted" />
        </div>

        <h3 className="mb-2 text-xl font-semibold text-fg">
          {config.title}
        </h3>

        <p className="mx-auto mb-6 max-w-md text-sm text-fg-muted">
          {config.description}
        </p>

        <div className="mb-6 grid gap-2 sm:grid-cols-2">
          {samplePrompts
            .filter(p => p.mode === mode)
            .map((sample, i) => (
              <Button
                key={i}
                variant="outline"
                size="sm"
                className="h-auto justify-start rounded-lg border-border bg-surface-1 px-3 py-3 text-left shadow-sm hover:border-primary/30"
                onClick={() => handleSampleClick(sample)}
              >
                <sample.icon className="size-4 mr-2 shrink-0" />
                <span className="text-left">{sample.title}</span>
              </Button>
            ))}
        </div>

        <div className="text-xs text-fg-subtle">
          Press <kbd className="rounded bg-surface-2 px-1 py-0.5">Enter</kbd> to send
        </div>
      </div>
    </div>
  );
}

export const EmptyState = React.memo(EmptyStateComponent);
