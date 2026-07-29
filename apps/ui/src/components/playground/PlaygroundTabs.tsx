import {
  MessageSquare,
  FileText,
  Image as ImageIcon,
  Video,
  type LucideIcon,
} from 'lucide-react';

import { Tabs, TabsList, TabsTrigger } from '@/components/primitives';
import { usePlaygroundStore } from '@/store/usePlaygroundStore';

export interface TopLevelTab {
  id: string;
  label: string;
  icon: LucideIcon;
}

// Only tabs with a view rendered by PlaygroundPage belong here. The Audio,
// Tools, Platform and Godmode hubs were referenced but never written, so those
// tabs are omitted until their views exist rather than rendering blank panes.
export const TOP_LEVEL_TABS: TopLevelTab[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'completions', label: 'Completions', icon: FileText },
  { id: 'images', label: 'Images', icon: ImageIcon },
  { id: 'video', label: 'Video', icon: Video },
];

export function PlaygroundTabs() {
  const activeTab = usePlaygroundStore(s => s.activeTab);
  const setActiveTab = usePlaygroundStore(s => s.setActiveTab);

  return (
    <div className="shrink-0 border-b border-border bg-surface-1/95 backdrop-blur">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v)}
      >
        <TabsList variant="pills" className="flex w-full gap-1 overflow-x-auto rounded-none border-b border-transparent p-1.5">
          {TOP_LEVEL_TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-sm"
            >
              <tab.icon className="size-3.5" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
