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
  Cpu,
  FolderGit2,
} from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '0x4AAAAAAFHPovaqcaTd365Y';

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string>('');

  // Enable native mobile pull-to-refresh by freeing body overflow and height on login page
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
        return 'Koneksi GitHub belum siap di server.';
      case 'token_exchange_failed':
        return 'Gagal melakukan verifikasi dengan GitHub. Silakan coba lagi.';
      case 'cancelled':
        return 'Proses login GitHub dibatalkan.';
      case 'turnstile_required':
        return 'Silakan selesaikan centang "Saya bukan robot" terlebih dahulu.';
      case 'turnstile_failed':
        return 'Verifikasi Cloudflare tidak valid. Silakan ulangi centang robot.';
      default:
        return err;
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    if (!turnstileToken) {
      setLoginError('Silakan selesaikan centang "Saya bukan robot" terlebih dahulu.');
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

  const handleGithubLogin = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!turnstileToken) {
      setLoginError('Silakan selesaikan centang "Saya bukan robot" terlebih dahulu.');
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
        setLoginError(data.error || 'Verifikasi Turnstile gagal.');
        setLoading(false);
      }
    } catch {
      window.location.href = `/api/auth/github?turnstile_token=${encodeURIComponent(turnstileToken)}`;
    }
  };

  const isVerified = Boolean(turnstileToken);

  return (
    <div
      className="w-full max-w-[420px] mx-auto space-y-6 select-none"
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
    >
      {/* Main Login Card */}
      <div className="p-7 sm:p-8 rounded-2xl border border-border/80 bg-card/95 shadow-xl backdrop-blur-md space-y-6 select-none">
        {/* Brand Header */}
        <div className="text-center space-y-3 pointer-events-none select-none">
          <div className="inline-block p-1.5 rounded-2xl bg-muted/60 border border-border shadow-xs">
            <img
              src="/icon.svg"
              alt="Vee Logo"
              className="w-14 h-14 rounded-xl object-contain pointer-events-none"
              draggable={false}
            />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground select-none">
              Vee Workspace
            </h1>
            <p className="text-xs text-muted-foreground mt-1 select-none">
              Masuk untuk melanjutkan percakapan Anda
            </p>
          </div>
        </div>

        {/* Error Alert */}
        {(error || loginError) && (
          <div className="p-3.5 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-400 text-xs flex items-center gap-2.5 select-none">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="leading-snug select-none">{loginError || (error ? getErrorMessage(error) : '')}</span>
          </div>
        )}

        {/* Cloudflare Turnstile "Saya Bukan Robot" Widget */}
        <div className="space-y-2 select-none">
          <div className="flex items-center justify-between px-1 select-none">
            <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5 select-none">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Verifikasi Keamanan
            </span>
            {isVerified ? (
              <span className="text-[11px] text-emerald-400 font-semibold select-none flex items-center gap-1">
                ✓ Terverifikasi
              </span>
            ) : (
              <span className="text-[11px] text-amber-400/90 font-medium select-none">
                Wajib dicentang
              </span>
            )}
          </div>

          <div className="flex justify-center items-center py-1 w-full min-h-[66px] overflow-hidden rounded-xl">
            <Turnstile
              siteKey={SITE_KEY}
              onSuccess={(token) => {
                setTurnstileToken(token);
                setLoginError('');
              }}
              onExpire={() => setTurnstileToken('')}
              onError={() => setLoginError('Verifikasi Cloudflare gagal atau diblokir. Pastikan koneksi stabil.')}
              options={{
                theme: 'dark',
                size: 'normal',
              }}
            />
          </div>
        </div>

        {/* Primary Auth Actions */}
        <div className="space-y-4 select-none">
          <button
            type="button"
            onClick={handleGithubLogin}
            disabled={loading || !isVerified}
            className="group w-full flex items-center justify-between py-3 px-4 rounded-xl bg-foreground text-background font-semibold text-xs sm:text-sm hover:opacity-90 transition-all shadow-sm active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed select-none"
          >
            <div className="flex items-center gap-3 select-none">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-background" />
              ) : (
                <Github className="w-4 h-4 fill-current" />
              )}
              <span className="select-none">Lanjutkan dengan GitHub</span>
            </div>
            <ArrowRight className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 transition-transform" />
          </button>

          {/* Divider */}
          <div className="relative flex items-center justify-center select-none">
            <div className="w-full border-t border-border" />
            <span className="absolute px-3 bg-card text-[11px] text-muted-foreground uppercase tracking-wider select-none">
              atau
            </span>
          </div>

          {/* Password Login Option */}
          {!usePassword ? (
            <button
              type="button"
              onClick={() => setUsePassword(true)}
              disabled={!isVerified}
              className="w-full py-2.5 px-3 rounded-xl border border-border/80 bg-muted/30 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed select-none"
            >
              <Lock className="w-3.5 h-3.5" />
              <span className="select-none">Gunakan password rahasia</span>
            </button>
          ) : (
            <form onSubmit={handlePasswordLogin} className="space-y-3 pt-1">
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Masukkan password..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={!isVerified || loading}
                  autoFocus
                  className="w-full pl-3 pr-10 py-2.5 rounded-xl border border-border bg-background text-foreground text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground disabled:opacity-50 select-text"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex gap-2 select-none">
                <button
                  type="submit"
                  disabled={loading || !password.trim() || !isVerified}
                  className="flex-1 py-2.5 rounded-xl bg-foreground text-background text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 select-none"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Masuk'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUsePassword(false);
                    setLoginError('');
                  }}
                  className="px-4 py-2.5 rounded-xl border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors select-none"
                >
                  Batal
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Feature Badges */}
        <div className="pt-2 border-t border-border/60 grid grid-cols-3 gap-2 text-center select-none">
          <div className="p-2 rounded-xl bg-muted/30 border border-border/40 flex flex-col items-center gap-1 select-none">
            <Cpu className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-medium text-foreground/80 select-none">Multi-Model</span>
          </div>
          <div className="p-2 rounded-xl bg-muted/30 border border-border/40 flex flex-col items-center gap-1 select-none">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[10px] font-medium text-foreground/80 select-none">Sesi Privat</span>
          </div>
          <div className="p-2 rounded-xl bg-muted/30 border border-border/40 flex flex-col items-center gap-1 select-none">
            <FolderGit2 className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-[10px] font-medium text-foreground/80 select-none">Workspace</span>
          </div>
        </div>
      </div>

      {/* System Status Footer */}
      <div className="flex items-center justify-between px-2 text-[11px] text-muted-foreground select-none">
        <div className="flex items-center gap-1.5 select-none">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="select-none">Sistem Aktif</span>
        </div>
        <span className="select-none">vee2.my.id</span>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main
      className="min-h-[101svh] min-h-[101vh] w-full flex items-center justify-center p-4 bg-background relative select-none"
      style={{
        backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        overscrollBehaviorY: 'auto',
        touchAction: 'pan-y',
      }}
      onContextMenu={(e) => {
        // Prevent context menu on everything except password input
        if ((e.target as HTMLElement)?.tagName !== 'INPUT') {
          e.preventDefault();
        }
      }}
    >
      <Suspense fallback={<div className="text-muted-foreground text-xs select-none">Memuat...</div>}>
        <LoginContent />
      </Suspense>
    </main>
  );
}
