'use client';

import React, { useState, useEffect, Suspense } from 'react';
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
  CheckCircle2,
  KeyRound,
  Terminal,
  Activity,
  Layers,
} from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '0x4AAAAAAFHPovaqcaTd365Y';

type AuthMethod = 'secret' | 'github';

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const [authMethod, setAuthMethod] = useState<AuthMethod>('secret');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string>('');

  // Enable smooth mobile viewport behavior & native scrolling
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevHeight = document.body.style.height;

    document.body.classList.remove('overflow-hidden', 'h-[100dvh]', 'min-h-[100dvh]', 'flex');
    document.body.style.overflow = 'auto';
    document.body.style.overflowY = 'auto';
    document.body.style.height = 'auto';
    document.body.style.minHeight = '100%';
    document.body.style.overscrollBehaviorY = 'auto';
    document.documentElement.style.overscrollBehaviorY = 'auto';
    document.documentElement.style.overflowY = 'auto';

    return () => {
      document.body.classList.add('overflow-hidden', 'h-[100dvh]', 'min-h-[100dvh]', 'flex');
      document.body.style.overflow = prevOverflow;
      document.body.style.overflowY = '';
      document.body.style.height = prevHeight;
      document.body.style.minHeight = '';
      document.body.style.overscrollBehaviorY = '';
      document.documentElement.style.overscrollBehaviorY = '';
      document.documentElement.style.overflowY = '';
    };
  }, []);

  const getErrorMessage = (err: string) => {
    switch (err) {
      case 'oauth_not_configured':
        return 'Koneksi GitHub OAuth belum dikonfigurasi di server.';
      case 'token_exchange_failed':
        return 'Otorisasi GitHub gagal. Silakan coba kembali.';
      case 'cancelled':
        return 'Proses login dibatalkan.';
      case 'turnstile_required':
        return 'Selesaikan verifikasi keamanan Cloudflare terlebih dahulu.';
      case 'turnstile_failed':
        return 'Verifikasi Cloudflare tidak valid. Silakan ulangi centang.';
      default:
        return err;
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setLoginError('Kunci akses rahasia tidak boleh kosong.');
      return;
    }

    if (!turnstileToken) {
      setLoginError('Selesaikan verifikasi keamanan terlebih dahulu.');
      return;
    }

    setLoading(true);
    setLoginError('');

    try {
      const res = await fetch('/api/auth/secret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: password.trim(),
          turnstileToken,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setLoginError(data.error || 'Kunci akses salah.');
        setLoading(false);
        return;
      }

      window.location.href = data.redirect || '/';
    } catch {
      setLoginError('Gagal menghubungkan ke server. Periksa jaringan Anda.');
      setLoading(false);
    }
  };

  const handleGithubLogin = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!turnstileToken) {
      setLoginError('Selesaikan verifikasi keamanan terlebih dahulu.');
      return;
    }

    setLoading(true);
    setLoginError('');

    try {
      const res = await fetch('/api/auth/verify-turnstile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: turnstileToken }),
      });

      if (res.ok) {
        window.location.href = '/api/auth/github';
      } else {
        const data = await res.json();
        setLoginError(data.error || 'Verifikasi keamanan gagal.');
        setLoading(false);
      }
    } catch {
      window.location.href = `/api/auth/github?turnstile_token=${encodeURIComponent(turnstileToken)}`;
    }
  };

  const isVerified = Boolean(turnstileToken);

  return (
    <div
      className="w-full max-w-[460px] mx-auto select-none relative z-10 transition-all duration-300"
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
    >
      {/* Top Brand Hero (Web Absen / Native App Style) */}
      <div className="flex flex-col items-center text-center mb-6">
        <div className="relative mb-3 group">
          <div className="w-16 h-16 rounded-[22px] bg-gradient-to-b from-[#252523] to-[#151514] border border-white/[0.14] p-3 shadow-[0_12px_30px_-8px_rgba(0,0,0,0.6),inset_0_1px_1px_0_rgba(255,255,255,0.2)] flex items-center justify-center transition-transform duration-300 group-hover:scale-105">
            <img
              src="/icon.svg"
              alt="Vee² AI Platform Logo"
              className="w-full h-full object-contain drop-shadow-md select-none pointer-events-none"
              draggable={false}
            />
          </div>
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 border-2 border-background shadow-sm" />
          </span>
        </div>

        <h1 className="text-2xl sm:text-[26px] font-black tracking-tight text-foreground flex items-center gap-2">
          Vee² AI Workspace
        </h1>
        <p className="text-xs sm:text-[13px] text-muted-foreground mt-1 font-medium tracking-tight">
          Portal Komputasi Otonom & Model AI Terintegrasi
        </p>
      </div>

      {/* Main Fluid Glass Card */}
      <div className="relative rounded-[28px] border border-white/[0.12] dark:border-white/[0.08] bg-card/90 dark:bg-[#151514]/90 backdrop-blur-2xl shadow-[0_24px_64px_-16px_rgba(0,0,0,0.5),inset_0_1px_1px_0_rgba(255,255,255,0.12)] p-6 sm:p-7 space-y-5">
        
        {/* Tactile Segmented Control (Web Absen Style) */}
        <div className="grid grid-cols-2 p-1 rounded-2xl bg-secondary/80 dark:bg-[#0c0c0b] border border-border/60 dark:border-white/[0.06]">
          <button
            type="button"
            onClick={() => {
              setAuthMethod('secret');
              setLoginError('');
            }}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-all duration-200 select-none ${
              authMethod === 'secret'
                ? 'bg-card text-foreground shadow-sm dark:bg-[#222220] dark:text-white dark:border dark:border-white/[0.1]'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            Kunci Akses
          </button>

          <button
            type="button"
            onClick={() => {
              setAuthMethod('github');
              setLoginError('');
            }}
            className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-all duration-200 select-none ${
              authMethod === 'github'
                ? 'bg-card text-foreground shadow-sm dark:bg-[#222220] dark:text-white dark:border dark:border-white/[0.1]'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Github className="w-3.5 h-3.5" />
            GitHub OAuth
          </button>
        </div>

        {/* Error Alert Box */}
        {(error || loginError) && (
          <div className="p-3.5 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-center gap-3 select-none animate-in fade-in zoom-in-95 duration-200">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span className="leading-snug select-none font-semibold">
              {loginError || (error ? getErrorMessage(error) : '')}
            </span>
          </div>
        )}

        {/* Security Enclave (Cloudflare Turnstile) */}
        <div className="rounded-2xl border border-border/70 dark:border-white/[0.07] bg-secondary/40 dark:bg-[#0c0c0b]/70 p-3.5 space-y-2.5 backdrop-blur-sm">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 select-none">
              <ShieldCheck className="w-3.5 h-3.5 text-primary" />
              Verifikasi Integritas
            </span>
            {isVerified ? (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 rounded-full select-none">
                <CheckCircle2 className="w-3 h-3" /> Siap
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 rounded-full select-none">
                Wajib Dicentang
              </span>
            )}
          </div>

          <div className="flex justify-center items-center py-0.5 w-full min-h-[66px] overflow-hidden rounded-xl">
            <Turnstile
              siteKey={SITE_KEY}
              onSuccess={(token) => {
                setTurnstileToken(token);
                setLoginError('');
              }}
              onExpire={() => setTurnstileToken('')}
              onError={() => setLoginError('Verifikasi Turnstile gagal dimuat. Muat ulang halaman.')}
              options={{
                theme: 'dark',
                size: 'normal',
              }}
            />
          </div>
        </div>

        {/* Auth Body Switcher */}
        {authMethod === 'secret' ? (
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div className="space-y-2 text-left">
              <label className="block text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground pl-0.5 select-none">
                KUNCI AKSES / MASTER KEY
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Masukkan password atau kunci rahasia..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={!isVerified || loading}
                  autoFocus
                  className="w-full pl-11 pr-11 py-3.5 rounded-2xl border border-border/80 dark:border-white/[0.1] bg-secondary/50 dark:bg-[#0c0c0b] text-foreground text-sm font-medium placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition-all select-text disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Big Tactile Action Button */}
            <button
              type="submit"
              disabled={loading || !password.trim() || !isVerified}
              className="w-full h-[52px] rounded-2xl bg-gradient-to-r from-[#cc785c] via-[#d97c5e] to-[#b5674c] hover:brightness-105 active:scale-[0.98] text-white font-extrabold text-sm tracking-wide shadow-[0_12px_28px_-6px_rgba(204,120,92,0.45)] transition-all duration-200 flex items-center justify-center gap-2.5 disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none select-none cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Memverifikasi Sesi...</span>
                </>
              ) : (
                <>
                  <span>Masuk ke Workspace</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-secondary/30 dark:bg-[#0c0c0b]/40 border border-border/50 dark:border-white/[0.05] text-center space-y-1">
              <p className="text-xs font-semibold text-foreground/90">
                Otentikasi Akun GitHub
              </p>
              <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                Sinkronkan identitas pengembang dan riwayat komputasi melalui GitHub OAuth 2.0.
              </p>
            </div>

            {/* Big GitHub Button */}
            <button
              type="button"
              onClick={handleGithubLogin}
              disabled={loading || !isVerified}
              className="w-full h-[52px] rounded-2xl bg-[#24292f] dark:bg-[#1f1f1d] hover:bg-[#2c3138] dark:hover:bg-[#272725] active:scale-[0.98] border border-white/[0.1] text-white font-extrabold text-sm tracking-wide shadow-[0_12px_28px_-6px_rgba(0,0,0,0.4)] transition-all duration-200 flex items-center justify-center gap-2.5 disabled:opacity-40 disabled:pointer-events-none select-none cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Menghubungkan GitHub...</span>
                </>
              ) : (
                <>
                  <Github className="w-4 h-4 fill-current" />
                  <span>Lanjutkan dengan GitHub</span>
                  <ArrowRight className="w-4 h-4 opacity-75" />
                </>
              )}
            </button>
          </div>
        )}

        {/* Security & System Info Ribbon */}
        <div className="pt-2 border-t border-border/40 dark:border-white/[0.06] flex items-center justify-between text-[11px] text-muted-foreground font-semibold px-1 select-none">
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-primary" />
            Node Enclave
          </span>
          <span className="flex items-center gap-1.5 text-foreground/80 font-mono text-[10.5px]">
            <Terminal className="w-3 h-3 text-muted-foreground" />
            TLS v1.3 Encrypted
          </span>
        </div>
      </div>

      {/* System Status Hero Capsule (Inspired by Web Absen Live Bar) */}
      <div className="mt-5 flex items-center justify-between px-3 py-2.5 rounded-2xl bg-secondary/50 dark:bg-[#151514]/60 border border-border/50 dark:border-white/[0.06] backdrop-blur-md text-[11px] font-semibold text-muted-foreground select-none">
        <div className="flex items-center gap-2 select-none">
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-foreground/90 font-bold">Node Online</span>
          <span className="text-muted-foreground/60">&middot;</span>
          <span>vps.vee2.my.id</span>
        </div>
        <span className="font-mono text-[10px] text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-lg select-none">
          v2.6 Pro
        </span>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main
      className="min-h-[101svh] min-h-[101vh] w-full flex items-center justify-center p-4 sm:p-6 bg-background relative select-none overflow-hidden"
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        overscrollBehaviorY: 'auto',
        touchAction: 'pan-y',
      }}
      onContextMenu={(e) => {
        // Allow copy/paste only on active inputs
        if ((e.target as HTMLElement)?.tagName !== 'INPUT') {
          e.preventDefault();
        }
      }}
    >
      {/* Studio Ambient Illumination (Warm Terracotta & Obsidian Glow) */}
      <div 
        className="pointer-events-none fixed inset-0 z-0 opacity-40 dark:opacity-75"
        style={{
          backgroundImage: `
            radial-gradient(circle at 50% 15%, rgba(204, 120, 92, 0.15) 0%, transparent 50%),
            radial-gradient(circle at 10% 85%, rgba(204, 120, 92, 0.08) 0%, transparent 40%),
            radial-gradient(circle at 90% 85%, rgba(255, 255, 255, 0.03) 0%, transparent 45%),
            radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px)
          `,
          backgroundSize: '100% 100%, 100% 100%, 100% 100%, 28px 28px',
        }}
      />

      <Suspense fallback={<div className="text-muted-foreground text-xs select-none">Memuat sistem...</div>}>
        <LoginContent />
      </Suspense>
    </main>
  );
}
