'use client';

import React, { useState } from 'react';
import {
  Loader2,
  CheckCircle2,
  ChevronDown,
  Globe,
  Terminal,
  Code2,
  BookOpen,
  Sparkles,
  Wrench,
  Search,
  Copy,
  Check,
} from 'lucide-react';
import { ActionInfo } from '@/types/chat';

function getActionIcon(type: string) {
  const t = (type || '').toUpperCase();
  if (t === 'CARI_WEB') return <Search className="w-3.5 h-3.5 text-primary" />;
  if (t === 'BUKA_WEB' || t === 'SCREENSHOT_WEB') return <Globe className="w-3.5 h-3.5 text-primary" />;
  if (t === 'RUN_BASH') return <Terminal className="w-3.5 h-3.5 text-primary" />;
  if (t === 'RUN_PYTHON') return <Code2 className="w-3.5 h-3.5 text-amber-500/90" />;
  if (t === 'BACA_SKILL' || t === 'INSTALL_SKILL') return <BookOpen className="w-3.5 h-3.5 text-primary" />;
  return <Wrench className="w-3.5 h-3.5 text-primary" />;
}

export const LiveActionCard: React.FC<{ action: ActionInfo }> = ({ action }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isRunning = action.status === 'running';

  const handleCopyDetails = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!action.details) return;
    try {
      await navigator.clipboard.writeText(action.details);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {}
  };

  return (
    <div
      className={`my-2 rounded-xl border transition-all duration-200 overflow-hidden relative ${
        isRunning
          ? 'border-primary/40 bg-card/90 shadow-sm border-l-[3px] border-l-primary'
          : 'border-border/70 bg-card/50 hover:border-border hover:bg-card/80'
      }`}
    >
      {/* Subtle Hairline Corner Accents (Active execution) */}
      {isRunning && (
        <>
          <div className="absolute top-1 left-1 w-2 h-2 border-t border-l border-primary/40 rounded-tl-[2px] pointer-events-none" />
          <div className="absolute top-1 right-1 w-2 h-2 border-t border-r border-primary/40 rounded-tr-[2px] pointer-events-none" />
          <div className="absolute bottom-1 left-1 w-2 h-2 border-b border-l border-primary/40 rounded-bl-[2px] pointer-events-none" />
          <div className="absolute bottom-1 right-1 w-2 h-2 border-b border-r border-primary/40 rounded-br-[2px] pointer-events-none" />
        </>
      )}

      {/* Action Header Button / Dropdown Trigger */}
      <button
        type="button"
        onClick={() => action.details && setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-3 sm:px-3.5 py-2.5 text-xs transition-colors select-none ${
          action.details ? 'cursor-pointer' : 'cursor-default'
        } hover:bg-muted/40`}
      >
        <div className="flex items-center gap-2.5 font-medium min-w-0 pr-2">
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          )}

          <div className="flex items-center gap-1.5 truncate text-foreground/90">
            {getActionIcon(action.type)}
            <span className="truncate">{action.label}</span>
          </div>

          {isRunning ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium shrink-0 border border-primary/20">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span>Memproses</span>
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 text-[10px] font-medium shrink-0 border border-emerald-500/20">
              Selesai
            </span>
          )}
        </div>

        {action.details && (
          <div className="flex items-center gap-1.5 text-[11px] shrink-0 font-medium text-muted-foreground hover:text-foreground transition-colors">
            <span>{isOpen ? 'Tutup' : 'Lihat Detail'}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                isOpen ? 'rotate-180' : ''
              }`}
            />
          </div>
        )}
      </button>

      {/* Dropdown Content with smooth animated appearance */}
      {isOpen && action.details && (
        <div className="border-t border-border/50 bg-muted/20 animate-fade-in">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 text-[10px] font-mono text-muted-foreground">
            <span className="uppercase tracking-wider">Output / Log Eksekusi</span>
            <button
              onClick={handleCopyDetails}
              className="flex items-center gap-1 hover:text-foreground transition-colors p-1 rounded hover:bg-muted"
              title="Salin Output"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-500" />
                  <span className="text-emerald-500">Tersalin</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Salin</span>
                </>
              )}
            </button>
          </div>
          <div className="p-3 font-mono text-[11px] text-foreground/80 leading-relaxed max-h-48 overflow-y-auto select-text break-words whitespace-pre-wrap">
            {action.details}
          </div>
        </div>
      )}
    </div>
  );
};
