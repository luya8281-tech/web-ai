import { create } from 'zustand';
import { ActionInfo } from '@/types/chat';

export interface Toast {
  id: string;
  message: string;
  type?: 'info' | 'success' | 'error';
}

export type WorkspaceTab = 'terminal' | 'browser' | 'sources';

interface UIState {
  sidebarOpen: boolean;
  modelSelectorOpen: boolean;
  settingsOpen: boolean;
  skillsDialogOpen: boolean;
  connectorsDialogOpen: boolean;
  vaultDialogOpen: boolean;
  commandPaletteOpen: boolean;
  searchModalOpen: boolean;
  workspaceOpen: boolean;
  workspaceTab: WorkspaceTab;
  workspaceAction: ActionInfo | null;
  searchSourceQuota: number;
  activeConnectors: string[];
  currentSettingsTab: string;
  composerInsertText: string | null;
  pendingCliCommand: string | null;
  toasts: Toast[];

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setModelSelectorOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean, tab?: string) => void;
  setSkillsDialogOpen: (open: boolean) => void;
  setConnectorsDialogOpen: (open: boolean) => void;
  setVaultDialogOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setSearchModalOpen: (open: boolean) => void;
  setWorkspaceOpen: (open: boolean, tab?: WorkspaceTab, action?: ActionInfo | null) => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  setSearchSourceQuota: (quota: number) => void;
  toggleConnector: (id: string) => void;
  insertIntoComposer: (text: string) => void;
  clearComposerInsert: () => void;
  runInWorkspaceCli: (cmd: string) => void;
  clearPendingCliCommand: () => void;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  removeToast: (id: string) => void;
}

const DEFAULT_CONNECTORS = ['web-search', 'server-ops', 'browser-agent', 'wa-bot', 'github', 'sqlite'];

export const useUIStore = create<UIState>((set, get) => ({
  sidebarOpen: true,
  modelSelectorOpen: false,
  settingsOpen: false,
  skillsDialogOpen: false,
  connectorsDialogOpen: false,
  vaultDialogOpen: false,
  commandPaletteOpen: false,
  searchModalOpen: false,
  workspaceOpen: false,
  workspaceTab: 'terminal',
  workspaceAction: null,
  searchSourceQuota:
    typeof window !== 'undefined'
      ? Number(localStorage.getItem('ai_chat_search_quota') || 25)
      : 25,
  activeConnectors:
    typeof window !== 'undefined'
      ? (() => {
          try {
            const raw = localStorage.getItem('ai_chat_active_connectors');
            return raw ? JSON.parse(raw) : DEFAULT_CONNECTORS;
          } catch {
            return DEFAULT_CONNECTORS;
          }
        })()
      : DEFAULT_CONNECTORS,
  currentSettingsTab: 'appearance',
  composerInsertText: null,
  pendingCliCommand: null,
  toasts: [],

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setModelSelectorOpen: (open) => set({ modelSelectorOpen: open }),
  setSettingsOpen: (open, tab) =>
    set({
      settingsOpen: open,
      currentSettingsTab: tab || get().currentSettingsTab,
    }),
  setSkillsDialogOpen: (open) => set({ skillsDialogOpen: open }),
  setConnectorsDialogOpen: (open) => set({ connectorsDialogOpen: open }),
  setVaultDialogOpen: (open) => set({ vaultDialogOpen: open }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setSearchModalOpen: (open) => set({ searchModalOpen: open }),
  setWorkspaceOpen: (open, tab, action) =>
    set((state) => ({
      workspaceOpen: open,
      workspaceTab: tab || state.workspaceTab,
      workspaceAction: action !== undefined ? action : state.workspaceAction,
    })),
  setWorkspaceTab: (tab) => set({ workspaceTab: tab }),
  setSearchSourceQuota: (quota) => {
    const clamped = Math.min(Math.max(10, quota), 50);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('ai_chat_search_quota', String(clamped));
      } catch {}
    }
    set({ searchSourceQuota: clamped });
  },
  toggleConnector: (id) => {
    const current = get().activeConnectors;
    const next = current.includes(id)
      ? current.filter((c) => c !== id)
      : [...current, id];
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('ai_chat_active_connectors', JSON.stringify(next));
      } catch {}
    }
    set({ activeConnectors: next });
  },
  insertIntoComposer: (text) => set({ composerInsertText: text }),
  clearComposerInsert: () => set({ composerInsertText: null }),
  runInWorkspaceCli: (cmd) =>
    set({
      workspaceOpen: true,
      workspaceTab: 'terminal',
      pendingCliCommand: cmd,
    }),
  clearPendingCliCommand: () => set({ pendingCliCommand: null }),

  addToast: (message, type = 'info') => {
    // Notifikasi info/sukses (ganti model, tema, salin, dsb.) sengaja tidak ditampilkan.
    if (type !== 'error') return;
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }));
    setTimeout(() => {
      get().removeToast(id);
    }, 3500);
  },

  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
