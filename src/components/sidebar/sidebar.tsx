'use client';

import React, { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Pin,
  FolderPlus,
  Archive,
  Settings,
  X,
  Sun,
  Moon,
  Folder,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useUIStore } from '@/stores/ui-store';
import { ConversationItem } from './conversation-item';
import { Conversation } from '@/types/chat';

export const Sidebar: React.FC = () => {
  const {
    conversations,
    newChat,
    searchQuery,
    setSearchQuery,
    projects,
    activeProjectId,
    createProject,
    loadConversations,
  } = useChatStore();

  const { settings, updateSettings } = useSettingsStore();
  const { sidebarOpen, setSidebarOpen, setSettingsOpen } = useUIStore();

  const [showArchived, setShowArchived] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [projectName, setProjectName] = useState('');

  // Date Grouping logic (Section 13)
  const groupedConversations = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const sevenDaysAgo = today - 7 * 86400000;
    const thirtyDaysAgo = today - 30 * 86400000;

    const pinned: Conversation[] = [];
    const groups: {
      today: Conversation[];
      yesterday: Conversation[];
      previous7Days: Conversation[];
      previous30Days: Conversation[];
      older: Conversation[];
    } = {
      today: [],
      yesterday: [],
      previous7Days: [],
      previous30Days: [],
      older: [],
    };

    // Filter by search query
    const filtered = conversations.filter((c) => {
      if (searchQuery.trim()) {
        return c.title.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    });

    for (const c of filtered) {
      if (c.pinned) {
        pinned.push(c);
        continue;
      }

      const time = new Date(c.updatedAt).getTime();
      if (time >= today) {
        groups.today.push(c);
      } else if (time >= yesterday) {
        groups.yesterday.push(c);
      } else if (time >= sevenDaysAgo) {
        groups.previous7Days.push(c);
      } else if (time >= thirtyDaysAgo) {
        groups.previous30Days.push(c);
      } else {
        groups.older.push(c);
      }
    }

    return { pinned, groups };
  }, [conversations, searchQuery]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) return;
    await createProject({ name: projectName.trim() });
    setProjectName('');
    setNewProjectOpen(false);
  };

  const toggleTheme = () => {
    const next = settings.theme === 'dark' ? 'light' : 'dark';
    updateSettings({ theme: next });
  };

  const toggleArchivedView = () => {
    const next = !showArchived;
    setShowArchived(next);
    loadConversations(next);
  };

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-xs md:hidden"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-[82vw] max-w-xs sm:w-72 h-[100dvh] flex flex-col bg-sidebar border-r border-sidebar-border transition-transform duration-200 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:-translate-x-full md:hidden'
        }`}
      >
        {/* Top Header / New Chat */}
        <div className="p-3 border-b border-sidebar-border space-y-2">
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                newChat();
                if (window.innerWidth < 768) setSidebarOpen(false);
              }}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-primary text-primary-foreground font-medium text-xs sm:text-sm hover:bg-primary-hover shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>New Chat</span>
            </button>

            {/* Mobile close button */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden ml-2 p-2 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-sidebar-foreground/50" />
            <input
              type="text"
              placeholder="Search conversations... (Ctrl+K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground placeholder:text-sidebar-foreground/50 text-xs focus:outline-none focus:border-primary/50"
            />
          </div>
        </div>

        {/* Scrollable Conversation List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-4">
          {/* Projects / Folders */}
          {projects.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-2 mb-1 text-[11px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                <span>Folders</span>
                <button
                  onClick={() => setNewProjectOpen(!newProjectOpen)}
                  className="hover:text-sidebar-foreground"
                  title="New Folder"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {newProjectOpen && (
                <form onSubmit={handleCreateProject} className="p-2 mb-2 rounded border border-border bg-card">
                  <input
                    type="text"
                    placeholder="Folder name..."
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    autoFocus
                    className="w-full text-xs p-1 border rounded bg-background text-foreground mb-1.5"
                  />
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setNewProjectOpen(false)}
                      className="px-2 py-0.5 text-[11px] rounded hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-2 py-0.5 text-[11px] rounded bg-primary text-primary-foreground"
                    >
                      Create
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-0.5">
                {projects.map((proj) => (
                  <button
                    key={proj.id}
                    onClick={() => newChat(proj.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors text-left"
                  >
                    <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span className="truncate">{proj.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pinned Section */}
          {groupedConversations.pinned.length > 0 && (
            <div>
              <div className="flex items-center gap-1 px-2 mb-1 text-[11px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                <Pin className="w-3 h-3 rotate-45" />
                <span>Pinned</span>
              </div>
              <div className="space-y-0.5">
                {groupedConversations.pinned.map((conv) => (
                  <ConversationItem key={conv.id} conversation={conv} />
                ))}
              </div>
            </div>
          )}

          {/* Date Grouped Sections */}
          {groupedConversations.groups.today.length > 0 && (
            <div>
              <div className="px-2 mb-1 text-[11px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                Today
              </div>
              <div className="space-y-0.5">
                {groupedConversations.groups.today.map((conv) => (
                  <ConversationItem key={conv.id} conversation={conv} />
                ))}
              </div>
            </div>
          )}

          {groupedConversations.groups.yesterday.length > 0 && (
            <div>
              <div className="px-2 mb-1 text-[11px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                Yesterday
              </div>
              <div className="space-y-0.5">
                {groupedConversations.groups.yesterday.map((conv) => (
                  <ConversationItem key={conv.id} conversation={conv} />
                ))}
              </div>
            </div>
          )}

          {groupedConversations.groups.previous7Days.length > 0 && (
            <div>
              <div className="px-2 mb-1 text-[11px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                Previous 7 Days
              </div>
              <div className="space-y-0.5">
                {groupedConversations.groups.previous7Days.map((conv) => (
                  <ConversationItem key={conv.id} conversation={conv} />
                ))}
              </div>
            </div>
          )}

          {groupedConversations.groups.previous30Days.length > 0 && (
            <div>
              <div className="px-2 mb-1 text-[11px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                Previous 30 Days
              </div>
              <div className="space-y-0.5">
                {groupedConversations.groups.previous30Days.map((conv) => (
                  <ConversationItem key={conv.id} conversation={conv} />
                ))}
              </div>
            </div>
          )}

          {groupedConversations.groups.older.length > 0 && (
            <div>
              <div className="px-2 mb-1 text-[11px] font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                Older
              </div>
              <div className="space-y-0.5">
                {groupedConversations.groups.older.map((conv) => (
                  <ConversationItem key={conv.id} conversation={conv} />
                ))}
              </div>
            </div>
          )}

          {conversations.length === 0 && (
            <div className="text-center py-8 text-xs text-sidebar-foreground/50">
              No conversations yet.
            </div>
          )}
        </div>

        {/* Footer: User profile & Settings */}
        <div className="p-3 border-t border-sidebar-border bg-sidebar space-y-1">
          {/* Archived Toggle */}
          <button
            onClick={toggleArchivedView}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              showArchived
                ? 'bg-amber-500/10 text-amber-500'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
            }`}
          >
            <div className="flex items-center gap-2">
              <Archive className="w-3.5 h-3.5" />
              <span>{showArchived ? 'Active Chats' : 'Archived Chats'}</span>
            </div>
          </button>

          {/* User Profile Bar */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">
                V
              </div>
              <div className="flex flex-col text-left">
                <span className="text-xs font-semibold text-sidebar-foreground">Vee</span>
                <span className="text-[10px] text-sidebar-foreground/50">Single-User · Admin</span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={toggleTheme}
                className="p-1.5 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                title={`Toggle theme (current: ${settings.theme})`}
              >
                {settings.theme === 'dark' ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </button>

              <button
                onClick={() => setSettingsOpen(true)}
                className="p-1.5 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
