import * as React from 'react';
import { usePlaygroundStore, PlaygroundMode } from '@/store/usePlaygroundStore';
import { Button } from '@/components/primitives/Button';
import { MessageSquare, Image, Volume2, ArrowUpDown, Zap, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

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
];

export function EmptyState() {
  const { setMode, mode, setPromptSeed } = usePlaygroundStore();

  // Clicking a sample-prompt tile seeds the prompt input via the store.
  // PlaygroundInput watches `pendingPrompt` and applies it to its local
  // textarea (focusing it) so the user can press Enter to send.
  const handleSampleClick = (sample: SamplePrompt) => {
    if (sample.mode !== mode) {
      setMode(sample.mode);
    }
    setPromptSeed(sample.prompt);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-12">
      <div className="text-center max-w-md">
        <div className="size-16 rounded-3xl bg-surface-2 flex items-center justify-center mx-auto mb-4">
          <MessageSquare className="size-8 text-fg-muted" />
        </div>

        <h3 className="text-lg font-semibold text-fg mb-2">
          Start a conversation
        </h3>

        <p className="text-sm text-fg-muted mb-6">
          Choose a mode and send a message to get started. Your conversations will be saved automatically.
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