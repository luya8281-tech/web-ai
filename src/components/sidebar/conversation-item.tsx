'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  MoreHorizontal,
  Pin,
  Archive,
  Trash2,
  Edit2,
  Download,
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
      addToast(`Diekspor ke ${format.toUpperCase()}`, 'success');
    } catch {
      addToast('Gagal mengekspor percakapan', 'error');
    }
  };

  return (
    <div
      className={`group relative flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors cursor-pointer min-h-[34px] ${
        isActive
          ? 'bg-sidebar-accent text-sidebar-foreground font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary'
          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground font-normal'
      }`}
      onClick={handleSelect}
    >
      {/* Title & Optional Pin Indicator */}
      <div className="flex items-center gap-2 min-w-0 flex-1 mr-1">
        {conversation.pinned && (
          <Pin className="w-3 h-3 text-primary shrink-0 rotate-45" />
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
              className="w-full bg-background border border-primary px-2 py-0.5 rounded text-xs text-foreground focus:outline-none"
            />
            <button
              type="submit"
              className="p-1 text-emerald-600 dark:text-emerald-400 touch-manipulation"
              aria-label="Simpan judul"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIsRenaming(false)}
              className="p-1 text-muted-foreground hover:text-foreground touch-manipulation"
              aria-label="Batal"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : (
          <span className="truncate leading-snug">{conversation.title || 'Tanpa Judul'}</span>
        )}
      </div>

      {/* Context Menu Button */}
      {!isRenaming && (
        <div className="relative shrink-0" ref={menuRef} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className={`p-1 rounded-md hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-opacity touch-manipulation ${
              isActive || menuOpen ? 'opacity-100' : 'opacity-60 sm:opacity-0 sm:group-hover:opacity-100'
            }`}
            title="Opsi percakapan"
            aria-label="Opsi percakapan"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-6 w-40 rounded-lg border border-border bg-card shadow-lg py-1 z-30 animate-fade-in text-xs font-normal">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setIsRenaming(true);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2 text-foreground"
              >
                <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Ubah Judul</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  pinConversation(conversation.id, !conversation.pinned);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2 text-foreground"
              >
                <Pin className="w-3.5 h-3.5 text-muted-foreground" />
                <span>{conversation.pinned ? 'Lepas Sematan' : 'Sematkan'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  archiveConversation(conversation.id, !conversation.archived);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2 text-foreground"
              >
                <Archive className="w-3.5 h-3.5 text-muted-foreground" />
                <span>{conversation.archived ? 'Keluarkan Arsip' : 'Arsipkan'}</span>
              </button>

              <button
                type="button"
                onClick={() => handleExport('markdown')}
                className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2 text-foreground"
              >
                <Download className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Unduh .md</span>
              </button>

              <div className="border-t border-border/50 my-1" />

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  deleteConversation(conversation.id);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-destructive/10 text-destructive flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
