import { create } from 'zustand';
import { AppTheme, UserSettings } from '@/types/chat';

interface SettingsState {
  settings: UserSettings;
  isLoading: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (data: Partial<UserSettings>) => Promise<void>;
}

const DARK_THEMES: AppTheme[] = ['dark', 'midnight', 'nord', 'mocha', 'rose'];

export function applySettingsToDOM(settings: Partial<UserSettings>) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (settings.theme) {
    let resolvedTheme: AppTheme = settings.theme;
    if (resolvedTheme === 'system' && typeof window !== 'undefined') {
      resolvedTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    root.setAttribute('data-theme', resolvedTheme);
    if (DARK_THEMES.includes(resolvedTheme)) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }

  if (settings.fontSize) {
    root.setAttribute('data-font-size', settings.fontSize);
  }

  if (settings.fontFamily) {
    root.setAttribute('data-font-family', settings.fontFamily);
    try {
      localStorage.setItem('vee_font_family', settings.fontFamily);
    } catch {}
  }
}

const defaultSettings: UserSettings = {
  id: 'default',
  userId: 'user_vee',
  theme: 'dark',
  fontSize: 'normal',
  fontFamily: 'serif',
  compactMode: false,
  sendOnEnter: false,
  autoTitle: true,
  showTimestamps: true,
  streamResponses: true,
  codeLineNumbers: true,
  systemPrompt: '',
  defaultProviderId: 'xkiro',
  defaultModelId: 'qwen/qwen3.7-plus:free',
  memoryEnabled: true,
  claudePersona: 'claude-official',
  updatedAt: new Date().toISOString(),
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  isLoading: false,

  loadSettings: async () => {
    try {
      set({ isLoading: true });
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          let savedFont: 'serif' | 'sans' | 'mono' = 'serif';
          if (typeof window !== 'undefined') {
            savedFont = (localStorage.getItem('vee_font_family') as any) || 'serif';
          }
          const merged = { ...data.settings, fontFamily: data.settings.fontFamily || savedFont };
          set({ settings: merged });
          applySettingsToDOM(merged);
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  updateSettings: async (data: Partial<UserSettings>) => {
    const current = get().settings;
    const next = { ...current, ...data };
    set({ settings: next });
    applySettingsToDOM(next);

    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  },
}));
