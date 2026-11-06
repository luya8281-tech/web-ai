'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  KeyRound,
  Mail,
  Globe,
  ShieldCheck,
  Plus,
  Trash2,
  Edit2,
  RefreshCw,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  Copy,
  ExternalLink,
  Lock,
  Search,
  Sparkles,
  CheckCircle2,
  HelpCircle,
  Fingerprint,
  Zap,
  Cookie,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useAuthStore } from '@/stores/auth-store';

interface EmailItem {
  label: string;
  email: string;
  password?: string;
  provider: 'gmail' | 'outlook' | 'yahoo' | 'custom';
  host: string;
  port: number;
  ssl: boolean;
  mailbox?: string;
  senders?: string[];
  description?: string;
  updatedAt?: string;
}

interface WebItem {
  name: string;
  url: string;
  username: string;
  password?: string;
  email?: string;
  userSelector?: string;
  passSelector?: string;
  submitSelector?: string;
  updatedAt?: string;
}

interface CookieItem {
  platform: string;
  value?: string;
  masked?: string;
  keyCount: number;
  note?: string;
  updatedAt: number;
  appliedFile?: string;
}

interface PlatformMeta {
  label: string;
  domains: string[];
  cookieFile: string;
  syncEnv?: boolean;
}

interface VaultStats {
  totalEmails: number;
  totalCredentials: number;
  totalCookies?: number;
  encryption: string;
  keyFile: string;
  vaultFile: string;
  otpActive: boolean;
  lastUpdated: string;
}

const PROVIDER_PRESETS: Record<
  string,
  { name: string; host: string; port: number; ssl: boolean; hint: string }
> = {
  gmail: {
    name: 'Google / Gmail',
    host: 'imap.gmail.com',
    port: 993,
    ssl: true,
    hint: 'Gunakan Sandi Aplikasi (App Password 16 huruf) dari myaccount.google.com/apppasswords.',
  },
  outlook: {
    name: 'Microsoft Outlook / Hotmail',
    host: 'outlook.office365.com',
    port: 993,
    ssl: true,
    hint: 'Pastikan akses IMAP aktif di pengaturan akun Microsoft Anda.',
  },
  yahoo: {
    name: 'Yahoo Mail',
    host: 'imap.mail.yahoo.com',
    port: 993,
    ssl: true,
    hint: 'Gunakan Kata Sandi Aplikasi (Generate App Password) dari Keamanan Akun Yahoo.',
  },
  custom: {
    name: 'Custom IMAP Server',
    host: '',
    port: 993,
    ssl: true,
    hint: 'Masukkan alamat host dan port server IMAP penyedia email Anda.',
  },
};

