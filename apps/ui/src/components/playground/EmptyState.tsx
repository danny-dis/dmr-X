import { MessageSquare, Image, Volume2, ArrowUpDown, Zap, ShieldAlert, Cpu, Workflow } from 'lucide-react';
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
};

function EmptyStateComponent() {
  const mode = usePlaygroundStore(s => s.mode);
  const setPromptSeed = usePlaygroundStore(s => s.setPromptSeed);

  const config = MODE_CONFIG[mode];
  const Icon = config.icon;

  // Clicking a sample-prompt tile seeds the prompt input via the store.
  const handleSampleClick = (sample: SamplePrompt) => {
    setPromptSeed(sample.prompt);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-12">
      <div className="text-center max-w-md">
        <div className="size-16 rounded-3xl bg-surface-2 flex items-center justify-center mx-auto mb-4">
          <Icon className="size-8 text-fg-muted" />
        </div>

        <h3 className="text-lg font-semibold text-fg mb-2">
          {config.title}
        </h3>

        <p className="text-sm text-fg-muted mb-6">
          {config.description}
        </p>

        <div className="grid grid-cols-2 gap-2 mb-6">
          {samplePrompts
            .filter(p => p.mode === mode)
            .map((sample, i) => (
              <Button
                key={i}
                variant="outline"
                size="sm"
                className="justify-start h-auto py-3"
                onClick={() => handleSampleClick(sample)}
              >
                <sample.icon className="size-4 mr-2 shrink-0" />
                <span className="text-left">{sample.title}</span>
              </Button>
            ))}
        </div>

        <div className="text-xs text-fg-subtle">
          Press <kbd className="px-1 py-0.5 bg-surface-2 rounded">Enter</kbd> to send
        </div>
      </div>
    </div>
  );
}

export const EmptyState = React.memo(EmptyStateComponent);
