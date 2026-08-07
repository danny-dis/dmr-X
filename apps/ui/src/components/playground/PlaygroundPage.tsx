import { Bot, Boxes, Gauge, PanelLeftClose, PanelLeft, Radio } from 'lucide-react';
import * as React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { PlaygroundInput } from './PlaygroundInput';
import { PlaygroundMain } from './PlaygroundMain';
import { PlaygroundSidebar } from './PlaygroundSidebar';
import { PlaygroundTabs } from './PlaygroundTabs';

import { Button } from '@/components/primitives/Button';
import { cn } from '@/lib/utils';
import { isPlaygroundMode, usePlaygroundStore } from '@/store/usePlaygroundStore';

// Non-chat tab views. Only the tabs listed in TOP_LEVEL_TABS are reachable —
// keep this list and that one in sync when adding a new view.
import { CompletionsView } from './CompletionsView';
import { ImagesView } from './ImagesView';
import { VideoView } from './VideoView';

// activeTab is persisted, so a tab id left over from an older build (audio,
// tools, platform, godmode) can still come back from localStorage. Anything
// that isn't a known non-chat view falls back to Chat instead of a blank pane.
const NON_CHAT_TABS = new Set(['completions', 'images', 'video']);

export function PlaygroundPage() {
  const navigate = useNavigate();
  const { mode: modeParam } = useParams<{ mode: string }>();
  const [searchParams] = useSearchParams();

  const showSidebar = usePlaygroundStore(s => s.showSidebar);
  const setShowSidebar = usePlaygroundStore(s => s.setShowSidebar);
  const model = usePlaygroundStore(s => s.model);
  const mode = usePlaygroundStore(s => s.mode);
  const setMode = usePlaygroundStore(s => s.setMode);
  const setAgentInstanceId = usePlaygroundStore(s => s.setAgentInstanceId);
  const messages = usePlaygroundStore(s => s.messages);
  const isStreaming = usePlaygroundStore(s => s.isStreaming);
  const activeTab = usePlaygroundStore(s => s.activeTab);

  // Mode lives in the URL (`/playground/:mode`) so a conversation in
  // agent/godmode/agentic can be linked to directly — this is the one place
  // that reads the route param and syncs it into the store. An invalid
  // segment (old bookmark, typo) redirects to chat instead of leaving the
  // page on a mode nothing else recognizes.
  React.useEffect(() => {
    if (!modeParam) return;
    if (isPlaygroundMode(modeParam)) {
      if (modeParam !== mode) setMode(modeParam);
    } else {
      navigate('/playground/chat', { replace: true });
    }
    // Only the route param should retrigger this — `mode` is read for the
    // no-op check, not to resubscribe the effect to every store change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeParam]);

  // AgentsPage links here as `/playground/agent?instance=<id>` (its "Chat"
  // button) — adopt that as the initial instance selection.
  React.useEffect(() => {
    const instanceParam = searchParams.get('instance');
    if (instanceParam) setAgentInstanceId(instanceParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // `currentConversationId` now survives a reload (see usePlaygroundStore's
  // partialize), but the message transcript deliberately does not — refetch
  // it from the server once on mount so the restored id actually comes back
  // with its history instead of showing an empty thread under a stale id.
  React.useEffect(() => {
    const id = usePlaygroundStore.getState().currentConversationId;
    if (!id) return;
    usePlaygroundStore.getState().loadConversation(id).catch(() => {
      // Conversation may be gone server-side (e.g. deleted, or a
      // temporary session that was never persisted) — drop the dangling
      // id instead of leaving the UI pointed at a dead conversation.
      usePlaygroundStore.setState({ currentConversationId: null, messages: [] });
    });
    // Intentionally run once per mount — this reads the persisted id as a
    // one-time restore, not a reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            {!NON_CHAT_TABS.has(activeTab) && (
              <>
                <PlaygroundMain />
                <PlaygroundInput />
              </>
            )}
            {activeTab === 'completions' && <CompletionsView />}
            {activeTab === 'images' && <ImagesView />}
            {activeTab === 'video' && <VideoView />}
          </div>
        </section>
      </div>
    </div>
  );
}
