'use client';

import React, { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Pin,
  Archive,
  Settings,
  X,
  Palette,
  Folder,
  LogOut,
  BookOpen,
  Plug,
  Terminal,
  Brain,
  KeyRound,
} from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useUIStore } from '@/stores/ui-store';
import { useAuthStore } from '@/stores/auth-store';
import { ConversationItem } from './conversation-item';
import { Conversation, AppTheme } from '@/types/chat';

const THEME_CYCLE: { id: AppTheme; label: string }[] = [
  { id: 'dark', label: 'Claude Obsidian' },
  { id: 'light', label: 'Claude Paper' },
  { id: 'midnight', label: 'Midnight Slate' },
  { id: 'nord', label: 'Nordic Frost' },
  { id: 'mocha', label: 'Warm Mocha' },
  { id: 'rose', label: 'Velvet Rose' },
  { id: 'sand', label: 'Sepia Sand' },
];

export const Sidebar: React.FC = () => {
  const {
    conversations,
    newChat,
    searchQuery,
    setSearchQuery,
    projects,
    createProject,
    loadConversations,
  } = useChatStore();

  const { settings, updateSettings } = useSettingsStore();
  const {
    sidebarOpen,
    setSidebarOpen,
    setSettingsOpen,
    setSkillsDialogOpen,
    setConnectorsDialogOpen,
    setVaultDialogOpen,
    setWorkspaceOpen,
    addToast,
  } = useUIStore();
  const { user, logout, checkAuth } = useAuthStore();

  React.useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const [showArchived, setShowArchived] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [projectName, setProjectName] = useState('');

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

  const cycleTheme = () => {
    const curIdx = THEME_CYCLE.findIndex((t) => t.id === settings.theme);
    const next = THEME_CYCLE[(curIdx + 1) % THEME_CYCLE.length];
    updateSettings({ theme: next.id });
    addToast(`Tema: ${next.label}`, 'info');
  };

  const toggleArchivedView = () => {
    const next = !showArchived;
    setShowArchived(next);
    loadConversations(next);
  };

  return (
    <>
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-xs md:hidden"
        />
      )}

      <aside
        aria-label="Navigasi percakapan dan proyek"
        className={`fixed md:static inset-y-0 left-0 z-40 w-[80vw] max-w-xs sm:w-64 flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 ease-in-out select-none font-sans ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:hidden'
        }`}
      >
        {/* Vee brand */}
        <div className="p-3 space-y-2 border-b border-sidebar-border">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <img src="/vee-sela-hitam.png" alt="Logo Vee" width={28} height={28} className="w-7 h-7 rounded-md bg-white shrink-0" />
              <span className="font-semibold text-sm tracking-tight text-sidebar-foreground">
                Vee Workspace
              </span>
            </div>

            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
              aria-label="Tutup sidebar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              newChat();
              if (typeof window !== 'undefined' && window.innerWidth < 768) {
                setSidebarOpen(false);
              }
            }}
            className="w-full py-2 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
          >
            <Plus className="w-4 h-4 stroke-[2.2]" />
            <span>Percakapan Baru</span>
          </button>

          {/* Quick Workspace & Connectors Shortcuts */}
          <div className="grid grid-cols-3 gap-1">
            <button
              type="button"
              onClick={() => setConnectorsDialogOpen(true)}
              className="py-1.5 px-2 rounded-lg border border-sidebar-border bg-background/50 hover:bg-sidebar-accent text-[11px] font-medium text-sidebar-foreground flex items-center justify-center gap-1 transition-colors"
              title="Buka Konektor AI Modern"
            >
              <Plug className="w-3 h-3 text-primary shrink-0" />
              <span className="truncate">Konektor</span>
            </button>

            <button
              type="button"
              onClick={() => setSkillsDialogOpen(true)}
              className="py-1.5 px-2 rounded-lg border border-sidebar-border bg-background/50 hover:bg-sidebar-accent text-[11px] font-medium text-sidebar-foreground flex items-center justify-center gap-1 transition-colors"
              title="Buka Katalog Skill"
            >
              <BookOpen className="w-3 h-3 text-primary shrink-0" />
              <span className="truncate">Skill</span>
            </button>

            <button
              type="button"
              onClick={() => setWorkspaceOpen(true, 'terminal')}
              className="py-1.5 px-2 rounded-lg border border-sidebar-border bg-background/50 hover:bg-sidebar-accent text-[11px] font-medium text-sidebar-foreground flex items-center justify-center gap-1 transition-colors"
              title="Buka Terminal CLI & Web Aktif"
            >
              <Terminal className="w-3 h-3 text-primary shrink-0" />
              <span className="truncate">CLI/Web</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setSettingsOpen(true, 'memory');
              if (typeof window !== 'undefined' && window.innerWidth < 768) {
                setSidebarOpen(false);
              }
            }}
            className="w-full py-1.5 px-2 rounded-lg border border-sidebar-border bg-background/50 hover:bg-sidebar-accent text-[11px] font-medium text-sidebar-foreground flex items-center justify-center gap-1.5 transition-colors"
            title="Kelola memori jangka panjang AI"
          >
            <Brain className="w-3 h-3 text-primary shrink-0" />
            <span>Memori AI</span>
          </button>

          {/* Search Filter */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cari riwayat chat..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-6 py-1.5 text-xs rounded-lg bg-background border border-sidebar-border text-sidebar-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Conversation List */}
        <div className="flex-1 overflow-y-auto px-2 py-2.5 space-y-4">
          {/* Projects Folder Section */}
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[11px] font-semibold text-muted-foreground">
                Proyek
              </span>
              <button
                type="button"
                onClick={() => setNewProjectOpen(!newProjectOpen)}
                className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                title="Tambah proyek"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {newProjectOpen && (
              <form onSubmit={handleCreateProject} className="mb-2 px-1 flex gap-1">
                <input
                  type="text"
                  placeholder="Nama proyek..."
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  autoFocus
                  className="flex-1 text-xs px-2 py-1 rounded bg-background border border-sidebar-border focus:outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded font-medium"
                >
                  Simpan
                </button>
              </form>
            )}

            {projects.length > 0 && (
              <div className="space-y-0.5">
                {projects.map((proj) => (
                  <button
                    key={proj.id}
                    type="button"
                    onClick={() => newChat(proj.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors text-left"
                  >
                    <Folder
                      className="w-3.5 h-3.5 shrink-0"
                      style={{ color: proj.color || 'var(--primary)' }}
                    />
                    <span className="truncate">{proj.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Pinned Section */}
          {groupedConversations.pinned.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 px-2 mb-1 text-[11px] font-semibold text-muted-foreground">
                <Pin className="w-3 h-3 text-primary" />
                <span>Disematkan</span>
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
              <div className="px-2 mb-1 text-[11px] font-semibold text-muted-foreground">
                Hari ini
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
              <div className="px-2 mb-1 text-[11px] font-semibold text-muted-foreground">
                Kemarin
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
              <div className="px-2 mb-1 text-[11px] font-semibold text-muted-foreground">
                7 Hari Terakhir
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
              <div className="px-2 mb-1 text-[11px] font-semibold text-muted-foreground">
                30 Hari Terakhir
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
              <div className="px-2 mb-1 text-[11px] font-semibold text-muted-foreground">
                Lebih lama
              </div>
              <div className="space-y-0.5">
                {groupedConversations.groups.older.map((conv) => (
                  <ConversationItem key={conv.id} conversation={conv} />
                ))}
              </div>
            </div>
          )}

          {conversations.length === 0 && (
            <div className="text-center py-8 px-3 text-xs text-muted-foreground">
              Belum ada percakapan.
            </div>
          )}
        </div>

        {/* Footer: Archive, User Profile, Theme Cycler, Settings */}
        <div className="p-2.5 border-t border-sidebar-border bg-sidebar space-y-1.5">
          <button
            type="button"
            onClick={toggleArchivedView}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              showArchived
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground'
            }`}
          >
            <div className="flex items-center gap-2">
              <Archive className="w-3.5 h-3.5" />
              <span>{showArchived ? 'Kembali ke Chat Aktif' : 'Arsip Percakapan'}</span>
            </div>
          </button>

          <div className="flex items-center justify-between pt-1 px-1">
            <div className="flex items-center gap-2 min-w-0 pr-1">
              <div className="w-7 h-7 rounded-full bg-primary/15 text-primary border border-primary/30 flex items-center justify-center font-bold text-xs shrink-0">
                {(user?.name || 'V').charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col text-left truncate">
                <span className="text-xs font-semibold text-sidebar-foreground truncate">
                  {user?.name || 'Vee'}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {user?.role === 'admin' ? 'Admin' : 'Personal'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={cycleTheme}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                title={`Ganti tema warna (saat ini: ${settings.theme})`}
              >
                <Palette className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setVaultDialogOpen(true)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                title="Buka Brankas Sandi & Email (Vault)"
              >
                <KeyRound className="w-4 h-4 text-primary" />
              </button>

              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                title="Pengaturan"
              >
                <Settings className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => logout()}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Keluar"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