export const VaultDialog: React.FC = () => {
  const { vaultDialogOpen, setVaultDialogOpen, addToast } = useUIStore();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [activeTab, setActiveTab] = useState<'emails' | 'web' | 'cookies' | 'security'>('emails');
  const [loading, setLoading] = useState(false);
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [credentials, setCredentials] = useState<WebItem[]>([]);
  const [cookies, setCookies] = useState<CookieItem[]>([]);
  const [platforms, setPlatforms] = useState<Record<string, PlatformMeta>>({});
  const [showCookieForm, setShowCookieForm] = useState(false);
  const [cookieForm, setCookieForm] = useState({ platform: 'instagram', value: '', note: '', apply: true });
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [search, setSearch] = useState('');

  // Passwords visibility state by item ID
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);

  // Email form state
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [editingEmailLabel, setEditingEmailLabel] = useState<string | null>(null);
  const [emailForm, setEmailForm] = useState<{
    label: string;
    email: string;
    password: string;
    provider: 'gmail' | 'outlook' | 'yahoo' | 'custom';
    host: string;
    port: number;
    ssl: boolean;
    mailbox: string;
    senders: string;
    description: string;
  }>({
    label: '',
    email: '',
    password: '',
    provider: 'gmail',
    host: 'imap.gmail.com',
    port: 993,
    ssl: true,
    mailbox: 'INBOX',
    senders: '',
    description: '',
  });

  // Web credential form state
  const [showWebForm, setShowWebForm] = useState(false);
  const [editingWebName, setEditingWebName] = useState<string | null>(null);
  const [webForm, setWebForm] = useState({
    name: '',
    url: '',
    username: '',
    password: '',
    email: '',
  });

  // Testing IMAP state
  const [testingLabel, setTestingLabel] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ label: string; ok: boolean; msg: string } | null>(null);

  // OTP check state
  const [checkingOtpLabel, setCheckingOtpLabel] = useState<string | null>(null);
  const [otpResult, setOtpResult] = useState<{ label: string; code?: string; from?: string; error?: string } | null>(null);

  const fetchVault = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/vault', { cache: 'no-store' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setEmails(data.emails || []);
      setCredentials(data.credentials || []);
      setCookies(data.cookies || []);
      setPlatforms(data.platforms || {});
      setStats(data.stats || null);
    } catch (err: any) {
      console.error('[Vault] Error fetching vault:', err);
      addToast(err.message || 'Gagal memuat data vault', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (vaultDialogOpen) {
      fetchVault();
    }
  }, [vaultDialogOpen, fetchVault]);

  const handleProviderSelect = (prov: 'gmail' | 'outlook' | 'yahoo' | 'custom') => {
    const preset = PROVIDER_PRESETS[prov];
    setEmailForm((prev) => ({
      ...prev,
      provider: prov,
      host: preset.host || prev.host,
      port: preset.port,
      ssl: preset.ssl,
    }));
  };

  const handleOpenAddEmail = () => {
    setEditingEmailLabel(null);
    setEmailForm({
      label: '',
      email: '',
      password: '',
      provider: 'gmail',
      host: 'imap.gmail.com',
      port: 993,
      ssl: true,
      mailbox: 'INBOX',
      senders: '',
      description: '',
    });
    setTestResult(null);
    setShowEmailForm(true);
  };

  const handleOpenEditEmail = (acc: EmailItem) => {
    setEditingEmailLabel(acc.label);
    setEmailForm({
      label: acc.label,
      email: acc.email,
      password: '', // Biarkan kosong jika tidak diubah
      provider: acc.provider || 'gmail',
      host: acc.host || 'imap.gmail.com',
      port: acc.port || 993,
      ssl: acc.ssl !== false,
      mailbox: acc.mailbox || 'INBOX',
      senders: (acc.senders || []).join(', '),
      description: acc.description || '',
    });
    setTestResult(null);
    setShowEmailForm(true);
  };

  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailForm.label || !emailForm.email) {
      addToast('Label dan email wajib diisi', 'error');
      return;
    }

    try {
      const res = await fetch('/api/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'email',
          label: emailForm.label,
          email: emailForm.email,
          password: emailForm.password,
          provider: emailForm.provider,
          host: emailForm.host,
          port: emailForm.port,
          ssl: emailForm.ssl,
          mailbox: emailForm.mailbox,
          senders: emailForm.senders,
          description: emailForm.description,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan');

      addToast(data.message || 'Sandi email berhasil disimpan ke Vault!', 'success');
      setShowEmailForm(false);
      fetchVault();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleDeleteEmail = async (label: string) => {
    if (!confirm(`Hapus akun email "${label}" dari Vault?`)) return;
    try {
      const res = await fetch(`/api/vault?type=email&id=${encodeURIComponent(label)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus');
      addToast(data.message || 'Akun email dihapus.', 'info');
      fetchVault();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleSaveCookie = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'cookie', ...cookieForm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan cookie');
      addToast(data.message || 'Cookie disimpan.', 'success');
      setShowCookieForm(false);
      setCookieForm({ platform: 'instagram', value: '', note: '', apply: true });
      fetchVault();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleApplyCookie = async (platform: string) => {
    try {
      const res = await fetch('/api/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'cookie', action: 'apply', platform }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.applied?.error || 'Gagal menerapkan cookie');
      addToast(
        `Cookie ${platforms[platform]?.label || platform} diterapkan ke ${data.applied?.file}` +
          (data.applied?.sessionSynced ? ' (+ .env disinkronkan)' : ''),
        'success'
      );
      fetchVault();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleDeleteCookie = async (platform: string) => {
    if (!confirm(`Hapus cookie "${platforms[platform]?.label || platform}" dari Vault?`)) return;
    try {
      const res = await fetch(`/api/vault?type=cookie&id=${encodeURIComponent(platform)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus');
      addToast(data.message || 'Cookie dihapus.', 'info');
      fetchVault();
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleTestImap = async (params: {
    label?: string;
    host?: string;
    port?: number;
    ssl?: boolean;
    email?: string;
    password?: string;
  }) => {
    const targetLabel = params.label || 'form';
    setTestingLabel(targetLabel);
    setTestResult(null);
    try {
      const res = await fetch('/api/vault/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      setTestResult({
        label: targetLabel,
        ok: Boolean(data.ok),
        msg: data.ok ? data.message || 'Koneksi IMAP berhasil!' : data.error || 'Gagal autentikasi IMAP.',
      });
      if (data.ok) {
        addToast('Koneksi IMAP Sukses & Sandi Terverifikasi!', 'success');
      } else {
        addToast(data.error || 'Autentikasi IMAP Gagal', 'error');
      }
    } catch (err: any) {
      setTestResult({
        label: targetLabel,
        ok: false,
        msg: err.message || 'Gagal menghubungi server.',
      });
      addToast(err.message || 'Gagal tes koneksi', 'error');
    } finally {
      setTestingLabel(null);
    }
  };

  const handleCheckOtp = async (label: string) => {
    setCheckingOtpLabel(label);
    setOtpResult(null);
    try {
      const res = await fetch('/api/vault/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, minutes: 20 }),
      });
      const data = await res.json();
      if (data.ok && data.code) {
        setOtpResult({ label, code: data.code, from: data.from });
        addToast(`Kode OTP Ditemukan: ${data.code}`, 'success');
      } else {
        setOtpResult({ label, error: data.error || 'Tidak ada kode OTP dalam 20 menit terakhir.' });
        addToast(data.error || 'Kode OTP tidak ditemukan', 'info');
      }
    } catch (err: any) {
      setOtpResult({ label, error: err.message });
      addToast(err.message || 'Gagal memeriksa OTP', 'error');
    } finally {
      setCheckingOtpLabel(null);
    }
  };

  const handleToggleReveal = async (type: 'email' | 'web', id: string) => {
    const key = `${type}_${id}`;
    if (revealedPasswords[key]) {
      setRevealedPasswords((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    setRevealingId(key);
    try {
      const res = await fetch('/api/vault?reveal=true');
      const data = await res.json();
      if (res.ok) {
        if (type === 'email') {
          const item = (data.emails || []).find((e: EmailItem) => e.label === id);
          if (item?.password) {
            setRevealedPasswords((prev) => ({ ...prev, [key]: item.password }));
          }
        } else {
          const item = (data.credentials || []).find((w: WebItem) => w.name === id);
          if (item?.password) {
            setRevealedPasswords((prev) => ({ ...prev, [key]: item.password }));
          }
        }
      }
    } catch {
      addToast('Gagal membuka sandi', 'error');
    } finally {
      setRevealingId(null);
    }
  };

  const handleCopyPassword = async (pass: string, label: string) => {
    if (!pass || pass === '••••••••') {
      addToast('Buka ikon mata terlebih dahulu untuk menyalin sandi', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(pass);
      addToast(`Sandi akun "${label}" disalin ke clipboard`, 'success');
    } catch {
      addToast('Gagal menyalin ke clipboard', 'error');
    }
  };

  // Filtered emails
  const filteredEmails = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return emails;
    return emails.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        (e.description && e.description.toLowerCase().includes(q))
    );
  }, [emails, search]);

  if (!vaultDialogOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-3xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-card/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/15 text-primary border border-primary/20">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">Brankas Kredensial & Email (Vault)</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                  AES-256-GCM
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Simpan beberapa sandi email & akun login web terenkripsi secara aman untuk otomasi AI & OTP.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setVaultDialogOpen(false)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-border bg-muted/20 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setActiveTab('emails');
                setShowEmailForm(false);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeTab === 'emails'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Sandi Email & OTP (IMAP)</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-background/20 font-mono">
                {emails.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('web');
                setShowWebForm(false);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeTab === 'web'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Akun Login Web</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-background/20 font-mono">
                {credentials.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('cookies');
                setShowCookieForm(false);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeTab === 'cookies'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              }`}
            >
              <Cookie className="w-3.5 h-3.5" />
              <span>Cookies Sosmed</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-background/20 font-mono">
                {cookies.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('security')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeTab === 'security'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Status Keamanan</span>
            </button>
          </div>

          <button
            type="button"
            onClick={fetchVault}
            disabled={loading}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            title="Segarkan data vault"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* TAB 1: SANDI EMAIL & OTP */}
          {activeTab === 'emails' && (
            <div className="space-y-4">
              {/* Top Action bar */}
              <div className="flex items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cari label atau email..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-border bg-background text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                {!showEmailForm && (
                  <button
                    type="button"
                    onClick={handleOpenAddEmail}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-sm shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah Sandi Email</span>
                  </button>
                )}
              </div>

              {/* FORM TAMBAH / EDIT EMAIL */}
              {showEmailForm && (
                <form
                  onSubmit={handleSaveEmail}
                  className="p-4 rounded-xl border border-border bg-muted/20 space-y-4 animate-in fade-in"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-border">
                    <span className="font-semibold text-xs text-foreground flex items-center gap-2">
                      <Mail className="w-4 h-4 text-primary" />
                      {editingEmailLabel ? `Edit Sandi Email: ${editingEmailLabel}` : 'Tambah Akun Sandi Email Baru'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowEmailForm(false)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Batal
                    </button>
                  </div>

                  {/* Provider Presets */}
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">
                      Pilih Penyedia Layanan Email
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(Object.keys(PROVIDER_PRESETS) as Array<'gmail' | 'outlook' | 'yahoo' | 'custom'>).map((prov) => {
                        const isSel = emailForm.provider === prov;
                        return (
                          <button
                            key={prov}
                            type="button"
                            onClick={() => handleProviderSelect(prov)}
                            className={`p-2 rounded-lg border text-left text-xs transition-all ${
                              isSel
                                ? 'border-primary bg-primary/10 text-primary font-semibold shadow-sm'
                                : 'border-border bg-background/60 hover:bg-muted text-muted-foreground'
                            }`}
                          >
                            <div className="truncate font-medium">{PROVIDER_PRESETS[prov].name}</div>
                          </button>
                        );
                      })}
                    </div>
                    {PROVIDER_PRESETS[emailForm.provider]?.hint && (
                      <p className="text-[11px] text-amber-500/90 mt-1.5 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        {PROVIDER_PRESETS[emailForm.provider].hint}
                      </p>
                    )}
                  </div>

                  {/* Form Inputs Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-foreground mb-1">
                        Label Akun (ID Unik) *
                      </label>
                      <input
                        type="text"
                        required
                        disabled={Boolean(editingEmailLabel)}
                        value={emailForm.label}
                        onChange={(e) => setEmailForm({ ...emailForm, label: e.target.value })}
                        placeholder="contoh: tiktok_mail, vee_gmail"
                        className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-xs focus:ring-1 focus:ring-primary focus:outline-none font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-foreground mb-1">
                        Alamat Email *
                      </label>
                      <input
                        type="email"
                        required
                        value={emailForm.email}
                        onChange={(e) => setEmailForm({ ...emailForm, email: e.target.value })}
                        placeholder="contoh: vee@gmail.com"
                        className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-medium text-foreground mb-1">
                        Sandi / App Password *
                        {editingEmailLabel && (
                          <span className="text-[10px] text-muted-foreground font-normal ml-1">
                            (Kosongkan jika tidak ingin mengubah sandi lama)
                          </span>
                        )}
                      </label>
                      <input
                        type="password"
                        required={!editingEmailLabel}
                        value={emailForm.password}
                        onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })}
                        placeholder={editingEmailLabel ? '•••••••• (Sandi lama tetap aman)' : 'Masukkan sandi aplikasi 16 karakter atau password email'}
                        className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-xs focus:ring-1 focus:ring-primary focus:outline-none font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-foreground mb-1">
                        Host Server IMAP
                      </label>
                      <input
                        type="text"
                        value={emailForm.host}
                        onChange={(e) => setEmailForm({ ...emailForm, host: e.target.value })}
                        placeholder="imap.gmail.com"
                        className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-xs focus:ring-1 focus:ring-primary focus:outline-none font-mono"
                      />
                    </div>

                    <div className="flex gap-2">
                      <div className="w-24">
                        <label className="block text-[11px] font-medium text-foreground mb-1">
                          Port
                        </label>
                        <input
                          type="number"
                          value={emailForm.port}
                          onChange={(e) => setEmailForm({ ...emailForm, port: parseInt(e.target.value) || 993 })}
                          className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-xs focus:ring-1 focus:ring-primary focus:outline-none font-mono"
                        />
                      </div>
                      <div className="flex-1 flex items-end pb-2">
                        <label className="flex items-center gap-2 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={emailForm.ssl}
                            onChange={(e) => setEmailForm({ ...emailForm, ssl: e.target.checked })}
                            className="rounded border-border text-primary focus:ring-primary"
                          />
                          <span>Gunakan SSL / TLS</span>
                        </label>
                      </div>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-medium text-foreground mb-1">
                        Catatan / Kegunaan (Opsional)
                      </label>
                      <input
                        type="text"
                        value={emailForm.description}
                        onChange={(e) => setEmailForm({ ...emailForm, description: e.target.value })}
                        placeholder="contoh: Akun email untuk membaca kode verifikasi OTP TikTok & Google"
                        className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Test Result Message Box */}
                  {testResult && testResult.label === 'form' && (
                    <div
                      className={`p-3 rounded-lg text-xs flex items-start gap-2 border ${
                        testResult.ok
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                          : 'bg-destructive/10 border-destructive/30 text-destructive'
                      }`}
                    >
                      {testResult.ok ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      )}
                      <div>{testResult.msg}</div>
                    </div>
                  )}

                  {/* Form Action Buttons */}
                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      disabled={testingLabel === 'form' || !emailForm.email || (!editingEmailLabel && !emailForm.password)}
                      onClick={() =>
                        handleTestImap({
                          host: emailForm.host,
                          port: emailForm.port,
                          ssl: emailForm.ssl,
                          email: emailForm.email,
                          password: emailForm.password,
                          label: editingEmailLabel || undefined,
                        })
                      }
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-medium hover:bg-muted text-foreground transition-colors disabled:opacity-50"
                    >
                      <Zap className={`w-3.5 h-3.5 ${testingLabel === 'form' ? 'animate-pulse text-amber-500' : 'text-primary'}`} />
                      <span>{testingLabel === 'form' ? 'Menguji Koneksi...' : 'Uji Koneksi IMAP'}</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowEmailForm(false)}
                        className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted text-foreground transition-colors"
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-sm"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Simpan ke Brankas</span>
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* LIST DAFTAR AKUN EMAIL TERSIMPAN */}
              <div className="space-y-3">
                {filteredEmails.length === 0 && !showEmailForm && (
                  <div className="text-center py-12 px-4 rounded-xl border border-dashed border-border bg-muted/10 space-y-3">
                    <div className="p-3 rounded-full bg-primary/10 text-primary w-fit mx-auto">
                      <Mail className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold text-foreground">Belum ada sandi email di Vault</h4>
                      <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                        Tambahkan akun email Anda (Gmail, Outlook, Yahoo) agar AI dapat membaca OTP verifikasi atau mengelola akun Anda secara aman.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenAddEmail}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah Akun Email Pertama</span>
                    </button>
                  </div>
                )}

                {filteredEmails.map((item) => {
                  const revKey = `email_${item.label}`;
                  const isRevealed = Boolean(revealedPasswords[revKey]);
                  const passDisplay = isRevealed ? revealedPasswords[revKey] : '••••••••••••';
                  const isTestingThis = testingLabel === item.label;
                  const isCheckingOtp = checkingOtpLabel === item.label;

                  return (
                    <div
                      key={item.label}
                      className="p-4 rounded-xl border border-border bg-background/60 hover:bg-muted/30 transition-all space-y-3"
                    >
                      {/* Card Top: Label, Provider Badge, Actions */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold text-foreground">
                              {item.label}
                            </span>
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 uppercase font-mono">
                              {item.provider || 'IMAP'}
                            </span>
                            {item.ssl && (
                              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">
                                • SSL Aktif
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-foreground font-medium flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="select-all">{item.email}</span>
                          </div>
                          {item.description && (
                            <p className="text-[11px] text-muted-foreground line-clamp-1">
                              {item.description}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleOpenEditEmail(item)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Edit akun email"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteEmail(item.label)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Hapus akun dari vault"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Password Field Box */}
                      <div className="p-2.5 rounded-lg bg-muted/30 border border-border/60 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1 font-mono text-xs">
                          <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate select-all text-foreground font-semibold">
                            {passDisplay}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleToggleReveal('email', item.label)}
                            disabled={revealingId === revKey}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs flex items-center gap-1"
                            title={isRevealed ? 'Sembunyikan sandi' : 'Tampilkan sandi'}
                          >
                            {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCopyPassword(isRevealed ? revealedPasswords[revKey] : '', item.label)}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Salin sandi ke clipboard"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Card Bottom: Quick Actions (Test IMAP, Cek OTP) */}
                      <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground flex-wrap gap-2">
                        <div className="font-mono text-[10px]">
                          Host: {item.host}:{item.port}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isTestingThis}
                            onClick={() => handleTestImap({ label: item.label })}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors disabled:opacity-50"
                          >
                            <Zap className={`w-3 h-3 ${isTestingThis ? 'animate-pulse text-amber-500' : 'text-primary'}`} />
                            <span>{isTestingThis ? 'Menguji...' : 'Uji IMAP'}</span>
                          </button>

                          <button
                            type="button"
                            disabled={isCheckingOtp}
                            onClick={() => handleCheckOtp(item.label)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors disabled:opacity-50"
                          >
                            <Fingerprint className={`w-3 h-3 ${isCheckingOtp ? 'animate-spin text-primary' : 'text-primary'}`} />
                            <span>{isCheckingOtp ? 'Mencari...' : 'Cek OTP'}</span>
                          </button>
                        </div>
                      </div>

                      {/* Live Test / OTP Result for this card */}
                      {testResult && testResult.label === item.label && (
                        <div
                          className={`p-2.5 rounded-lg text-xs flex items-start gap-2 border animate-in fade-in ${
                            testResult.ok
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                              : 'bg-destructive/10 border-destructive/30 text-destructive'
                          }`}
                        >
                          {testResult.ok ? (
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          )}
                          <div>{testResult.msg}</div>
                        </div>
                      )}

                      {otpResult && otpResult.label === item.label && (
                        <div
                          className={`p-2.5 rounded-lg text-xs border animate-in fade-in ${
                            otpResult.code
                              ? 'bg-primary/10 border-primary/30 text-foreground'
                              : 'bg-muted/50 border-border text-muted-foreground'
                          }`}
                        >
                          {otpResult.code ? (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-primary">KODE OTP DITEMUKAN:</span>
                                <span className="text-base font-bold font-mono px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 select-all">
                                  {otpResult.code}
                                </span>
                              </div>
                              {otpResult.from && (
                                <div className="text-[11px] text-muted-foreground">Pengirim: {otpResult.from}</div>
                              )}
                            </div>
                          ) : (
                            <div>{otpResult.error || 'Tidak ada kode OTP terbaru.'}</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: AKUN LOGIN WEB */}
          {activeTab === 'web' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-foreground">Kredensial Login Situs Web (Browser Agent)</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Dipakai oleh browser-agent untuk login otomatis (&apos;[BROWSER: login nama_akun]&apos;).
                  </p>
                </div>

                {!showWebForm && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingWebName(null);
                      setWebForm({ name: '', url: '', username: '', password: '', email: '' });
                      setShowWebForm(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah Akun Web</span>
                  </button>
                )}
              </div>

              {/* Form Web */}
              {showWebForm && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      const res = await fetch('/api/vault', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          type: 'web',
                          name: webForm.name,
                          url: webForm.url,
                          username: webForm.username,
                          password: webForm.password,
                          email: webForm.email,
                        }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error);
                      addToast('Kredensial web disimpan ke Vault!', 'success');
                      setShowWebForm(false);
                      fetchVault();
                    } catch (err: any) {
                      addToast(err.message, 'error');
                    }
                  }}
                  className="p-4 rounded-xl border border-border bg-muted/20 space-y-3 animate-in fade-in"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[11px] font-medium text-foreground mb-1">
                        Nama Akun (ID Unik) *
                      </label>
                      <input
                        type="text"
                        required
                        disabled={Boolean(editingWebName)}
                        value={webForm.name}
                        onChange={(e) => setWebForm({ ...webForm, name: e.target.value })}
                        placeholder="contoh: tiktok, github, canva"
                        className="w-full px-3 py-1.5 rounded-lg border border-border bg-background font-mono focus:ring-1 focus:ring-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-foreground mb-1">
                        URL Halaman Login
                      </label>
                      <input
                        type="url"
                        value={webForm.url}
                        onChange={(e) => setWebForm({ ...webForm, url: e.target.value })}
                        placeholder="https://www.tiktok.com/login"
                        className="w-full px-3 py-1.5 rounded-lg border border-border bg-background focus:ring-1 focus:ring-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-foreground mb-1">
                        Username / Email
                      </label>
                      <input
                        type="text"
                        value={webForm.username}
                        onChange={(e) => setWebForm({ ...webForm, username: e.target.value })}
                        placeholder="user@example.com"
                        className="w-full px-3 py-1.5 rounded-lg border border-border bg-background focus:ring-1 focus:ring-primary focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-foreground mb-1">
                        Kata Sandi
                      </label>
                      <input
                        type="password"
                        value={webForm.password}
                        onChange={(e) => setWebForm({ ...webForm, password: e.target.value })}
                        placeholder={editingWebName ? '•••••••• (Biarkan jika tidak diubah)' : 'Kata sandi login web'}
                        className="w-full px-3 py-1.5 rounded-lg border border-border bg-background font-mono focus:ring-1 focus:ring-primary focus:outline-none"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-medium text-foreground mb-1">
                        Tautkan ke Akun Email OTP (dari Tab Sandi Email)
                      </label>
                      <select
                        value={webForm.email}
                        onChange={(e) => setWebForm({ ...webForm, email: e.target.value })}
                        className="w-full px-3 py-1.5 rounded-lg border border-border bg-background text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                      >
                        <option value="">-- Tanpa Email OTP --</option>
                        {emails.map((m) => (
                          <option key={m.label} value={m.label}>
                            {m.label} ({m.email})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowWebForm(false)}
                      className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
                    >
                      Simpan Kredensial
                    </button>
                  </div>
                </form>
              )}

              {/* List Web */}
              <div className="space-y-2.5">
                {credentials.length === 0 && !showWebForm && (
                  <div className="text-center py-8 px-4 rounded-xl border border-dashed border-border bg-muted/10 text-xs text-muted-foreground">
                    Belum ada akun login web di vault.
                  </div>
                )}

                {credentials.map((cred) => {
                  const revKey = `web_${cred.name}`;
                  const isRevealed = Boolean(revealedPasswords[revKey]);
                  return (
                    <div
                      key={cred.name}
                      className="p-3.5 rounded-xl border border-border bg-background/60 hover:bg-muted/30 transition-colors flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-foreground">{cred.name}</span>
                          {cred.email && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                              OTP: {cred.email}
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground truncate">
                          {cred.username || 'Tanpa username'} {cred.url ? `• ${cred.url}` : ''}
                        </div>
                        <div className="font-mono text-[11px] text-foreground flex items-center gap-2">
                          <span>Sandi: {isRevealed ? revealedPasswords[revKey] : '••••••••'}</span>
                          <button
                            type="button"
                            onClick={() => handleToggleReveal('web', cred.name)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            {isRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                          {isRevealed && (
                            <button
                              type="button"
                              onClick={() => handleCopyPassword(revealedPasswords[revKey], cred.name)}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm(`Hapus kredensial "${cred.name}"?`)) return;
                          await fetch(`/api/vault?type=web&id=${encodeURIComponent(cred.name)}`, { method: 'DELETE' });
                          addToast(`Kredensial "${cred.name}" dihapus`, 'info');
                          fetchVault();
                        }}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: STATUS KEAMANAN */}
          {activeTab === 'cookies' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Simpan string cookie mentah (<code className="font-mono">nama=nilai;nama2=nilai2</code>) untuk
                  platform besar. Tersimpan terenkripsi AES-256 di server — nilai cookie tidak pernah dikirim balik
                  ke browser setelah disimpan. Tombol <span className="font-medium">Terapkan</span> menulis berkas
                  cookie untuk mesin unduh (yt-dlp/engine Instagram); khusus Instagram juga menyinkron sesi ke engine.
                </p>
                <button
                  type="button"
                  onClick={() => setShowCookieForm(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {showCookieForm ? 'Tutup' : 'Tambah Cookie'}
                </button>
              </div>

              {showCookieForm && (
                <form onSubmit={handleSaveCookie} className="space-y-3 p-4 rounded-xl border border-border bg-muted/20">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">Platform</label>
                      <select
                        value={cookieForm.platform}
                        onChange={e => setCookieForm(f => ({ ...f, platform: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                      >
                        {Object.entries(platforms).map(([key, meta]) => (
                          <option key={key} value={key}>{meta.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-muted-foreground mb-1">Catatan (opsional)</label>
                      <input
                        value={cookieForm.note}
                        onChange={e => setCookieForm(f => ({ ...f, note: e.target.value }))}
                        placeholder="mis. akun owlll4497"
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">String Cookie</label>
                    <textarea
                      value={cookieForm.value}
                      onChange={e => setCookieForm(f => ({ ...f, value: e.target.value }))}
                      rows={4}
                      required
                      placeholder="csrftoken=...;sessionid=...;ds_user_id=..."
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs font-mono resize-y"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={cookieForm.apply}
                        onChange={e => setCookieForm(f => ({ ...f, apply: e.target.checked }))}
                        className="rounded"
                      />
                      Langsung terapkan ke mesin unduh
                    </label>
                    <button type="submit" className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">
                      Simpan ke Vault
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground/80">
                    Tips: di Chrome/DevTools → Application → Cookies → salin seluruh baris <code className="font-mono">document.cookie</code>
                    dari tab Console saat berada di situs tersebut.
                  </p>
                </form>
              )}

              {cookies.length === 0 && !showCookieForm && (
                <div className="text-center py-10 text-sm text-muted-foreground border border-dashed border-border rounded-xl">
                  Belum ada cookie tersimpan. Klik <span className="font-medium">Tambah Cookie</span> untuk mulai.
                </div>
              )}

              <div className="space-y-2">
                {cookies.map(c => (
                  <div key={c.platform} className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{platforms[c.platform]?.label || c.platform}</span>
                        {c.note && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{c.note}</span>}
                        <span className="text-[10px] text-muted-foreground">{c.keyCount} key</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1 truncate" title={c.masked}>
                        {c.masked || '(nilai tersimpan — gunakan Terapkan untuk memakai)'}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                        Diperbarui {new Date(c.updatedAt).toLocaleString('id-ID')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleApplyCookie(c.platform)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-border hover:bg-muted"
                        title="Tulis ke berkas cookie mesin unduh"
                      >
                        <Zap className="w-3 h-3" />
                        Terapkan
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCookie(c.platform)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                        title="Hapus"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-2">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Enkripsi Standar Militer (AES-256-GCM) Aktif</span>
                </div>
                <p className="text-muted-foreground leading-relaxed text-[11px]">
                  Semua sandi email dan kredensial akun dienkripsi secara simetris menggunakan algoritma AES-256-GCM dengan tag autentikasi (anti-tampering). Sandi plaintext TIDAK PERNAH disimpan di basis data percakapan chat.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-1">
                  <div className="text-muted-foreground text-[11px]">Kunci Master Enkripsi</div>
                  <div className="font-mono text-xs font-semibold text-foreground">
                    {stats?.keyFile || '/root/browser-agent/vault.key'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Izin berkas: 0600 (Hanya root/pemilik yang dapat membaca)
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-1">
                  <div className="text-muted-foreground text-[11px]">Berkas Brankas Terenkripsi</div>
                  <div className="font-mono text-xs font-semibold text-foreground">
                    {stats?.vaultFile || '/root/browser-agent/vault.json'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Payload tersimpan dalam format ciphertext base64
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-1">
                  <div className="text-muted-foreground text-[11px]">Status Daemon Browser & OTP</div>
                  <div className="font-semibold text-xs flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>{stats?.otpActive ? 'Aktif & Tersinkronisasi' : 'Siap Digunakan'}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Otomatis sinkron ke email.json untuk pembaca OTP Python
                  </div>
                </div>

                <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-1">
                  <div className="text-muted-foreground text-[11px]">Total Akun Tersimpan</div>
                  <div className="font-mono text-xs font-bold text-foreground">
                    {emails.length} Email IMAP • {credentials.length} Akun Web
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Tersedia langsung untuk perintah otomasi AI
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-border bg-muted/10 space-y-2">
                <div className="font-semibold text-foreground">Aturan Penggunaan dengan AI Chat:</div>
                <ul className="list-disc pl-4 space-y-1 text-muted-foreground text-[11px]">
                  <li>
                    AI hanya melihat <strong>label dan alamat email</strong> (contoh: <code>tiktok_mail</code>), dan tidak pernah melihat kata sandi asli Anda.
                  </li>
                  <li>
                    Untuk mengambil kode OTP terbaru via obrolan AI, AI akan memanggil perintah <code>[BROWSER: otp nama_email]</code> setelah Anda memberikan persetujuan izin.
                  </li>
                  <li>
                    Untuk login otomatis ke situs web, AI memanggil <code>[BROWSER: login nama_akun]</code> yang mengeksekusi kredensial langsung di dalam sesi Playwright Chrome server tanpa mencatat sandi ke riwayat chat.
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-between text-xs">
          <div className="text-muted-foreground text-[11px]">
            Diperbarui: {stats?.lastUpdated ? new Date(stats.lastUpdated).toLocaleTimeString('id-ID') : 'Baru saja'}
          </div>
          <button
            type="button"
            onClick={() => setVaultDialogOpen(false)}
            className="px-4 py-1.5 rounded-xl border border-border bg-card hover:bg-muted text-foreground transition-colors font-medium"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
