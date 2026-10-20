'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  Sliders,
  Palette,
  MessageSquare,
  Server,
  Keyboard,
  Plus,
  Check,
  AlertCircle,
  Loader2,
  Trash2,
  Edit2,
  RefreshCw,
  Wallet,
  BookOpen,
  Database,
  Download,
  Terminal,
  Brain,
  Sparkles,
  User,
  Heart,
  Briefcase,
  Code,
  MapPin,
  FileText,
  ShieldAlert,
  KeyRound,
  Lock,
  Mail,
  Globe,
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settings-store';
import { useChatStore } from '@/stores/chat-store';
import { useUIStore } from '@/stores/ui-store';
import { AppTheme, Provider } from '@/types/chat';

const THEME_OPTIONS: {
  id: AppTheme;
  name: string;
  desc: string;
  bg: string;
  card: string;
  accent: string;
  text: string;
}[] = [
  {
    id: 'dark',
    name: 'Claude Obsidian',
    desc: 'Gelap hangat khas ruang baca',
    bg: '#111110',
    card: '#191918',
    accent: '#cc785c',
    text: '#ede8df',
  },
  {
    id: 'light',
    name: 'Claude Paper',
    desc: 'Kertas terang ramah mata',
    bg: '#fbfaf8',
    card: '#ffffff',
    accent: '#cc785c',
    text: '#1c1b18',
  },
  {
    id: 'midnight',
    name: 'Midnight Slate',
    desc: 'Biru malam kontras dalam',
    bg: '#0c1018',
    card: '#131926',
    accent: '#5b8def',
    text: '#e5eaf3',
  },
  {
    id: 'nord',
    name: 'Nordic Frost',
    desc: 'Abu dingin skandinavia',
    bg: '#1e222a',
    card: '#272c36',
    accent: '#81a1c1',
    text: '#e5e9f0',
  },
  {
    id: 'mocha',
    name: 'Warm Mocha',
    desc: 'Cokelat espresso hangat',
    bg: '#171314',
    card: '#211b1d',
    accent: '#dca06d',
    text: '#f2e9e4',
  },
  {
    id: 'rose',
    name: 'Velvet Rose',
    desc: 'Ungu senja lembut',
    bg: '#151116',
    card: '#1f1921',
    accent: '#d97798',
    text: '#f2e9f0',
  },
  {
    id: 'sand',
    name: 'Sepia Sand',
    desc: 'Halaman buku klasik hangat',
    bg: '#f4efe6',
    card: '#faf6f0',
    accent: '#a85032',
    text: '#26221e',
  },
  {
    id: 'system',
    name: 'Otomatis Sistem',
    desc: 'Ikuti pengaturan perangkat',
    bg: '#191918',
    card: '#fbfaf8',
    accent: '#cc785c',
    text: '#888888',
  },
];

