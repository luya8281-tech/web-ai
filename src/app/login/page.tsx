'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Github, Shield, Lock, Sparkles, AlertCircle } from 'lucide-react';

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const getErrorMessage = (err: string) => {
    switch (err) {
      case 'oauth_not_configured':
        return 'GitHub OAuth belum dikonfigurasi di server VPS (.env.local).';
      case 'token_exchange_failed':
        return 'Gagal melakukan otentikasi dengan GitHub. Silakan coba lagi.';
      case 'cancelled':
        return 'Proses login GitHub dibatalkan.';
      default:
        return `Terjadi kesalahan saat login: ${err}`;
    }
  };

  return (
    <div className="w-full max-w-md p-6 sm:p-8 rounded-3xl border border-border/60 bg-card/80 backdrop-blur-xl shadow-2xl relative z-10 space-y-6">
      {/* Brand Header */}
      <div className="text-center space-y-3">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500/20 via-primary/25 to-purple-500/20 p-2.5 border border-primary/30 shadow-lg flex items-center justify-center">
          <img src="/icon.svg" alt="Vee² AI" className="w-full h-full object-contain drop-shadow" />
        </div>

        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/15 border border-primary/25 text-primary text-xs font-semibold mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>vee2.my.id · Private Cloud</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Vee² AI Platform
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Asisten AI Produksi Multi-Model dengan Ruang Obrolan Terisolasi Pribadi
          </p>
        </div>
      </div>

      {/* Error Alert if any */}
      {error && (
        <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
          <span>{getErrorMessage(error)}</span>
        </div>
      )}

      {/* Login Action */}
      <div className="space-y-3 pt-2">
        <a
          href="/api/auth/owner"
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-all shadow-md active:scale-[0.98]"
        >
          <Sparkles className="w-4 h-4" />
          <span>Masuk Langsung sebagai Vee (Owner)</span>
        </a>

        <a
          href="/api/auth/github"
          className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-xl bg-secondary/80 text-foreground font-medium text-xs hover:bg-secondary transition-all border border-border/50"
        >
          <Github className="w-4 h-4 fill-current" />
          <span>Lanjutkan dengan GitHub</span>
        </a>

        <div className="text-center">
          <p className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
            <Lock className="w-3 h-3" />
            <span>Otentikasi aman via GitHub OAuth</span>
          </p>
        </div>
      </div>

      {/* Privacy Guarantee Box */}
      <div className="p-4 rounded-2xl bg-muted/40 border border-border/40 space-y-2 text-xs">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Shield className="w-4 h-4 text-emerald-400" />
          <span>Privasi & Pemisahan Sesi Total</span>
        </div>
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          Setiap pengguna memiliki ruang sesi tersendiri. Riwayat percakapan, file, dan preferensi obrolan Anda tidak dapat dilihat atau diakses oleh pengguna lain.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen w-full flex items-center justify-center p-4 bg-background relative overflow-hidden">
      {/* Background ambient radial gradients */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      <Suspense fallback={<div className="text-muted-foreground text-sm">Memuat...</div>}>
        <LoginContent />
      </Suspense>
    </main>
  );
}
