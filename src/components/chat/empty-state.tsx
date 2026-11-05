'use client';

import React from 'react';
import {
  Terminal,
  Globe,
  BookOpen,
  FileAudio,
  Cpu,
  Plug,
} from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { useUIStore } from '@/stores/ui-store';

export const EmptyState: React.FC = () => {
  const { activeModelId, models, sendMessage } = useChatStore();
  const {
    setSkillsDialogOpen,
    setModelSelectorOpen,
    setConnectorsDialogOpen,
    setWorkspaceOpen,
    searchSourceQuota,
  } = useUIStore();

  const activeModel = models.find((m) => m.modelId === activeModelId || m.id === activeModelId);
  const modelName = activeModel?.displayName || activeModelId || 'Asisten AI';

  const quickWorkflows = [
    {
      icon: <Terminal className="w-4 h-4 text-primary" />,
      label: 'Kesehatan Server & PM2',
      sub: 'SOP: linux-server-ops',
      prompt:
        'Periksa status proses PM2, penggunaan RAM, Swap, dan ruang disk server saat ini menggunakan skill linux-server-ops ([BACA_SKILL: linux-server-ops]).',
    },
    {
      icon: <Globe className="w-4 h-4 text-primary" />,
      label: 'Riset Berita & Web Terkini',
      sub: 'Multi-engine + Logo Sumber',
      prompt: `Cari berita teknologi dan riset AI terbaru hari ini menggunakan [CARI_WEB: teknologi AI terbaru 2026 | ${searchSourceQuota}] lalu rangkum poin utamanya.`,
    },
    {
      icon: <FileAudio className="w-4 h-4 text-primary" />,
      label: 'Transkripsi & Subtitel Video',
      sub: 'yt-dlp + faster-whisper',
      prompt:
        'Saya ingin mengekstrak transkrip atau subtitel video. Tanyakan tautan videonya dan berikan opsi tindakan.',
    },
    {
      icon: <BookOpen className="w-4 h-4 text-primary" />,
      label: 'Audit Kode & Database',
      sub: 'code-quality-auditor',
      prompt:
        'Gunakan skill code-quality-auditor ([BACA_SKILL: code-quality-auditor]) untuk memeriksa potensi bug dan keamanan pada proyek aktif.',
    },
  ];

  return (
    <div className="flex-1 flex flex-col justify-center px-4 sm:px-6 py-6 max-w-2xl mx-auto w-full font-sans">
      {/* Editorial Workspace Header (Compact & Clean) */}
      <div className="space-y-2.5 text-left pb-4">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setModelSelectorOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted text-foreground font-medium transition-colors"
          >
            <Cpu className="w-3.5 h-3.5 text-primary" />
            <span>{modelName}</span>
          </button>

          <button
            type="button"
            onClick={() => setConnectorsDialogOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted text-foreground font-medium transition-colors"
          >
            <Plug className="w-3.5 h-3.5 text-primary" />
            <span>Konektor</span>
          </button>

          <button
            type="button"
            onClick={() => setSkillsDialogOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted text-foreground font-medium transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5 text-primary" />
            <span>Katalog Skill</span>
          </button>

          <button
            type="button"
            onClick={() => setWorkspaceOpen(true, 'terminal')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted text-foreground font-medium transition-colors"
          >
            <Terminal className="w-3.5 h-3.5 text-primary" />
            <span>Terminal & Web Aktif</span>
          </button>
        </div>

        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground font-serif pt-1">
          Ruang Kerja Teknis & Otomasi
        </h2>
      </div>

      {/* Compact 2x2 Workflow Grid without noisy paragraphs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {quickWorkflows.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => sendMessage(item.prompt)}
            className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card/80 hover:border-primary/50 hover:bg-secondary/50 text-left transition-colors group"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
              {item.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                {item.label}
              </div>
              <div className="text-[11px] font-mono text-muted-foreground truncate">
                {item.sub}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
