import { create } from 'zustand';

export interface Toast {
  id: string;
  message: string;
  type?: 'info' | 'success' | 'error';
}

interface UIState {
  sidebarOpen: boolean;
  modelSelectorOpen: boolean;
  settingsOpen: boolean;
  commandPaletteOpen: boolean;
  searchModalOpen: boolean;
  currentSettingsTab: string;
  toasts: Toast[];

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setModelSelectorOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean, tab?: string) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setSearchModalOpen: (open: boolean) => void;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  removeToast: (id: string) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarOpen: true,
  modelSelectorOpen: false,
  settingsOpen: false,
  commandPaletteOpen: false,
  searchModalOpen: false,
  currentSettingsTab: 'general',
  toasts: [],

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setModelSelectorOpen: (open) => set({ modelSelectorOpen: open }),
  setSettingsOpen: (open, tab) => set({
    settingsOpen: open,
    currentSettingsTab: tab || get().currentSettingsTab,
  }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setSearchModalOpen: (open) => set({ searchModalOpen: open }),

  addToast: (message, type = 'info') => {
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
