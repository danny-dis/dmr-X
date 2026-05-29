import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import CommandPalette from './CommandPalette';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { sidebarCollapsed } = useStore();

  return (
    <div className="min-h-screen bg-[#060608]">
      <Sidebar />
      <Topbar />
      <CommandPalette />

      {/* Main Content */}
      <main
        className={cn(
          'pt-14 min-h-screen transition-all duration-300',
          sidebarCollapsed ? 'pl-[80px]' : 'pl-[260px]'
        )}
      >
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
