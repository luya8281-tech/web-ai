'use client';

import React, { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Github,
  AlertCircle,
  Loader2,
  Lock,
  ArrowRight,
  Eye,
  EyeOff,
  ShieldCheck,
  Cpu,
  FolderGit2
} from 'lucide-react';

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const getErrorMessage = (err: string) => {
    switch (err) {
      case 'oauth_not_configured':
        return 'Koneksi GitHub belum siap di server.';
      case 'token_exchange_failed':
        return 'Gagal melakukan verifikasi dengan GitHub. Silakan coba lagi.';
      case 'cancelled':
        return 'Proses login GitHub dibatalkan.';
      default:
        return err;
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setLoginError('');

    try {
      const res = await fetch('/api/auth/secret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: password.trim() }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setLoginError(data.error || 'Password salah.');
        setLoading(false);
        return;
      }

      window.location.href = data.redirect || '/';
    } catch {
      setLoginError('Koneksi terputus. Silakan coba lagi.');
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[420px] mx-auto space-y-6">
      {/* Main Login Card */}
      <div className="p-7 sm:p-8 rounded-2xl border border-border/80 bg-card/95 shadow-xl backdrop-blur-md space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-3">
          <div className="inline-block p-1.5 rounded-2xl bg-muted/60 border border-border shadow-xs">
            <img
              src="/icon.svg"
              alt="Vee Logo"
              className="w-14 h-14 rounded-xl object-contain"
            />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Vee Workspace
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Masuk untuk melanjutkan percakapan Anda
            </p>
          </div>
        </div>

        {/* Error Alert */}
        {(error || loginError) && (
          <div className="p-3.5 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-400 text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="leading-snug">{loginError || (error ? getErrorMessage(error) : '')}</span>
          </div>
        )}

        {/* Primary Auth Actions */}
        <div className="space-y-4">
          <a
            href="/api/auth/github"
            className="group w-full flex items-center justify-between py-3 px-4 rounded-xl bg-foreground text-background font-semibold text-xs sm:text-sm hover:opacity-90 transition-all shadow-sm active:scale-[0.99]"
          >
            <div className="flex items-center gap-3">
              <Github className="w-4 h-4 fill-current" />
              <span>Lanjutkan dengan GitHub</span>
            </div>
            <ArrowRight className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 transition-transform" />
          </a>

          {/* Divider */}
          <div className="relative flex items-center justify-center">
            <div className="w-full border-t border-border" />
            <span className="absolute px-3 bg-card text-[11px] text-muted-foreground uppercase tracking-wider">
              atau
            </span>
          </div>

          {/* Password Login Option */}
          {!usePassword ? (
            <button
              type="button"
              onClick={() => setUsePassword(true)}
              className="w-full py-2.5 px-3 rounded-xl border border-border/80 bg-muted/30 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex items-center justify-center gap-2"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Gunakan password rahasia</span>
            </button>
          ) : (
            <form onSubmit={handlePasswordLogin} className="space-y-3 pt-1">
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Masukkan password..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  className="w-full pl-3 pr-10 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading || !password.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-foreground text-background text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Masuk'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUsePassword(false);
                    setLoginError('');
                  }}
                  className="px-4 py-2.5 rounded-xl border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                >
                  Batal
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Feature Badges */}
        <div className="pt-2 border-t border-border/60 grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-xl bg-muted/30 border border-border/40 flex flex-col items-center gap-1">
            <Cpu className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-medium text-foreground/80">Multi-Model</span>
          </div>
          <div className="p-2 rounded-xl bg-muted/30 border border-border/40 flex flex-col items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[10px] font-medium text-foreground/80">Sesi Privat</span>
          </div>
          <div className="p-2 rounded-xl bg-muted/30 border border-border/40 flex flex-col items-center gap-1">
            <FolderGit2 className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-[10px] font-medium text-foreground/80">Workspace</span>
          </div>
        </div>
      </div>

      {/* System Status Footer */}
      <div className="flex items-center justify-between px-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span>Sistem Aktif</span>
        </div>
        <span>vee2.my.id</span>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main
      className="min-h-screen w-full flex items-center justify-center p-4 bg-background relative"
      style={{
        backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <Suspense fallback={<div className="text-muted-foreground text-xs">Memuat...</div>}>
        <LoginContent />
      </Suspense>
    </main>
  );
}
