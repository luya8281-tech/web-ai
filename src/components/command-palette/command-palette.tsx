'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Plus,
  Sparkles,
  Settings,
  Sun,
  Moon,
  Download,
  Trash2,
  X,
  MessageSquare,
} from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useUIStore } from '@/stores/ui-store';

export const CommandPalette: React.FC = () => {
  const {
    conversations,
    activeConversation,
    newChat,
    selectConversation,
    deleteConversation,
  } = useChatStore();

  const { settings, updateSettings } = useSettingsStore();
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    setModelSelectorOpen,
    setSettingsOpen,
    addToast,
  } = useUIStore();

  const [query, setQuery] = useState('');

  // Global key listener for Ctrl/Cmd+K and Ctrl/Cmd+Shift+O
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        newChat();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen, newChat]);

  // Commands list
  const actions = useMemo(() => {
    return [
      {
        id: 'new-chat',
        title: 'New Chat Session',
        category: 'Actions',
        icon: <Plus className="w-4 h-4 text-primary" />,
        action: () => newChat(),
      },
      {
        id: 'switch-model',
        title: 'Switch AI Model',
        category: 'Actions',
        icon: <Sparkles className="w-4 h-4 text-emerald-400" />,
        action: () => setModelSelectorOpen(true),
      },
      {
        id: 'open-settings',
        title: 'Open Settings',
        category: 'Actions',
        icon: <Settings className="w-4 h-4 text-blue-400" />,
        action: () => setSettingsOpen(true),
      },
      {
        id: 'toggle-theme',
        title: `Switch to ${settings.theme === 'dark' ? 'Light' : 'Dark'} Mode`,
        category: 'Preferences',
        icon: settings.theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-400" />,
        action: () => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }),
      },
      ...(activeConversation ? [
        {
          id: 'export-chat',
          title: `Export "${activeConversation.title}" as Markdown`,
          category: 'Conversation',
          icon: <Download className="w-4 h-4 text-purple-400" />,
          action: async () => {
            const res = await fetch(`/api/conversations/${activeConversation.id}/export`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ format: 'markdown' }),
            });
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${activeConversation.title}.md`;
            a.click();
            URL.revokeObjectURL(url);
            addToast('Exported Markdown', 'success');
          },
        },
        {
          id: 'delete-chat',
          title: `Delete Current Conversation`,
          category: 'Conversation',
          icon: <Trash2 className="w-4 h-4 text-destructive" />,
          action: () => deleteConversation(activeConversation.id),
        },
      ] : []),
    ];
  }, [activeConversation, newChat, setModelSelectorOpen, setSettingsOpen, settings.theme, updateSettings, addToast, deleteConversation]);

  // Filtered results
  const filteredActions = actions.filter((a) =>
    a.title.toLowerCase().includes(query.toLowerCase())
  );

  const matchedConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 5);

  if (!commandPaletteOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3 border-b border-border gap-2">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Type a command or search chats..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="w-full bg-transparent text-foreground placeholder:text-muted-foreground text-sm focus:outline-none"
          />
          <button
            onClick={() => setCommandPaletteOpen(false)}
            className="p-1 rounded text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1 text-xs">
          {/* Actions */}
          {filteredActions.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Commands
              </div>
              {filteredActions.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    item.action();
                    setCommandPaletteOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-muted text-foreground text-left transition-colors font-medium"
                >
                  {item.icon}
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          )}

          {/* Matched Conversations */}
          {matchedConversations.length > 0 && (
            <div className="pt-2">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Conversations
              </div>
              {matchedConversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    selectConversation(c.id);
                    setCommandPaletteOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-muted text-foreground text-left transition-colors"
                >
                  <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{c.title}</span>
                </button>
              ))}
            </div>
          )}

          {filteredActions.length === 0 && matchedConversations.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              No matching commands or conversations found.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border bg-muted/30 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Navigate with mouse or keyboard</span>
          <span>
            <kbd className="font-mono bg-muted px-1.5 py-0.5 rounded border border-border">ESC</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
};
