import { Bot, Boxes, Gauge, PanelLeftClose, PanelLeft, Radio } from 'lucide-react';
import * as React from 'react';

import { PlaygroundInput } from './PlaygroundInput';
import { PlaygroundMain } from './PlaygroundMain';
import { PlaygroundSidebar } from './PlaygroundSidebar';
import { PlaygroundTabs } from './PlaygroundTabs';

import { Button } from '@/components/primitives/Button';
import { cn } from '@/lib/utils';
import { usePlaygroundStore } from '@/store/usePlaygroundStore';

// Lazy-load the heavy views so the initial Chat tab loads fast
import { CompletionsView } from './CompletionsView';
import { ImagesView } from './ImagesView';
import { AudioHub } from './audio/AudioHub';
import { VideoView } from './VideoView';
import { ToolsHub } from './tools/ToolsHub';
import { PlatformHub } from './platform/PlatformHub';
import { GodmodeHub } from './godmode/GodmodeHub';

export function PlaygroundPage() {
  const showSidebar = usePlaygroundStore(s => s.showSidebar);
  const setShowSidebar = usePlaygroundStore(s => s.setShowSidebar);
  const model = usePlaygroundStore(s => s.model);
  const messages = usePlaygroundStore(s => s.messages);
  const isStreaming = usePlaygroundStore(s => s.isStreaming);
  const activeTab = usePlaygroundStore(s => s.activeTab);

  return (
    <div className="h-[calc(100dvh-64px)] overflow-hidden bg-bg">
      <div className="flex h-full min-h-0">
        <PlaygroundSidebar />

        <section className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <header className="shrink-0 border-b border-border bg-surface-1/95 px-4 py-3 shadow-sm backdrop-blur sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowSidebar(!showSidebar)}
                  aria-label={showSidebar ? 'Hide conversations' : 'Show conversations'}
                  title={showSidebar ? 'Hide conversations' : 'Show conversations'}
                  className="shrink-0"
                >
                  {showSidebar ? <PanelLeftClose /> : <PanelLeft />}
                </Button>

                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-primary shadow-sm">
                  <Bot className="size-5" />
                </div>

                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold text-fg">Playground</h1>
                  <p className="truncate text-xs text-fg-muted">{model}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-fg-muted">
                <div className="hidden items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 sm:flex">
                  <Boxes className="size-3.5 text-accent" />
                  {messages.length} messages
                </div>
                <div className="hidden items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 sm:flex">
                  <Gauge className="size-3.5 text-warning" />
                  Router ready
                </div>
                <div
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2 py-1',
                    isStreaming
                      ? 'border-success/30 bg-success/10 text-success'
                      : 'border-border bg-surface-2'
                  )}
                >
                  <Radio className={cn('size-3.5', isStreaming && 'animate-pulse')} />
                  {isStreaming ? 'Streaming' : 'Idle'}
                </div>
              </div>
            </div>
          </header>

          {/* Top-level tab bar */}
          <PlaygroundTabs />

          {/* Tab content */}
          <div className="flex min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.08),transparent_26rem),linear-gradient(180deg,var(--surface),var(--bg))]">
            {activeTab === 'chat' && (
              <>
                <PlaygroundMain />
                <PlaygroundInput />
              </>
            )}
            {activeTab === 'completions' && <CompletionsView />}
            {activeTab === 'images' && <ImagesView />}
            {activeTab === 'audio' && <AudioHub />}
            {activeTab === 'video' && <VideoView />}
            {activeTab === 'tools' && <ToolsHub />}
            {activeTab === 'platform' && <PlatformHub />}
            {activeTab === 'godmode' && <GodmodeHub />}
          </div>
        </section>
      </div>
    </div>
  );
}
