import { formatDistanceToNow } from 'date-fns';
import { MoreHorizontal, Trash2, Edit, MessageSquare, Image, Volume2, ArrowUpDown, Zap, ShieldAlert } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/lib/utils';
import { usePlaygroundStore } from '@/store/usePlaygroundStore';


interface ConversationItemProps {
  conversation: any;
  isActive: boolean;
  onClick: () => void;
}

const modeIcons = {
  chat: MessageSquare,
  image: Image,
  embed: ArrowUpDown,
  tts: Volume2,
  rerank: Zap,
  moderate: ShieldAlert,
};

function ConversationItemComponent({ conversation, isActive, onClick }: ConversationItemProps) {
  const { deleteConversation, renameConversation } = usePlaygroundStore();
  const [showMenu, setShowMenu] = React.useState(false);
  // Inline-edit state for Rename. When `isEditing` is true the title text
  // is replaced with an input that commits on Enter/blur and cancels on
  // Escape. Keeps the existing click-to-open-conversation flow working
  // (we stopPropagation on the input's mousedown).
  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(conversation.title || '');
  const editInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (isEditing) {
      // Select the existing title on entry so the user can type to replace
      // or place the cursor to amend.
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [isEditing]);

  const startRename = () => {
    setEditValue(conversation.title || '');
    setIsEditing(true);
    setShowMenu(false);
  };

  const commitRename = () => {
    const next = editValue.trim();
    setIsEditing(false);
    if (next && next !== conversation.title) {
      renameConversation(conversation.id, next);
    }
  };

  const cancelRename = () => {
    setIsEditing(false);
    setEditValue(conversation.title || '');
  };

  const ModeIcon = modeIcons[conversation.mode as keyof typeof modeIcons] || MessageSquare;

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors",
        isActive
          ? "bg-primary/10 border border-primary/20"
          : "hover:bg-surface-3 border border-transparent"
      )}
      onClick={isEditing ? undefined : onClick}
    >
      <ModeIcon className="size-4 text-fg-muted shrink-0" />

      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            ref={editInputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
              }
            }}
            className="w-full text-sm font-medium bg-surface-2 border border-primary/40 rounded px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-primary/20"
            aria-label="Rename conversation"
          />
        ) : (
          <>
            <div className="text-sm font-medium truncate">
              {conversation.title || 'New Conversation'}
            </div>
            <div className="text-xs text-fg-muted truncate">
              {conversation.model || 'auto'}{conversation.updatedAt ? ` • ${formatDistanceToNow(new Date(conversation.updatedAt), { addSuffix: true })}` : ''}
            </div>
          </>
        )}
      </div>

      {conversation.isTemporary && !isEditing ? (
        <Badge variant="outline" size="sm">
          Temp
        </Badge>
      ) : null}

      {/* Actions */}
      {!isEditing && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
          >
            <MoreHorizontal className="size-3" />
          </Button>
        </div>
      )}

      {/* Dropdown Menu */}
      {showMenu && !isEditing && (
        <div className="absolute right-0 top-full mt-1 w-32 bg-surface-1 border border-border rounded-lg shadow-lg z-50">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={(e) => {
              e.stopPropagation();
              startRename();
            }}
          >
            <Edit className="size-3 mr-2" />
            Rename
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              deleteConversation(conversation.id);
              setShowMenu(false);
            }}
          >
            <Trash2 className="size-3 mr-2" />
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}

export const ConversationItem = React.memo(ConversationItemComponent);