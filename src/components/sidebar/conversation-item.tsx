'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  MessageSquare,
  MoreHorizontal,
  Pin,
  Archive,
  Trash2,
  Edit2,
  Share2,
  Check,
  X,
} from 'lucide-react';
import { Conversation } from '@/types/chat';
import { useChatStore } from '@/stores/chat-store';
import { useUIStore } from '@/stores/ui-store';

interface ConversationItemProps {
  conversation: Conversation;
}

export const ConversationItem: React.FC<ConversationItemProps> = ({ conversation }) => {
  const {
    activeConversationId,
    selectConversation,
    renameConversation,
    pinConversation,
    archiveConversation,
    deleteConversation,
  } = useChatStore();

  const { setSidebarOpen, addToast } = useUIStore();

  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [titleInput, setTitleInput] = useState(conversation.title);
  const menuRef = useRef<HTMLDivElement>(null);

  const isActive = activeConversationId === conversation.id;

  // Close context menu on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  const handleSelect = () => {
    if (!isRenaming) {
      selectConversation(conversation.id);
      // On mobile screens, auto-close drawer
      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      }
    }
  };

  const handleRenameSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (titleInput.trim() && titleInput.trim() !== conversation.title) {
      await renameConversation(conversation.id, titleInput.trim());
    }
    setIsRenaming(false);
  };

  const handleExport = async (format: 'markdown' | 'json') => {
    setMenuOpen(false);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${conversation.title}.${format === 'markdown' ? 'md' : format}`;
      a.click();
      URL.revokeObjectURL(url);
      addToast(`Exported ${format.toUpperCase()}`, 'success');
    } catch (e) {
      addToast('Export failed', 'error');
    }
  };

  return (
    <div
      className={`group relative flex items-center justify-between rounded-xl px-3 py-2.5 sm:py-2 text-xs font-medium transition-colors cursor-pointer min-h-[40px] ${
        isActive
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      }`}
      onClick={handleSelect}
    >
      {/* Icon & Title */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-1">
        {conversation.pinned ? (
          <Pin className="w-3.5 h-3.5 text-primary shrink-0 rotate-45" />
        ) : (
          <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-70" />
        )}

        {isRenaming ? (
          <form
            onSubmit={handleRenameSubmit}
            className="flex items-center gap-1 w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              autoFocus
              className="w-full bg-background border border-primary px-2 py-1 rounded text-xs text-foreground focus:outline-none"
            />
            <button
              type="submit"
              className="p-1 text-emerald-500 hover:text-emerald-400 touch-manipulation"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIsRenaming(false)}
              className="p-1 text-muted-foreground hover:text-foreground touch-manipulation"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : (
          <span className="truncate">{conversation.title || 'Untitled'}</span>
        )}
      </div>

      {/* Context Menu Button */}
      {!isRenaming && (
        <div className="relative shrink-0" ref={menuRef} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className={`p-1.5 sm:p-1 rounded-md hover:bg-muted-foreground/10 text-muted-foreground hover:text-foreground transition-opacity touch-manipulation ${
              isActive || menuOpen ? 'opacity-100' : 'opacity-70 sm:opacity-0 sm:group-hover:opacity-100'
            }`}
            title="Options"
            aria-label="Conversation options"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>

          {/* Dropdown Options */}
          {menuOpen && (
            <div className="absolute right-0 top-6 w-36 rounded-lg border border-border bg-card shadow-lg py-1 z-30 animate-fade-in text-xs">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setIsRenaming(true);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2 text-foreground"
              >
                <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Rename</span>
              </button>

              <button
                onClick={() => {
                  setMenuOpen(false);
                  pinConversation(conversation.id, !conversation.pinned);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2 text-foreground"
              >
                <Pin className="w-3.5 h-3.5 text-muted-foreground" />
                <span>{conversation.pinned ? 'Unpin' : 'Pin'}</span>
              </button>

              <button
                onClick={() => {
                  setMenuOpen(false);
                  archiveConversation(conversation.id, !conversation.archived);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2 text-foreground"
              >
                <Archive className="w-3.5 h-3.5 text-muted-foreground" />
                <span>{conversation.archived ? 'Unarchive' : 'Archive'}</span>
              </button>

              <button
                onClick={() => handleExport('markdown')}
                className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2 text-foreground"
              >
                <Share2 className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Export MD</span>
              </button>

              <div className="border-t border-border/50 my-1" />

              <button
                onClick={() => {
                  setMenuOpen(false);
                  deleteConversation(conversation.id);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-destructive/10 text-destructive flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
