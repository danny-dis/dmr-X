import * as React from 'react';
import { usePlaygroundStore } from '@/store/usePlaygroundStore';
import { PlaygroundSidebar } from './PlaygroundSidebar';
import { PlaygroundMain } from './PlaygroundMain';
import { PlaygroundInput } from './PlaygroundInput';
import { Button } from '@/components/primitives/Button';
import { PanelLeftClose, PanelLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PlaygroundPage() {
  const { showSidebar, setShowSidebar } = usePlaygroundStore();
  
  return (
    <div className="h-[calc(100dvh-64px)] flex bg-surface-1">
      {/* Sidebar Toggle */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setShowSidebar(!showSidebar)}
        className={cn(
          "fixed top-20 z-10 transition-all",
          showSidebar ? "left-[260px]" : "left-4"
        )}
      >
        {showSidebar ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
      </Button>
      
      {/* Sidebar */}
      <PlaygroundSidebar />
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <PlaygroundMain />
        <PlaygroundInput />
      </div>
    </div>
  );
}