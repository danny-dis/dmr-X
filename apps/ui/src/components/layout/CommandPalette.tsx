import { useNavigate } from 'react-router-dom';
import { useStore } from '@/store/useStore';
import { useState, useEffect, useRef } from 'react';
import { Search, Command } from 'lucide-react';


const commands = [
  { id: 'overview', label: 'Go to Overview', category: 'Navigation', shortcut: 'G O', path: '/' },
  { id: 'routing', label: 'Go to Routing Console', category: 'Navigation', shortcut: 'G R', path: '/routing' },
  { id: 'models', label: 'Go to Model Catalog', category: 'Navigation', shortcut: 'G M', path: '/models' },
  { id: 'providers', label: 'Go to Provider Registry', category: 'Navigation', shortcut: 'G P', path: '/providers' },
  { id: 'quota', label: 'Go to Quota Manager', category: 'Navigation', shortcut: 'G Q', path: '/quota' },
  { id: 'billing', label: 'Go to Billing Center', category: 'Navigation', shortcut: 'G B', path: '/billing' },
  { id: 'memory', label: 'Go to Memory Center', category: 'Navigation', shortcut: 'G E', path: '/memory' },
  { id: 'benchmarks', label: 'Go to Benchmark Lab', category: 'Navigation', shortcut: 'G L', path: '/benchmarks' },
  { id: 'telemetry', label: 'Go to Telemetry', category: 'Navigation', shortcut: 'G T', path: '/telemetry' },
  { id: 'federation', label: 'Go to Federation', category: 'Navigation', shortcut: 'G F', path: '/federation' },
  { id: 'sandbox', label: 'Go to Sandbox', category: 'Navigation', shortcut: 'G S', path: '/sandbox' },
  { id: 'scheduler', label: 'Go to Scheduler', category: 'Navigation', shortcut: 'G W', path: '/scheduler' },
  { id: 'policies', label: 'Go to Policy Engine', category: 'Navigation', shortcut: 'G C', path: '/policies' },
  { id: 'tenants', label: 'Go to Tenants', category: 'Navigation', shortcut: 'G U', path: '/tenants' },
  { id: 'audit', label: 'Go to Audit Logs', category: 'Navigation', shortcut: 'G A', path: '/audit' },
  { id: 'alerts', label: 'Go to Alerts', category: 'Navigation', shortcut: 'G N', path: '/alerts' },
  { id: 'playground', label: 'Go to Playground', category: 'Navigation', shortcut: 'G Y', path: '/playground' },
  { id: 'free-tier', label: 'Go to Free Tier', category: 'Navigation', shortcut: 'G D', path: '/free-tier' },
  { id: 'settings', label: 'Go to Settings', category: 'Navigation', shortcut: 'G G', path: '/settings' },
  { id: 'create-key', label: 'Create new API Key', category: 'Action', shortcut: '', path: '/keys' },
  { id: 'add-model', label: 'Add Model Provider', category: 'Action', shortcut: '', path: '/providers' },
  { id: 'view-logs', label: 'View System Logs', category: 'Action', shortcut: '', path: '/audit' },
  { id: 'export-usage', label: 'Export Usage Report', category: 'Action', shortcut: '', path: '/billing' },
];

export default function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen, setCurrentPage } = useStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = commands.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()) ||
    c.category.toLowerCase().includes(query.toLowerCase())
  );

  const grouped = filtered.reduce(
    (acc, cmd) => {
      if (!acc[cmd.category]) acc[cmd.category] = [];
      acc[cmd.category].push(cmd);
      return acc;
    },
    {} as Record<string, typeof commands>
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setCommandPaletteOpen]);

  useEffect(() => {
    if (commandPaletteOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [commandPaletteOpen]);

  const handleSelect = (cmd: (typeof commands)[0]) => {
    setCurrentPage(cmd.id);
    navigate(cmd.path);
    setCommandPaletteOpen(false);
  };

  if (!commandPaletteOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      onClick={() => setCommandPaletteOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-[640px] bg-[#0F0F12] border border-[#27272E] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'slideUpBlur 0.2s ease-out forwards' }}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#27272E]">
          <Search className="w-4 h-4 text-[#595962]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-sm text-[#F8F9FC] placeholder-[#595962] outline-none"
          />
          <kbd className="text-[10px] bg-[#1A1A20] px-1.5 py-0.5 rounded border border-[#27272E] text-[#595962] font-mono-data">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto py-2">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <div className="px-4 py-1.5 text-[10px] font-semibold text-[#595962] uppercase tracking-wider">
                {category}
              </div>
              {items.map((cmd) => (
                <button
                  key={cmd.id}
                  onClick={() => handleSelect(cmd)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-[#A6A6B0] hover:bg-[#1A1A20] hover:text-[#F8F9FC] transition-colors"
                >
                  <span>{cmd.label}</span>
                  {cmd.shortcut && (
                    <div className="flex items-center gap-0.5">
                      {cmd.shortcut.split(' ').map((key, i) => (
                        <kbd
                          key={i}
                          className="text-[10px] bg-[#1A1A20] px-1.5 py-0.5 rounded border border-[#27272E] text-[#595962] font-mono-data"
                        >
                          {key === '?' ? <Command className="w-2.5 h-2.5 inline" /> : key}
                        </kbd>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-[#595962]">
              No commands found for &quot;{query}&quot;
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-[#27272E] flex items-center gap-4 text-[10px] text-[#595962]">
          <span>Select <kbd className="px-1 py-0.5 bg-[#1A1A20] rounded border border-[#27272E]">↵</kbd></span>
          <span>Navigate <kbd className="px-1 py-0.5 bg-[#1A1A20] rounded border border-[#27272E]">↑↓</kbd></span>
          <span>Close <kbd className="px-1 py-0.5 bg-[#1A1A20] rounded border border-[#27272E]">esc</kbd></span>
        </div>
      </div>
    </div>
  );
}