interface MemoryItem {
  id: string;
  category: string;
  content: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

const MEMORY_CATEGORY_OPTIONS = [
  { value: 'identitas', label: 'Profil & Identitas' },
  { value: 'pasangan', label: 'Pasangan & Relasi' },
  { value: 'pekerjaan', label: 'Pekerjaan & Karir' },
  { value: 'proyek', label: 'Proyek & Karya' },
  { value: 'solusi_masalah', label: 'Solusi & Pembelajaran Otomasi' },
  { value: 'hobi', label: 'Hobi & Ketertarikan' },
  { value: 'lokasi', label: 'Lokasi & Domisili' },
  { value: 'preferensi', label: 'Preferensi Komunikasi' },
  { value: 'lainnya', label: 'Catatan Lainnya' },
];

const MEMORY_CATEGORY_ORDER = [
  'identitas',
  'pasangan',
  'pekerjaan',
  'proyek',
  'solusi_masalah',
  'hobi',
  'lokasi',
  'preferensi',
  'lainnya',
];

const MEMORY_CATEGORY_META: Record<
  string,
  { label: string; icon: any; color: string; badge: string }
> = {
  identitas: {
    label: 'Profil & Identitas',
    icon: User,
    color: 'text-sky-400',
    badge: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
  },
  pasangan: {
    label: 'Pasangan & Relasi',
    icon: Heart,
    color: 'text-rose-400',
    badge: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  },
  pekerjaan: {
    label: 'Pekerjaan & Karir',
    icon: Briefcase,
    color: 'text-amber-400',
    badge: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  },
  proyek: {
    label: 'Proyek & Karya',
    icon: Code,
    color: 'text-emerald-400',
    badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  },
  solusi_masalah: {
    label: 'Solusi & Pembelajaran Otomasi',
    icon: ShieldAlert,
    color: 'text-red-400',
    badge: 'bg-red-500/10 text-red-400 border-red-500/30',
  },
  hobi: {
    label: 'Hobi & Ketertarikan',
    icon: Sparkles,
    color: 'text-purple-400',
    badge: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  },
  lokasi: {
    label: 'Lokasi & Domisili',
    icon: MapPin,
    color: 'text-blue-400',
    badge: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  },
  preferensi: {
    label: 'Preferensi Komunikasi',
    icon: Sliders,
    color: 'text-orange-400',
    badge: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  },
  lainnya: {
    label: 'Catatan Lainnya',
    icon: FileText,
    color: 'text-muted-foreground',
    badge: 'bg-muted text-muted-foreground border-border',
  },
};

const PERSONA_PRESETS = [
  {
    label: 'Default Asisten',
    prompt: '',
  },
  {
    label: 'Senior Engineer',
    prompt:
      'Jawab sebagai Senior Full-Stack & Systems Engineer. Berikan kode produksi yang bersih, aman, efisien, dan langsung ke inti solusi tanpa basa-basi.',
  },
  {
    label: 'Linux & DevOps',
    prompt:
      'Fokus pada administrasi server Ubuntu, Docker, PM2, systemd, keamanan jaringan, dan optimasi resource VPS.',
  },
  {
    label: 'Ringkas & Padat',
    prompt:
      'Jawab selalu singkat, padat, dan terstruktur dengan poin-poin inti. Hindari paragraf pembuka dan penutup yang bertele-tele.',
  },
];

export const SettingsDialog: React.FC = () => {
  const { settings, updateSettings } = useSettingsStore();
  const {
    providers,
    models,
    conversations,
    activeModelId,
    setProviderAndModel,
    temperature,
    topP,
    maxTokens,
    reasoningEffort,
    setParameters,
    loadProviders,
    loadModels,
    loadConversations,
    deleteConversation,
  } = useChatStore();
  const {
    settingsOpen,
    setSettingsOpen,
    setSkillsDialogOpen,
    setVaultDialogOpen,
    currentSettingsTab,
    addToast,
  } = useUIStore();

  const [activeTab, setActiveTab] = useState<
    'appearance' | 'general' | 'chat' | 'memory' | 'skills' | 'data' | 'providers' | 'shortcuts' | 'vault'
  >((currentSettingsTab as any) || 'appearance');

  // Saat dialog dibuka lewat pintasan (mis. "Memori AI" di sidebar), pindah
  // ke tab yang diminta. useState di atas hanya berlaku saat mount pertama.
  useEffect(() => {
    if (settingsOpen && currentSettingsTab) {
      setActiveTab(currentSettingsTab as any);
    }
  }, [settingsOpen, currentSettingsTab]);

  const [addingProvider, setAddingProvider] = useState(false);
  const [providerForm, setProviderForm] = useState({
    id: '',
    name: '',
    baseUrl: '',
    apiKey: '',
    protocol: 'openai-compatible' as
      | 'openai-compatible'
      | 'anthropic-compatible'
      | 'mock'
      | 'antigravity-agent',
  });
  const [testStatus, setTestStatus] = useState<{
    loading: boolean;
    ok?: boolean;
    message?: string;
  } | null>(null);
  const [refreshingProviderId, setRefreshingProviderId] = useState<string | null>(null);
  const [checkingCreditId, setCheckingCreditId] = useState<string | null>(null);

  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editProviderForm, setEditProviderForm] = useState({
    name: '',
    baseUrl: '',
    apiKey: '',
  });
  const [editSaving, setEditSaving] = useState(false);

  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [memorySaving, setMemorySaving] = useState(false);
  const [memoryImporting, setMemoryImporting] = useState(false);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editMemoryContent, setEditMemoryContent] = useState('');
  const [editMemoryCategory, setEditMemoryCategory] = useState('lainnya');
  const [memoryUpdating, setMemoryUpdating] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryCategory, setMemoryCategory] = useState('lainnya');
  const [memoryContent, setMemoryContent] = useState('');
  const [memoryFilterCategory, setMemoryFilterCategory] = useState<string>('all');

  const fetchMemories = useCallback(async () => {
    setMemoriesLoading(true);
    setMemoryError(null);
    try {
      const res = await fetch('/api/memories', { cache: 'no-store', credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal memuat memori.');
      setMemories(Array.isArray(data.memories) ? data.memories : []);
    } catch (e: any) {
      setMemoryError(e.message || 'Gagal memuat memori.');
    } finally {
      setMemoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (settingsOpen && activeTab === 'memory') {
      fetchMemories();
    }
  }, [settingsOpen, activeTab, fetchMemories]);

  const handleAddMemory = async () => {
    const content = memoryContent.trim();
    if (content.length < 2) {
      setMemoryError('Tulis fakta yang ingin diingat (minimal 2 karakter).');
      return;
    }
    setMemorySaving(true);
    setMemoryError(null);
    try {
      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, category: memoryCategory }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan memori.');
      setMemoryContent('');
      await fetchMemories();
      addToast('Memori berhasil disimpan', 'success');
    } catch (e: any) {
      setMemoryError(e.message || 'Gagal menyimpan memori.');
    } finally {
      setMemorySaving(false);
    }
  };

  const startEditMemory = (memory: MemoryItem) => {
    setEditingMemoryId(memory.id);
    setEditMemoryContent(memory.content);
    setEditMemoryCategory(memory.category);
    setMemoryError(null);
  };

  const cancelEditMemory = () => {
    setEditingMemoryId(null);
    setEditMemoryContent('');
    setEditMemoryCategory('lainnya');
  };

  const handleUpdateMemory = async () => {
    if (!editingMemoryId) return;
    const content = editMemoryContent.trim();
    if (content.length < 2) {
      setMemoryError('Isi memori minimal 2 karakter.');
      return;
    }
    setMemoryUpdating(true);
    setMemoryError(null);
    try {
      const res = await fetch('/api/memories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingMemoryId,
          content,
          category: editMemoryCategory,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal memperbarui memori.');
      setMemories((prev) =>
        prev.map((m) => (m.id === data.memory?.id ? data.memory : m))
      );
      cancelEditMemory();
      addToast('Memori berhasil diperbarui', 'success');
    } catch (e: any) {
      setMemoryError(e.message || 'Gagal memperbarui memori.');
    } finally {
      setMemoryUpdating(false);
    }
  };

  const handleImportMemories = async () => {
    if (
      !confirm(
        'Pindai riwayat percakapan untuk mencari fakta eksplisit (nama, pekerjaan, hobi, dll)? Memori yang sudah ada tidak akan diduplikasi.'
      )
    ) {
      return;
    }
    setMemoryImporting(true);
    setMemoryError(null);
    try {
      const res = await fetch('/api/memories/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 400 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal mengimpor memori.');
      setMemories(Array.isArray(data.memories) ? data.memories : []);
      addToast(
        `${data.saved || 0} memori baru ditemukan dari ${data.scanned || 0} pesan`,
        'success'
      );
    } catch (e: any) {
      setMemoryError(e.message || 'Gagal mengimpor memori.');
    } finally {
      setMemoryImporting(false);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      const res = await fetch(`/api/memories?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Gagal menghapus memori.');
      }
      if (editingMemoryId === id) cancelEditMemory();
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (e: any) {
      setMemoryError(e.message || 'Gagal menghapus memori.');
    }
  };

  const handleClearMemories = async () => {
    if (!confirm('Hapus semua memori jangka panjang? Tindakan ini tidak bisa dibatalkan.')) return;
    try {
      const res = await fetch('/api/memories?all=1', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Gagal menghapus memori.');
      }
      setMemories([]);
    } catch (e: any) {
      setMemoryError(e.message || 'Gagal menghapus memori.');
    }
  };

  if (!settingsOpen) return null;

  const handleTestConnection = async () => {
    if (!providerForm.baseUrl) {
      setTestStatus({ loading: false, ok: false, message: 'Base URL wajib diisi' });
      return;
    }
    setTestStatus({ loading: true });
    try {
      const res = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: providerForm.baseUrl,
          apiKey: providerForm.apiKey || undefined,
          protocol: providerForm.protocol,
        }),
      });
      const data = await res.json();
      setTestStatus({ loading: false, ok: data.ok, message: data.message });
    } catch (e: any) {
      setTestStatus({ loading: false, ok: false, message: e.message });
    }
  };

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!providerForm.name || !providerForm.baseUrl) {
      addToast('Nama dan Base URL wajib diisi', 'error');
      return;
    }
    const safeId =
      providerForm.id.trim() || providerForm.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: safeId,
          name: providerForm.name,
          baseUrl: providerForm.baseUrl,
          apiKey: providerForm.apiKey || undefined,
          protocol: providerForm.protocol,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Gagal membuat provider');
      }

      await loadProviders();
      await loadModels(safeId, true);
      addToast(`Provider "${providerForm.name}" terhubung`, 'success');
      setAddingProvider(false);
      setProviderForm({
        id: '',
        name: '',
        baseUrl: '',
        apiKey: '',
        protocol: 'openai-compatible',
      });
      setTestStatus(null);
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const handleRefreshModels = async (providerId: string, name: string) => {
    setRefreshingProviderId(providerId);
    try {
      const res = await fetch(`/api/providers/${providerId}/refresh`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        await loadProviders();
        await loadModels();
        addToast(`Memperbarui ${data.count || 0} model untuk ${name}`, 'success');
      } else {
        throw new Error(data.error || 'Gagal memperbarui model');
      }
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setRefreshingProviderId(null);
    }
  };

  const handleCheckCredit = async (providerId: string) => {
    setCheckingCreditId(providerId);
    try {
      const res = await fetch(`/api/providers/${providerId}/credit`);
      const data = await res.json();
      if (res.ok) {
        if (data.supported) {
          addToast(`Sisa Kredit: ${data.credit}`, 'success');
        } else {
          addToast(data.message || 'Provider tidak mendukung cek kredit via API', 'error');
        }
      } else {
        throw new Error(data.error || 'Gagal mengecek kredit');
      }
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setCheckingCreditId(null);
    }
  };

  const handleDeleteProvider = async (id: string, name: string) => {
    if (!confirm(`Hapus provider "${name}"?`)) return;
    try {
      const res = await fetch(`/api/providers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await loadProviders();
        await loadModels();
        addToast(`Provider "${name}" dihapus`, 'info');
      }
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const startEditProvider = (p: Provider) => {
    setEditingProviderId(p.id);
    setEditProviderForm({ name: p.name, baseUrl: p.baseUrl || '', apiKey: '' });
  };

  const handleSaveEditProvider = async () => {
    if (!editingProviderId) return;
    setEditSaving(true);
    try {
      const body: Record<string, any> = {};
      if (editProviderForm.name) body.name = editProviderForm.name;
      if (editProviderForm.baseUrl) body.baseUrl = editProviderForm.baseUrl;
      if (editProviderForm.apiKey) body.apiKey = editProviderForm.apiKey;

      const res = await fetch(`/api/providers/${editingProviderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Gagal memperbarui provider');
      }
      await loadProviders();
      addToast('Provider diperbarui', 'success');
      setEditingProviderId(null);
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setEditSaving(false);
    }
  };

  const handleExportAllData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      settings,
      conversationsCount: conversations.length,
      conversations,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vee2-ai-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('Cadangan data (.json) berhasil diunduh', 'success');
  };

  const handleClearAllConversations = async () => {
    if (!confirm(`Hapus semua ${conversations.length} percakapan dari daftar?`)) return;
    for (const c of conversations) {
      await deleteConversation(c.id);
    }
    await loadConversations(false);
    addToast('Seluruh riwayat percakapan telah dibersihkan', 'info');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
      <div className="relative w-full max-w-3xl h-[82vh] flex flex-col md:flex-row rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Settings Sidebar */}
        <div className="w-full md:w-52 p-2.5 border-b md:border-b-0 md:border-r border-border bg-muted/20 flex md:flex-col gap-1 overflow-x-auto shrink-0">
          <div className="hidden md:block px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Pengaturan
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('appearance')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 ${
              activeTab === 'appearance'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Palette className="w-4 h-4" />
            <span>Tema & Tampilan</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 ${
              activeTab === 'general'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Umum</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 ${
              activeTab === 'chat'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Chat & Persona</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('memory')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 ${
              activeTab === 'memory'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Brain className="w-4 h-4" />
            <span>Memori</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('skills')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 ${
              activeTab === 'skills'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Skill & Alat</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('providers')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 ${
              activeTab === 'providers'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>Provider AI</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('vault')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 ${
              activeTab === 'vault'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <span>Vault Sandi</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('data')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 ${
              activeTab === 'data'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>Data & Backup</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('shortcuts')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 ${
              activeTab === 'shortcuts'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Keyboard className="w-4 h-4" />
            <span>Pintasan</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-card">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h3 className="text-sm sm:text-base font-semibold text-foreground">
              {activeTab === 'appearance' && 'Tema Warna & Tipografi'}
              {activeTab === 'general' && 'Pengaturan Umum'}
              {activeTab === 'chat' && 'Perilaku Chat, Parameter & Persona'}
              {activeTab === 'memory' && 'Memori Jangka Panjang'}
              {activeTab === 'skills' && 'Modul Skill Server & Alat Otomasi'}
              {activeTab === 'providers' && 'Manajemen Provider AI'}
              {activeTab === 'vault' && 'Brankas Kredensial & Sandi Email (Vault)'}
              {activeTab === 'data' && 'Manajemen Data & Riwayat'}
              {activeTab === 'shortcuts' && 'Pintasan Keyboard'}
            </h3>
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6 text-sm">
            {/* 1. APPEARANCE TAB */}
            {activeTab === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <label className="block font-medium text-foreground mb-1">
                    Tema Warna Ruang Kerja
                  </label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Pilih suasana warna kanvas percakapan (8 palet tersedia).
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {THEME_OPTIONS.map((t) => {
                      const isSelected = settings.theme === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => updateSettings({ theme: t.id })}
                          className={`flex flex-col p-2.5 rounded-xl border text-left transition-all ${
                            isSelected
                              ? 'border-primary ring-1 ring-primary bg-primary/5'
                              : 'border-border bg-muted/30 hover:bg-muted/60'
                          }`}
                        >
                          {/* Theme Preview Swatch */}
                          <div
                            className="w-full h-9 rounded-lg border border-black/10 mb-2 flex items-center justify-between px-2.5"
                            style={{ backgroundColor: t.bg }}
                          >
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-3.5 h-3.5 rounded-full border border-white/15"
                                style={{ backgroundColor: t.accent }}
                              />
                              <span
                                className="w-6 h-2 rounded-full opacity-80"
                                style={{ backgroundColor: t.text }}
                              />
                            </div>
                            <span
                              className="w-4 h-4 rounded-md border border-white/10"
                              style={{ backgroundColor: t.card }}
                            />
                          </div>
                          <div className="text-xs font-semibold text-foreground truncate">
                            {t.name}
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {t.desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-2">
                    Gaya Font Jawaban AI
                  </label>
                  <div className="grid grid-cols-3 gap-2.5">
                    {[
                      { id: 'serif', label: 'Serif Klasik (Claude)', sample: 'Aa' },
                      { id: 'sans', label: 'Sans Modern', sample: 'Aa' },
                      { id: 'mono', label: 'Monospace Teknis', sample: '01' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => updateSettings({ fontFamily: f.id as any })}
                        className={`p-3 rounded-xl border text-xs font-medium transition-all text-left ${
                          (settings.fontFamily || 'serif') === f.id
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted/40 hover:bg-muted text-muted-foreground'
                        }`}
                      >
                        <div
                          className={`text-base font-semibold mb-0.5 text-foreground ${
                            f.id === 'serif'
                              ? 'font-serif'
                              : f.id === 'mono'
                                ? 'font-mono'
                                : 'font-sans'
                          }`}
                        >
                          {f.sample}
                        </div>
                        <div>{f.label}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-2">Ukuran Teks</label>
                  <div className="grid grid-cols-3 gap-2.5">
                    {[
                      { id: 'small', label: 'Kecil (Rapat)' },
                      { id: 'normal', label: 'Normal (Standar)' },
                      { id: 'large', label: 'Besar (Lega)' },
                    ].map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => updateSettings({ fontSize: s.id as any })}
                        className={`p-2.5 rounded-xl border text-xs font-semibold transition-all ${
                          settings.fontSize === s.id
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted/40 hover:bg-muted text-muted-foreground'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div>
                    <div className="font-medium text-foreground">Mode Pesan Rapat (Compact)</div>
                    <div className="text-xs text-muted-foreground">
                      Kurangi jarak vertikal antar balon percakapan
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.compactMode}
                    onChange={(e) => updateSettings({ compactMode: e.target.checked })}
                    className="w-4 h-4 accent-primary rounded"
                  />
                </div>
              </div>
            )}

            {/* 2. GENERAL TAB */}
            {activeTab === 'general' && (
              <div className="space-y-5">
                <div>
                  <label className="block font-medium text-foreground mb-1">
                    Model AI Aktif Saat Ini
                  </label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Pilih model utama untuk sesi percakapan.
                  </p>
                  <select
                    value={activeModelId}
                    onChange={(e) => {
                      const found = models.find(
                        (m) => m.id === e.target.value || m.modelId === e.target.value
                      );
                      if (found) {
                        setProviderAndModel(found.providerId, found.modelId);
                        updateSettings({
                          defaultProviderId: found.providerId,
                          defaultModelId: found.modelId,
                        });
                      }
                    }}
                    className="w-full p-2.5 rounded-xl border border-border bg-background text-foreground text-xs"
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.modelId}>
                        {m.displayName || m.name} ({m.providerId})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">Kirim Pesan dengan Enter</div>
                    <div className="text-xs text-muted-foreground">
                      Tekan Shift+Enter untuk baris baru
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.sendOnEnter}
                    onChange={(e) => updateSettings({ sendOnEnter: e.target.checked })}
                    className="w-4 h-4 accent-primary rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">Judul Percakapan Otomatis</div>
                    <div className="text-xs text-muted-foreground">
                      Buat judul otomatis dari pesan pertama
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.autoTitle}
                    onChange={(e) => updateSettings({ autoTitle: e.target.checked })}
                    className="w-4 h-4 accent-primary rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">Tampilkan Waktu Pesan</div>
                    <div className="text-xs text-muted-foreground">
                      Tampilkan jam pengiriman di bawah setiap pesan
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.showTimestamps}
                    onChange={(e) => updateSettings({ showTimestamps: e.target.checked })}
                    className="w-4 h-4 accent-primary rounded"
                  />
                </div>
              </div>
            )}

            {/* 3. CHAT & PERSONA TAB */}
            {activeTab === 'chat' && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">Streaming Respons (SSE)</div>
                    <div className="text-xs text-muted-foreground">
                      Tampilkan kata demi kata secara real-time
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.streamResponses}
                    onChange={(e) => updateSettings({ streamResponses: e.target.checked })}
                    className="w-4 h-4 accent-primary rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">Nomor Baris pada Blok Kode</div>
                    <div className="text-xs text-muted-foreground">
                      Tampilkan penomoran baris di sebelah kiri kode
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.codeLineNumbers}
                    onChange={(e) => updateSettings({ codeLineNumbers: e.target.checked })}
                    className="w-4 h-4 accent-primary rounded"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div className="p-3 rounded-xl border border-border bg-muted/20">
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground">Temperature</span>
                      <span className="font-mono font-semibold">{temperature}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.05"
                      value={temperature}
                      onChange={(e) =>
                        setParameters({ temperature: parseFloat(e.target.value) })
                      }
                      className="w-full accent-primary"
                    />
                  </div>

                  <div className="p-3 rounded-xl border border-border bg-muted/20">
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground">Top P</span>
                      <span className="font-mono font-semibold">{topP}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={topP}
                      onChange={(e) => setParameters({ topP: parseFloat(e.target.value) })}
                      className="w-full accent-primary"
                    />
                  </div>

                  <div className="p-3 rounded-xl border border-border bg-muted/20">
                    <div className="text-xs text-muted-foreground mb-1">Tingkat Penalaran</div>
                    <select
                      value={reasoningEffort || 'default'}
                      onChange={(e) =>
                        setParameters({
                          reasoningEffort:
                            e.target.value === 'default' ? undefined : e.target.value,
                        })
                      }
                      className="w-full p-1 rounded border border-border bg-background text-foreground text-xs"
                    >
                      <option value="default">Default</option>
                      <option value="low">Low (Cepat)</option>
                      <option value="medium">Medium (Seimbang)</option>
                      <option value="high">High (Mendalam)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="font-medium text-foreground">
                      Preset Persona & Instruksi Sistem Global
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2.5">
                    {PERSONA_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => updateSettings({ systemPrompt: preset.prompt })}
                        className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                          settings.systemPrompt === preset.prompt
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted/40 hover:bg-muted text-muted-foreground'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={settings.systemPrompt}
                    onChange={(e) => updateSettings({ systemPrompt: e.target.value })}
                    placeholder="Tulis instruksi khusus untuk asisten AI di seluruh sesi..."
                    rows={4}
                    className="w-full p-3 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                  />
                </div>
              </div>
            )}

            {/* 4. MEMORY TAB */}
            {activeTab === 'memory' && (
              <div className="space-y-5">
                <div className="p-4 rounded-xl border border-border bg-muted/20 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                      <Brain className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">Aktifkan memori jangka panjang</div>
                      <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        AI mengingat nama, pekerjaan, hobi, preferensi, lokasi, dan proyek Anda
                        di semua percakapan. Fakta baru ditangkap otomatis dari obrolan.
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.memoryEnabled}
                    onChange={(e) => updateSettings({ memoryEnabled: e.target.checked })}
                    className="w-4 h-4 mt-1 accent-primary rounded shrink-0"
                    title="Aktifkan/nonaktifkan memori"
                  />
                </div>

                <div className="p-4 rounded-xl border border-border bg-card">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <Sparkles className="w-4 h-4 text-primary" />
                    Tambah memori manual
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Berguna untuk fakta penting yang ingin selalu diingat. Jangan simpan kata sandi,
                    OTP, token, atau data sensitif.
                  </p>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-[140px_1fr_auto] gap-2">
                    <select
                      value={memoryCategory}
                      onChange={(e) => setMemoryCategory(e.target.value)}
                      className="p-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {MEMORY_CATEGORY_OPTIONS.map((cat) => (
                        <option key={cat.value} value={cat.value}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={memoryContent}
                      onChange={(e) => setMemoryContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddMemory();
                      }}
                      placeholder="Contoh: Hobi saya membaca buku sejarah"
                      maxLength={280}
                      className="p-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      type="button"
                      onClick={handleAddMemory}
                      disabled={memorySaving || memoryContent.trim().length < 2}
                      className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary-hover disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {memorySaving ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5" />
                      )}
                      <span>Simpan</span>
                    </button>
                  </div>
                  {memoryError && (
                    <div className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{memoryError}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">
                    {memories.length > 0
                      ? `${memories.length} memori tersimpan`
                      : 'Belum ada memori tersimpan'}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleImportMemories}
                      disabled={memoryImporting || memoriesLoading}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg border border-primary/40 bg-primary/10 text-primary text-[11px] font-medium hover:bg-primary/20 disabled:opacity-50"
                      title="Pindai percakapan lama untuk fakta tentang Anda"
                    >
                      {memoryImporting ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      <span>Impor riwayat</span>
                    </button>
                    <button
                      type="button"
                      onClick={fetchMemories}
                      disabled={memoriesLoading || memoryImporting}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg border border-border bg-background text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${memoriesLoading ? 'animate-spin' : ''}`} />
                      <span>Muat ulang</span>
                    </button>
                  </div>
                </div>

                {memories.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
                    <button
                      type="button"
                      onClick={() => setMemoryFilterCategory('all')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                        memoryFilterCategory === 'all'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      Semua ({memories.length})
                    </button>
                    {MEMORY_CATEGORY_ORDER.map((catKey) => {
                      const count = memories.filter((m) => m.category === catKey).length;
                      if (count === 0) return null;
                      const meta = MEMORY_CATEGORY_META[catKey] || {
                        label: catKey,
                        icon: FileText,
                        color: 'text-muted-foreground',
                      };
                      const CatIcon = meta.icon;
                      const active = memoryFilterCategory === catKey;
                      return (
                        <button
                          key={catKey}
                          type="button"
                          onClick={() => setMemoryFilterCategory(catKey)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                            active
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`}
                        >
                          <CatIcon className="w-3.5 h-3.5" />
                          <span>{meta.label}</span>
                          <span className="text-[10px] opacity-80">({count})</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {memoriesLoading ? (
                  <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Memuat memori...</span>
                  </div>
                ) : memories.length === 0 ? (
                  <div className="p-6 rounded-xl border border-dashed border-border text-center">
                    <Brain className="w-7 h-7 mx-auto text-muted-foreground/60" />
                    <div className="mt-2 text-xs text-muted-foreground">
                      Belum ada yang diingat. Ceritakan nama, pekerjaan, atau hobi Anda di chat,
                      atau tambahkan manual di atas.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {MEMORY_CATEGORY_ORDER.filter(
                      (catKey) =>
                        (memoryFilterCategory === 'all' || memoryFilterCategory === catKey) &&
                        memories.some((m) => m.category === catKey)
                    ).map((catKey) => {
                      const items = memories.filter((m) => m.category === catKey);
                      const meta = MEMORY_CATEGORY_META[catKey] || {
                        label: catKey,
                        icon: FileText,
                        color: 'text-muted-foreground',
                        badge: 'bg-muted text-muted-foreground border-border',
                      };
                      const CatIcon = meta.icon;

                      return (
                        <div key={catKey} className="space-y-2">
                          {/* Baris Title Header Kategori yang Rapi */}
                          <div className="flex items-center justify-between px-1 pt-1 pb-1 border-b border-border/50">
                            <div className="flex items-center gap-2">
                              <CatIcon className={`w-4 h-4 ${meta.color}`} />
                              <span className="text-xs font-semibold text-foreground tracking-wide">
                                {meta.label}
                              </span>
                              <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded-full bg-muted/80 text-muted-foreground border border-border/60">
                                {items.length}
                              </span>
                            </div>
                          </div>

                          {/* Daftar Kartu Memori */}
                          <div className="space-y-2">
                            {items.map((memory) => {
                              const isEditing = editingMemoryId === memory.id;
                              return (
                                <div
                                  key={memory.id}
                                  className="p-3 rounded-xl border border-border bg-card flex items-start gap-3 transition-colors hover:border-border/80"
                                >
                                  {isEditing ? (
                                    <div className="flex-1 min-w-0 space-y-2">
                                      <div className="flex flex-col sm:flex-row gap-2">
                                        <select
                                          value={editMemoryCategory}
                                          onChange={(e) => setEditMemoryCategory(e.target.value)}
                                          className="w-full sm:w-[150px] p-1.5 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                        >
                                          {MEMORY_CATEGORY_OPTIONS.map((cat) => (
                                            <option key={cat.value} value={cat.value}>
                                              {cat.label}
                                            </option>
                                          ))}
                                        </select>
                                        <input
                                          type="text"
                                          value={editMemoryContent}
                                          onChange={(e) => setEditMemoryContent(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleUpdateMemory();
                                            if (e.key === 'Escape') cancelEditMemory();
                                          }}
                                          maxLength={280}
                                          className="flex-1 min-w-0 p-1.5 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                      </div>
                                      <div className="flex items-center justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={cancelEditMemory}
                                          className="px-2.5 py-1.5 rounded-lg border border-border bg-background text-[11px] text-muted-foreground hover:text-foreground"
                                        >
                                          Batal
                                        </button>
                                        <button
                                          type="button"
                                          onClick={handleUpdateMemory}
                                          disabled={
                                            memoryUpdating || editMemoryContent.trim().length < 2
                                          }
                                          className="px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary-hover disabled:opacity-50 flex items-center gap-1"
                                        >
                                          {memoryUpdating ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <Check className="w-3 h-3" />
                                          )}
                                          <span>Simpan</span>
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <span
                                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border shrink-0 ${meta.badge}`}
                                      >
                                        {meta.label}
                                      </span>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs text-foreground break-words leading-relaxed font-normal">
                                          {memory.content}
                                        </div>
                                        <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1.5">
                                          <span>
                                            {memory.source === 'manual'
                                              ? 'Manual'
                                              : memory.source === 'user'
                                                ? 'Dari chat'
                                                : 'Otomatis'}
                                          </span>
                                          <span>·</span>
                                          <span>
                                            {new Date(memory.updatedAt).toLocaleDateString(
                                              'id-ID',
                                              {
                                                day: 'numeric',
                                                month: 'short',
                                                year: 'numeric',
                                              }
                                            )}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0">
                                        <button
                                          type="button"
                                          onClick={() => startEditMemory(memory)}
                                          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
                                          title="Edit memori ini"
                                        >
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteMemory(memory.id)}
                                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                          title="Hapus memori ini"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {memories.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearMemories}
                    className="w-full px-3 py-2 rounded-xl border border-destructive/30 bg-destructive/5 text-destructive text-xs font-medium hover:bg-destructive/10 flex items-center justify-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Hapus semua memori
                  </button>
                )}

                <div className="p-3 rounded-xl border border-border bg-muted/20 text-[11px] text-muted-foreground leading-relaxed">
                  Memori bersifat pribadi per akun dan hanya dipakai untuk percakapan Anda.
                  Menonaktifkan memori menghentikan penyimpanan serta penyuntikan memori ke prompt,
                  tetapi daftar lama tetap tersimpan sampai Anda menghapusnya.
                  <br />
                  Tip: ketik <code className="px-1 py-0.5 rounded bg-background border border-border">/ingat fakta yang ingin diingat</code> langsung di chat untuk menyimpan lebih cepat.
                </div>
              </div>
            )}

            {/* 5. SKILLS & TOOLS TAB */}
            {activeTab === 'skills' && (
              <div className="space-y-5">
                <div className="p-4 rounded-xl border border-border bg-muted/20 flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="font-semibold text-foreground text-sm">
                      Katalog 78 Modul Skill Server
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Baca dokumentasi skill, sisipkan ke chat, atau edit langsung file{' '}
                      <code className="font-mono">SKILL.md</code> di{' '}
                      <code className="font-mono">/root/ai-chat/skills/</code>.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsOpen(false);
                      setSkillsDialogOpen(true);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary-hover shrink-0 transition-colors"
                  >
                    Buka Katalog Skill
                  </button>
                </div>

                <div>
                  <div className="font-medium text-foreground mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Alat Otomasi Bawaan (Aktif)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {[
                      { tag: '[CARI_WEB]', desc: 'Pencarian internet real-time' },
                      { tag: '[BUKA_WEB]', desc: 'Ekstraksi isi halaman web & artikel' },
                      { tag: '[CEK_CUACA]', desc: 'Prakiraan cuaca Open-Meteo & GPS' },
                      { tag: '[AMBIL_SUBTITEL]', desc: 'Transkrip video YouTube / TikTok / IG' },
                      { tag: '[BACA_SKILL]', desc: 'Muat panduan modul skill server' },
                      { tag: '[INSTALL_SKILL]', desc: 'Buat atau perbarui modul skill (Admin)' },
                      { tag: '[RUN_BASH]', desc: 'Eksekusi perintah terminal Ubuntu (Admin)' },
                      { tag: '[BROWSER]', desc: 'Otomasi Chromium Playwright (Admin)' },
                    ].map((tool) => (
                      <div
                        key={tool.tag}
                        className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-background/60"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Terminal className="w-3.5 h-3.5 text-primary shrink-0" />
                          <div className="truncate">
                            <span className="font-mono font-semibold text-foreground">
                              {tool.tag}
                            </span>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {tool.desc}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 5. PROVIDERS TAB */}
            {activeTab === 'providers' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    Tambah endpoint OpenAI, gateway AI, atau Anthropic.
                  </div>
                  {!addingProvider && (
                    <button
                      type="button"
                      onClick={() => setAddingProvider(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary-hover transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah Provider</span>
                    </button>
                  )}
                </div>

                {addingProvider && (
                  <form
                    onSubmit={handleSaveProvider}
                    className="p-4 rounded-xl border border-primary/40 bg-muted/20 space-y-3"
                  >
                    <div className="font-semibold text-foreground text-xs uppercase tracking-wide">
                      Hubungkan Provider Baru
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">
                          Nama Provider
                        </label>
                        <input
                          type="text"
                          placeholder="cth. VPS AI / vLLM / Ollama"
                          value={providerForm.name}
                          onChange={(e) =>
                            setProviderForm({ ...providerForm, name: e.target.value })
                          }
                          required
                          className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">
                          Protokol
                        </label>
                        <select
                          value={providerForm.protocol}
                          onChange={(e) =>
                            setProviderForm({
                              ...providerForm,
                              protocol: e.target.value as any,
                            })
                          }
                          className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-xs"
                        >
                          <option value="openai-compatible">
                            OpenAI Compatible (vLLM, Ollama, xKiro, Vyce)
                          </option>
                          <option value="antigravity-agent">
                            Antigravity Native Agent (Tools, Bash, Skills)
                          </option>
                          <option value="anthropic-compatible">Anthropic Compatible</option>
                          <option value="mock">Development Mock</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        Base URL
                      </label>
                      <input
                        type="url"
                        placeholder="http://127.0.0.1:8000/v1 atau https://..."
                        value={providerForm.baseUrl}
                        onChange={(e) =>
                          setProviderForm({ ...providerForm, baseUrl: e.target.value })
                        }
                        required
                        className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">
                        API Key (Tersimpan di Server)
                      </label>
                      <input
                        type="password"
                        placeholder="sk-... (opsional untuk model lokal)"
                        value={providerForm.apiKey}
                        onChange={(e) =>
                          setProviderForm({ ...providerForm, apiKey: e.target.value })
                        }
                        className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-xs font-mono"
                      />
                    </div>

                    <div className="pt-1 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={handleTestConnection}
                        disabled={testStatus?.loading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-xs font-medium text-foreground transition-colors"
                      >
                        {testStatus?.loading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : null}
                        <span>Tes Koneksi</span>
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setAddingProvider(false);
                            setTestStatus(null);
                          }}
                          className="px-3 py-1.5 text-xs rounded-lg hover:bg-muted text-muted-foreground"
                        >
                          Batal
                        </button>
                        <button
                          type="submit"
                          className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary-hover"
                        >
                          Simpan
                        </button>
                      </div>
                    </div>

                    {testStatus && !testStatus.loading && (
                      <div
                        className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                          testStatus.ok
                            ? 'bg-primary/10 text-primary border border-primary/25'
                            : 'bg-destructive/10 text-destructive border border-destructive/20'
                        }`}
                      >
                        {testStatus.ok ? (
                          <Check className="w-4 h-4 shrink-0" />
                        ) : (
                          <AlertCircle className="w-4 h-4 shrink-0" />
                        )}
                        <span>{testStatus.message}</span>
                      </div>
                    )}
                  </form>
                )}

                <div className="space-y-3">
                  {providers.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-xl border border-border bg-card shadow-2xs overflow-hidden"
                    >
                      <div className="flex items-center justify-between p-4">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground">{p.name}</span>
                            {p.isDefault && (
                              <span className="px-2 py-0.5 rounded-md bg-primary/15 text-primary text-[10px] font-bold uppercase">
                                Default
                              </span>
                            )}
                            {p.isSystem && (
                              <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px] font-medium uppercase">
                                System
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono truncate">
                            {p.baseUrl}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {p.modelsCount || 0} model · {p.protocol}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 ml-3 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleRefreshModels(p.id, p.name)}
                            disabled={refreshingProviderId === p.id}
                            className={`p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${
                              refreshingProviderId === p.id ? 'opacity-50 cursor-not-allowed' : ''
                            }`}
                            title="Perbarui daftar model"
                          >
                            <RefreshCw
                              className={`w-4 h-4 ${
                                refreshingProviderId === p.id ? 'animate-spin text-primary' : ''
                              }`}
                            />
                          </button>
                          {p.protocol !== 'antigravity-agent' && p.protocol !== 'mock' && (
                            <button
                              type="button"
                              onClick={() => handleCheckCredit(p.id)}
                              disabled={checkingCreditId === p.id}
                              className={`p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ${
                                checkingCreditId === p.id ? 'opacity-50 cursor-not-allowed' : ''
                              }`}
                              title="Cek Saldo / Kredit"
                            >
                              <Wallet
                                className={`w-4 h-4 ${
                                  checkingCreditId === p.id ? 'animate-pulse text-primary' : ''
                                }`}
                              />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              editingProviderId === p.id
                                ? setEditingProviderId(null)
                                : startEditProvider(p)
                            }
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Edit provider"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteProvider(p.id, p.name)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                            title="Hapus provider"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {editingProviderId === p.id && (
                        <div className="border-t border-border p-4 bg-muted/20 space-y-3">
                          <div className="text-xs font-semibold text-foreground uppercase tracking-wide">
                            Edit Provider
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-muted-foreground mb-1">
                                Nama Tampilan
                              </label>
                              <input
                                type="text"
                                value={editProviderForm.name}
                                onChange={(e) =>
                                  setEditProviderForm({
                                    ...editProviderForm,
                                    name: e.target.value,
                                  })
                                }
                                className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-muted-foreground mb-1">
                                Base URL
                              </label>
                              <input
                                type="url"
                                value={editProviderForm.baseUrl}
                                onChange={(e) =>
                                  setEditProviderForm({
                                    ...editProviderForm,
                                    baseUrl: e.target.value,
                                  })
                                }
                                className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-xs"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">
                              API Key Baru{' '}
                              <span className="text-muted-foreground/60 font-normal">
                                (kosongkan jika tidak diubah)
                              </span>
                            </label>
                            <input
                              type="password"
                              placeholder="sk-..."
                              value={editProviderForm.apiKey}
                              onChange={(e) =>
                                setEditProviderForm({
                                  ...editProviderForm,
                                  apiKey: e.target.value,
                                })
                              }
                              className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-xs font-mono"
                            />
                          </div>
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => setEditingProviderId(null)}
                              className="px-3 py-1.5 text-xs rounded-lg hover:bg-muted text-muted-foreground"
                            >
                              Batal
                            </button>
                            <button
                              type="button"
                              onClick={handleSaveEditProvider}
                              disabled={editSaving}
                              className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary-hover disabled:opacity-60 flex items-center gap-1.5"
                            >
                              {editSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                              Simpan Perubahan
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 5b. VAULT & EMAIL CREDENTIALS TAB */}
            {activeTab === 'vault' && (
              <div className="space-y-5">
                <div className="p-4 rounded-xl border border-primary/30 bg-primary/10 flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="font-semibold text-foreground text-sm flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-primary" />
                      Brankas Kredensial & Sandi Email (Vault)
                    </div>
                    <div className="text-xs text-muted-foreground leading-relaxed">
                      Kelola beberapa akun sandi email (IMAP) dan akun login web terenkripsi AES-256-GCM. Digunakan oleh Playwright Browser Agent dan pembaca kode verifikasi OTP otomatis.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsOpen(false);
                      setVaultDialogOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shrink-0 shadow-sm"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Buka Brankas Vault</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-1.5">
                    <div className="font-semibold text-foreground flex items-center gap-2">
                      <Mail className="w-4 h-4 text-primary" />
                      Sandi Email & OTP (IMAP)
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Mendukung Google/Gmail (App Password), Outlook, Yahoo, dan Custom IMAP. Dilengkapi pengujian koneksi live dan pembacaan OTP.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-1.5">
                    <div className="font-semibold text-foreground flex items-center gap-2">
                      <Globe className="w-4 h-4 text-primary" />
                      Kredensial Login Web
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Sandi akun login website (TikTok, Shopee, Google) yang ditautkan ke akun email OTP untuk login otomatis aman.
                    </p>
                  </div>
                </div>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsOpen(false);
                      setVaultDialogOpen(true);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-card hover:bg-muted text-foreground text-xs font-medium transition-colors"
                  >
                    <span>Kelola & Isi Sandi Email Sekarang</span>
                    <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
              </div>
            )}

            {/* 6. DATA & BACKUP TAB */}
            {activeTab === 'data' && (
              <div className="space-y-5">
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-xl border border-border bg-muted/20">
                    <div className="text-xs text-muted-foreground">Total Percakapan</div>
                    <div className="text-lg font-bold font-mono text-foreground mt-0.5">
                      {conversations.length}
                    </div>
                  </div>
                  <div className="p-3.5 rounded-xl border border-border bg-muted/20">
                    <div className="text-xs text-muted-foreground">Provider Aktif</div>
                    <div className="text-lg font-bold font-mono text-foreground mt-0.5">
                      {providers.length}
                    </div>
                  </div>
                  <div className="p-3.5 rounded-xl border border-border bg-muted/20">
                    <div className="text-xs text-muted-foreground">Model Tersedia</div>
                    <div className="text-lg font-bold font-mono text-foreground mt-0.5">
                      {models.length}
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-border bg-muted/20 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-foreground text-xs sm:text-sm">
                      Cadangkan Semua Data (.json)
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Unduh seluruh daftar percakapan dan pengaturan ke perangkat Anda.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportAllData}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary-hover shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Ekspor JSON</span>
                  </button>
                </div>

                <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/5 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-foreground text-xs sm:text-sm">
                      Bersihkan Semua Riwayat Chat
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Hapus seluruh percakapan aktif di daftar saat ini secara permanen.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearAllConversations}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-destructive text-destructive-foreground text-xs font-medium hover:opacity-90 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Hapus Semua</span>
                  </button>
                </div>
              </div>
            )}

            {/* 7. SHORTCUTS TAB */}
            {activeTab === 'shortcuts' && (
              <div className="space-y-3">
                <div className="divide-y divide-border text-xs">
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-foreground">Palet Perintah & Pencarian Cepat</span>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border font-mono text-[11px]">
                      Ctrl + K
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-foreground">Percakapan Baru</span>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border font-mono text-[11px]">
                      Ctrl + Shift + O
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-foreground">Menu Cepat Alat & Skill di Composer</span>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border font-mono text-[11px]">
                      /
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-foreground">Hentikan Generasi Jawaban</span>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border font-mono text-[11px]">
                      Escape
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-foreground">Buka / Tutup Sidebar</span>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border font-mono text-[11px]">
                      Ctrl + B
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-foreground">Kirim Pesan</span>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border font-mono text-[11px]">
                      Ctrl + Enter
                    </kbd>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
