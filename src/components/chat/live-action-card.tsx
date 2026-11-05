'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  XCircle,
} from 'lucide-react';
import { ActionInfo } from '@/types/chat';
import { AbstractSpinner } from './abstract-spinner';
import { extractSourcesFromAction } from '@/lib/utils/clean-content';
import { useUIStore } from '@/stores/ui-store';
import { copyToClipboard } from '@/lib/utils/clipboard';
import { getActionBadge, formatDuration, tailOutput } from '@/lib/utils/action-display';

interface LiveActionCardProps {
  action: ActionInfo;
}

export const StatusGlyph: React.FC<{ action: ActionInfo }> = ({ action }) => {
  if (action.status === 'running') {
    return <AbstractSpinner size={13} className="text-primary shrink-0" />;
  }
  if (action.isError) {
    return <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />;
  }
  return <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
};

/**
 * Kartu aksi ringkas: satu baris saat tertutup (status · jenis · perintah ·
 * durasi), detail/log di dalam dropdown. Tidak ada ekor output otomatis agar
 * percakapan tidak memanjang.
 */
export const LiveActionCard: React.FC<LiveActionCardProps> = ({ action }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { setWorkspaceOpen, openSourcesDialog } = useUIStore();

  const isRunning = action.status === 'running';
  const fullText = action.output || action.details || '';
  const subject = action.subject || '';
  const startedAt = action.startedAt;

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isRunning || !startedAt) return;
    setElapsed(Date.now() - startedAt);
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => clearInterval(id);
  }, [isRunning, startedAt]);

  const duration = formatDuration(isRunning && startedAt ? elapsed : action.durationMs);
  const sources = useMemo(() => extractSourcesFromAction(action), [action]);
  const uniqueDomains = useMemo(() => {
    const seen = new Set<string>();
    return sources.filter((s) => {
      if (seen.has(s.domain)) return false;
      seen.add(s.domain);
      return true;
    });
  }, [sources]);

  const tail = useMemo(() => (isOpen ? tailOutput(fullText, 8, 900) : ''), [isOpen, fullText]);

  const handleOpenWorkspace = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (action.type === 'RUN_BASH' || action.type === 'RUN_PYTHON') {
      setWorkspaceOpen(true, 'terminal', action);
    } else if (
      action.type === 'BUKA_WEB' ||
      action.type === 'SCREENSHOT_WEB' ||
      action.type === 'BROWSER'
    ) {
      setWorkspaceOpen(true, 'browser', action);
    } else if (sources.length > 0) {
      openSourcesDialog(sources, action.subject || action.label);
    } else {
      setWorkspaceOpen(true, 'terminal', action);
    }
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(fullText);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div className="my-0.5 w-full max-w-2xl font-sans">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className="group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/40"
      >
        <StatusGlyph action={action} />

        <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/80">
          {getActionBadge(action.type)}
        </span>

        <span
          className={`min-w-0 flex-1 truncate font-mono text-[11px] ${
            isRunning
              ? 'text-shimmer'
              : action.isError
                ? 'text-red-500/90'
                : 'text-foreground/85'
          }`}
          title={subject || action.label}
        >
          {subject || action.label}
        </span>

        {action.review && action.review.verdict !== 'allow' && (
          <span
            title={action.review.reason}
            className={`shrink-0 rounded border px-1 text-[9px] uppercase tracking-wide ${
              action.review.verdict === 'block'
                ? 'border-red-500/40 text-red-500'
                : 'border-amber-500/40 text-amber-500'
            }`}
          >
            {action.review.verdict}
          </span>
        )}

        {duration && (
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums shrink-0">
            {duration}
          </span>
        )}
        {sources.length > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0">{sources.length} sumber</span>
        )}

        {isOpen ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {isOpen && (
        <div className="space-y-2 pb-2 pl-7 pr-1.5 pt-1">
          {action.label && subject && (
            <div className="text-[11px] text-muted-foreground">{action.label}</div>
          )}

          {tail && (
            <pre className="font-mono text-[10.5px] leading-snug text-muted-foreground whitespace-pre-wrap break-words max-h-56 overflow-y-auto rounded-md bg-background/70 border border-border/60 px-2 py-1.5">
              {tail}
            </pre>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {sources.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openSourcesDialog(sources, action.subject || action.label);
                }}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-background hover:border-primary/50 text-[10px] font-medium text-foreground transition-colors"
              >
                <span className="flex items-center -space-x-1">
                  {uniqueDomains.slice(0, 4).map((s) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={s.domain}
                      src={
                        s.favicon ||
                        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(s.domain)}&sz=64`
                      }
                      alt={s.domain}
                      className="w-3 h-3 rounded-full border border-card bg-muted object-contain"
                    />
                  ))}
                </span>
                <span>Lihat sumber</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleOpenWorkspace}
              className="px-2 py-0.5 rounded border border-border bg-secondary/70 hover:bg-muted text-[10px] font-medium text-foreground transition-colors"
            >
              {action.type === 'RUN_BASH' || action.type === 'RUN_PYTHON'
                ? 'Buka CLI'
                : action.type === 'BUKA_WEB' ||
                    action.type === 'SCREENSHOT_WEB' ||
                    action.type === 'BROWSER'
                  ? 'Web Aktif'
                  : sources.length > 0
                    ? 'Sumber'
                    : 'Inspeksi'}
            </button>

            {fullText && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLogOpen((v) => !v);
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-secondary/70 hover:bg-muted text-[10px] font-medium text-muted-foreground hover:text-foreground"
              >
                {logOpen ? 'Tutup log' : 'Log penuh'}
                <span className="text-[9px] opacity-70">
                  {fullText.length.toLocaleString()}
                </span>
              </button>
            )}
          </div>

          {action.screenshotUrl && (
            <button
              type="button"
              onClick={handleOpenWorkspace}
              className="w-full rounded-md overflow-hidden border border-border bg-black/20 block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={action.screenshotUrl}
                alt={action.label || 'Live Web Screenshot'}
                className="w-full h-auto max-h-44 object-contain"
              />
            </button>
          )}

          {logOpen && fullText && (
            <div className="rounded-md border border-border bg-background/90 overflow-hidden">
              <div className="flex items-center justify-between px-2 py-1 bg-secondary/40 border-b border-border/60 text-[10px] font-mono text-muted-foreground">
                <span>{fullText.split('\n').length} baris</span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-primary" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copied ? 'Tersalin' : 'Salin'}</span>
                </button>
              </div>
              <pre className="px-2 py-1.5 text-[10.5px] font-mono text-muted-foreground whitespace-pre-wrap break-words max-h-72 overflow-y-auto leading-relaxed">
                {fullText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
