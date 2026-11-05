'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Copy,
  Check,
  RotateCw,
  Edit2,
  Trash2,
  Quote,
  ShieldAlert,
  Play,
  XCircle,
  ExternalLink,
  Globe,
  Terminal,
  Sparkles,
  MapPin,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  AlertCircle,
  Download,
} from 'lucide-react';
import { Message, ActionInfo, SearchSource } from '@/types/chat';
import { MarkdownRenderer } from '../markdown/markdown-renderer';
import { useChatStore } from '@/stores/chat-store';
import { useUIStore } from '@/stores/ui-store';
import { useSettingsStore } from '@/stores/settings-store';
import { copyToClipboard } from '@/lib/utils/clipboard';
import { ThinkingCard } from './thinking-card';
import { OperationSummary } from './operation-summary';
import { TaskBoard } from './task-board';
import { UniversalFileCard } from './universal-file-card';
import {
  cleanMessageContent,
  extractActionsFromText,
  extractInlineMedia,
  extractInteractivePermissions,
  extractInteractiveChoices,
  extractSourcesFromAction,
  InlineMediaItem,
} from '@/lib/utils/clean-content';

interface MessageItemProps {
  message: Message;
  nextMessage?: Message;
  isLastMessage?: boolean;
  isLastAssistant?: boolean;
}

export const MessageItem: React.FC<MessageItemProps> = React.memo(
  ({ message, nextMessage, isLastMessage }) => {
    const regenerateMessage = useChatStore((state) => state.regenerateMessage);
    const editMessage = useChatStore((state) => state.editMessage);
    const deleteMessage = useChatStore((state) => state.deleteMessage);
    const sendMessage = useChatStore((state) => state.sendMessage);
    const setMessageFeedback = useChatStore((state) => state.setMessageFeedback);
    const isGenerating = useChatStore((state) => state.isGenerating);
    const userLocation = useChatStore((state) => state.userLocation);
    const locationStatus = useChatStore((state) => state.locationStatus);
    const requestUserLocation = useChatStore((state) => state.requestUserLocation);

    const { settings } = useSettingsStore();
    const { insertIntoComposer, setWorkspaceOpen, openSourcesDialog } = useUIStore();

    const [copied, setCopied] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState(message.content);
    const [handledPermIds, setHandledPermIds] = useState<Record<string, 'approved' | 'denied'>>({});
    const [feedback, setFeedback] = useState<'up' | 'down' | null>(
      (message.metadata?.feedback as 'up' | 'down' | null) || null
    );

    useEffect(() => {
      if (message.metadata?.feedback) {
        setFeedback(message.metadata.feedback as 'up' | 'down');
        return;
      }
      try {
        if (typeof window !== 'undefined') {
          const saved = localStorage.getItem(`antigravity_feedback_${message.id}`);
          if (saved === 'up' || saved === 'down') setFeedback(saved);
        }
      } catch {}
    }, [message.id, message.metadata?.feedback]);

    const handleFeedback = (val: 'up' | 'down') => {
      const next = feedback === val ? null : val;
      setFeedback(next);
      setMessageFeedback(message.id, next);
    };

    const isUser = message.role === 'user';

    const actions: ActionInfo[] = useMemo(() => {
      return message.metadata?.actions && message.metadata.actions.length > 0
        ? message.metadata.actions
        : extractActionsFromText(message.content);
    }, [message.metadata?.actions, message.content]);

    const videoActions: ActionInfo[] = useMemo(() => {
      if (isUser) return [];
      return actions.filter((a) => Boolean(a.videoUrl));
    }, [actions, isUser]);

    const inlineMedia: InlineMediaItem[] = useMemo(() => {
      if (isUser) return [];
      const existingVidUrls = new Set(videoActions.map((v) => v.videoUrl).filter(Boolean));
      return extractInlineMedia(message.content).filter((m) => !existingVidUrls.has(m.url));
    }, [isUser, message.content, videoActions]);

    const cleanedContent = useMemo(
      () => (isUser ? message.content : cleanMessageContent(message.content, false)),
      [isUser, message.content]
    );

    // Deteksi apakah pesan pengguna gagal terkirim atau belum mendapat balasan asisten
    const hasSendFailure = useMemo(() => {
      if (!isUser) return false;
      if (message.metadata?.sendFailed) return true;
      if (isLastMessage && !isGenerating) return true;
      if (nextMessage && nextMessage.role === 'user') return true;
      if (nextMessage && nextMessage.role === 'assistant') {
        const nextClean = cleanMessageContent(nextMessage.content, false).trim();
        const nextMedia = extractInlineMedia(nextMessage.content);
        if (
          (!nextClean && nextMedia.length === 0) ||
          /(?:⚠️\s*\*?Error:|⚠️\s*Gagal menghubungi model|Response stopped by user)/i.test(
            nextMessage.content
          )
        ) {
          return true;
        }
      }
      return false;
    }, [isUser, message.metadata?.sendFailed, isLastMessage, isGenerating, nextMessage]);

    const isAssistantError = useMemo(() => {
      if (isUser) return false;
      return (
        (!cleanedContent.trim() && videoActions.length === 0 && inlineMedia.length === 0) ||
        /(?:⚠️\s*\*?Error:|⚠️\s*Gagal menghubungi model|Response stopped by user)/i.test(
          message.content
        )
      );
    }, [isUser, cleanedContent, videoActions.length, inlineMedia.length, message.content]);

    // Deteksi apakah asisten meminta izin lokasi / koordinat GPS pengguna
    const needsLocationPrompt = useMemo(() => {
      if (isUser) return false;
      return /(izinkan.*lokasi|aktif.*lokasi|ikon lokasi|koordinat.*gps|butuhkan.*lokasi|akses lokasi|belum.*lokasi|sebutkan.*kota|tidak memiliki akses.*lokasi)/i.test(
        message.content
      );
    }, [isUser, message.content]);

    // Collect all sources from actions so we can show an interactive Source Logo bar at the end of the reply
    const messageSources: SearchSource[] = useMemo(() => {
      if (isUser) return [];
      const map = new Map<string, SearchSource>();
      for (const act of actions) {
        for (const s of extractSourcesFromAction(act)) {
          if (!map.has(s.url)) map.set(s.url, s);
        }
      }
      return Array.from(map.values()).map((s, idx) => ({ ...s, index: idx + 1 }));
    }, [actions, isUser]);

    const uniqueSourceDomains = useMemo(() => {
      const seen = new Set<string>();
      return messageSources.filter((s) => {
        if (seen.has(s.domain)) return false;
        seen.add(s.domain);
        return true;
      });
    }, [messageSources]);

    // Interactive Permission Cards & Clickable Choices
    const permissions = useMemo(
      () => (isUser ? [] : extractInteractivePermissions(message.content)),
      [isUser, message.content]
    );

    const choices = useMemo(
      () => (isUser ? [] : extractInteractiveChoices(message.content)),
      [isUser, message.content]
    );

  const handleCopy = async () => {
    const cleanText = isUser ? message.content : cleanMessageContent(message.content, false);
    const success = await copyToClipboard(cleanText);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleQuoteReply = () => {
    const raw = isUser ? message.content : cleanMessageContent(message.content, false);
    const snippet = raw.length > 220 ? raw.substring(0, 220) + '…' : raw;
    const quoted =
      snippet
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n') + '\n\n';
    insertIntoComposer(quoted);
  };

  const handleSaveEdit = async () => {
    if (editContent.trim() && editContent !== message.content) {
      await editMessage(message.id, editContent);
    }
    setIsEditing(false);
  };

  return (
    <div
      className={`w-full ${
        settings.compactMode ? 'py-1.5' : 'py-2.5'
      } px-3 sm:px-6 flex justify-center transition-colors bg-transparent`}
    >
      <div className={`w-full max-w-3xl flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Attachments Preview */}
        {message.attachments && message.attachments.length > 0 && (
          <div className={`flex flex-wrap gap-2 mb-1.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {message.attachments.map((att) => (
              <div
                key={att.id}
                className="relative rounded-xl overflow-hidden border border-border bg-card max-w-xs"
              >
                {att.mimeType?.startsWith('image/') || att.url?.startsWith('data:image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={att.dataUrl || att.url}
                    alt={att.name}
                    className="max-h-52 max-w-full object-contain rounded-xl"
                  />
                ) : (
                  <div className="flex items-center gap-2 p-2.5 text-xs text-muted-foreground font-sans">
                    <span className="font-semibold text-foreground truncate">{att.name}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {isEditing ? (
          <div className="w-full space-y-2 font-sans">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              aria-label="Edit isi pesan"
              className="w-full p-2.5 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary min-h-[84px] resize-y"
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 text-xs rounded-lg bg-muted hover:bg-muted/80 text-foreground transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary-hover transition-colors"
              >
                Simpan & Kirim
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`group min-w-0 ${
              isUser
                ? 'user-bubble max-w-[85%] sm:max-w-xl bg-secondary border border-border px-3.5 py-2 rounded-2xl text-left'
                : 'w-full text-left'
            }`}
          >
            {/* Laporan tugas tersimpan */}
            {!isUser && <TaskBoard tasks={message.metadata?.tasks} />}

            {/* Ringkasan trace untuk pesan selesai: kotak di atas + sheet detail */}
            {!isUser && actions.length > 0 && (
              <OperationSummary actions={actions} reasoning={message.reasoningContent || undefined} />
            )}

            {/* Tanpa aksi: tampilkan pemikiran ringkas saja */}
            {!isUser && actions.length === 0 && message.reasoningContent && (
              <ThinkingCard reasoning={message.reasoningContent} />
            )}

            {/* Inline Playable Media & Universal File Cards (Videos, Audios, Docs, Lua, XLSX, DOCX, PDF, Code, Archives) */}
            {!isUser && (videoActions.length > 0 || inlineMedia.length > 0) && (
              <div className="my-2.5 space-y-2 font-sans">
                {videoActions.map((va, idx) => (
                  <div
                    key={va.id || `vid_${idx}`}
                    className="rounded-xl border border-border overflow-hidden bg-card max-w-md shadow-xs"
                  >
                    <div className="px-3 py-1.5 bg-secondary/70 border-b border-border flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-foreground truncate">
                        {va.url || 'Pratinjau Video'}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setWorkspaceOpen(true, 'browser', va)}
                          className="px-2 py-0.5 rounded border border-border bg-background hover:bg-muted text-[10.5px] font-medium text-foreground"
                        >
                          Buka di Web Aktif
                        </button>
                        {va.videoUrl && (
                          <a
                            href={`${va.videoUrl}${va.videoUrl.includes('?') ? '&' : '?'}download=1`}
                            download
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10.5px] font-semibold hover:bg-primary-hover flex items-center gap-1"
                          >
                            <Download className="w-3 h-3" />
                            <span>Unduh MP4</span>
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="bg-black flex justify-center">
                      <video
                        src={va.videoUrl}
                        poster={va.screenshotUrl || undefined}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full max-h-[340px] object-contain"
                      />
                    </div>
                  </div>
                ))}

                {inlineMedia.map((media) => (
                  <UniversalFileCard
                    key={media.id}
                    media={media}
                    onOpenWorkspace={(m) =>
                      setWorkspaceOpen(true, 'browser', {
                        id: m.id,
                        type: 'BUKA_WEB',
                        label: m.caption || m.filename,
                        status: 'done',
                        url: m.url,
                        videoUrl: m.kind === 'video' ? m.url : undefined,
                      })
                    }
                  />
                ))}
              </div>
            )}

            {/* Message Content */}
            <div
              className={`text-foreground ${
                isUser ? 'text-[14px] leading-snug' : 'text-[15px] leading-relaxed pt-0.5'
              } text-left break-words`}
            >
              <MarkdownRenderer
                content={cleanedContent}
                showLineNumbers={settings.codeLineNumbers}
              />
            </div>

            {/* Quick Retry Banner if Assistant Reply Errored */}
            {!isUser && isAssistantError && (
              <div className="mt-2.5 p-2.5 rounded-xl border border-destructive/40 bg-destructive/10 flex items-center justify-between gap-2 font-sans">
                <div className="flex items-center gap-2 text-xs text-foreground">
                  <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                  <span>Respons terputus atau gagal diproses.</span>
                </div>
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={() => regenerateMessage(message.id)}
                  className="px-3 py-1 rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 shrink-0"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Kirim Ulang</span>
                </button>
              </div>
            )}

            {/* Baris sumber ringkas — membuka pop-up, bukan panel bawah */}
            {!isUser && messageSources.length > 0 && (
              <div className="mt-2.5 font-sans">
                <button
                  type="button"
                  onClick={() => openSourcesDialog(messageSources, 'Sumber Referensi')}
                  className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-border bg-card hover:bg-muted hover:border-primary/50 text-[11px] font-medium text-foreground transition-colors"
                >
                  <span className="flex items-center -space-x-1.5">
                    {uniqueSourceDomains.slice(0, 6).map((s) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={s.domain}
                        src={
                          s.favicon ||
                          `https://www.google.com/s2/favicons?domain=${encodeURIComponent(s.domain)}&sz=64`
                        }
                        alt={s.domain}
                        className="w-3.5 h-3.5 rounded-full border border-card bg-muted object-contain"
                      />
                    ))}
                  </span>
                  <span>{messageSources.length} sumber</span>
                  <span className="text-muted-foreground/70">· lihat</span>
                </button>
              </div>
            )}

            {/* Interactive 1-Click GPS Location Permission Card */}
            {!isUser && needsLocationPrompt && (
              <div className="mt-3 p-3 rounded-xl border border-primary/40 bg-primary/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 font-sans">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/30 text-primary flex items-center justify-center shrink-0">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-foreground">
                      Izin Lokasi GPS Diperlukan
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {userLocation
                        ? `Lokasi terdaftar: ${userLocation.label || `${userLocation.lat.toFixed(4)}, ${userLocation.lon.toFixed(4)}`}`
                        : 'Ketuk tombol untuk mengizinkan akses lokasi GPS otomatis'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isGenerating || locationStatus === 'requesting'}
                  onClick={async () => {
                    const loc = await requestUserLocation({ ipFallback: true });
                    if (loc) {
                      const place = loc.label ? ` (${loc.label})` : '';
                      sendMessage(
                        `Lokasi saya sudah diizinkan: koordinat ${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}${place}. Silakan lanjutkan.`
                      );
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 shrink-0"
                >
                  {locationStatus === 'requesting' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <MapPin className="w-3.5 h-3.5" />
                  )}
                  <span>Izinkan Lokasi GPS</span>
                </button>
              </div>
            )}

            {/* Kartu izin (hanya [IZIN] eksplisit, hanya pada balasan terakhir) */}
            {!isUser && isLastMessage && !isGenerating && permissions.length > 0 && (
              <div className="mt-2.5 space-y-1.5 font-sans">
                {permissions.map((perm) => {
                  const status = handledPermIds[perm.id];
                  const riskText = `${perm.title} ${perm.description}`.toLowerCase();
                  const risk = /otp|kode|email|verifikasi/.test(riskText)
                    ? 'Akses OTP'
                    : /hapus|delete|drop|bersihkan/.test(riskText)
                      ? 'Berisiko tinggi'
                      : /restart|deploy|pm2|layanan|service/.test(riskText)
                        ? 'Mengubah layanan'
                        : /biaya|bayar|beli|kredit/.test(riskText)
                          ? 'Berbiaya'
                          : 'Butuh izin';

                  return (
                    <div
                      key={perm.id}
                      className="rounded-xl border border-primary/30 bg-primary/[0.06] px-2.5 py-2"
                    >
                      <div className="flex items-center gap-1.5">
                        <ShieldAlert className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="flex-1 min-w-0 truncate text-[11.5px] font-semibold text-foreground">
                          {perm.title}
                        </span>
                        <span className="shrink-0 rounded-full border border-primary/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-primary/90">
                          {risk}
                        </span>
                      </div>

                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        {perm.description}
                      </p>

                      <div className="mt-2 flex items-center gap-1.5">
                        {status ? (
                          <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary px-2 py-1 text-[11px] font-medium text-foreground">
                            {status === 'approved' ? 'Diizinkan' : 'Ditolak'}
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setHandledPermIds((prev) => ({ ...prev, [perm.id]: 'approved' }));
                                sendMessage(perm.approvePrompt);
                              }}
                              className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
                            >
                              Izinkan
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setHandledPermIds((prev) => ({ ...prev, [perm.id]: 'denied' }));
                                sendMessage(perm.denyPrompt);
                              }}
                              className="rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              Tolak
                            </button>
                            <span className="ml-auto text-[10px] text-muted-foreground/70">
                              Berlaku untuk langkah ini
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pilihan langkah (chip ringkas, hanya pada balasan terakhir) */}
            {!isUser && isLastMessage && !isGenerating && choices.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 font-sans">
                {choices.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => sendMessage(opt)}
                    className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary/60 hover:bg-secondary/70"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Banner lanjutkan untuk jawaban yang terputus karena restart layanan */}
        {!isUser && message.metadata?.finishReason === 'interrupted-restart' && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 font-sans">
            <span className="text-[11px] text-amber-500">
              Jawaban terputus saat layanan restart
            </span>
            <button
              type="button"
              disabled={isGenerating}
              onClick={() =>
                sendMessage(
                  'Lanjutkan jawaban sebelumnya TEPAT dari bagian terakhir yang sudah terkirim. Jangan mengulang dari awal dan jangan mengulang tool yang sudah berhasil.'
                )
              }
              className="px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted text-[11px] font-semibold text-foreground transition-colors disabled:opacity-40"
            >
              Lanjutkan
            </button>
          </div>
        )}

        {/* Prominent 1-Click Resend Banner when User Message Failed / Unanswered */}
        {isUser && !isEditing && hasSendFailure && (
          <div className="mt-1.5 flex items-center gap-2 font-sans">
            <span className="text-[11px] text-destructive flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>
                {(message.metadata?.errorMessage as string) || 'Pesan belum terjawab / gagal terkirim'}
              </span>
            </span>
            <button
              type="button"
              disabled={isGenerating}
              onClick={() => regenerateMessage(message.id)}
              className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover text-[11px] font-semibold inline-flex items-center gap-1 transition-colors disabled:opacity-40"
            >
              <RotateCw className="w-3 h-3" />
              <span>Kirim Ulang</span>
            </button>
          </div>
        )}

        {/* Always-Visible Action Toolbar (Salin, Kirim Ulang, Feedback, Edit, Kutip, Hapus) */}
        {!isEditing && (
          <div
            className={`flex flex-wrap items-center gap-1 mt-1 text-muted-foreground/80 font-sans text-[11px] ${
              isUser ? 'justify-end pr-0.5' : 'justify-start pl-0.5'
            }`}
          >
            {settings.showTimestamps && message.createdAt && (
              <span className="text-[10px] font-mono text-muted-foreground/60 mr-1">
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}

            <button
              type="button"
              onClick={handleCopy}
              className="px-1.5 py-1 rounded hover:text-foreground hover:bg-muted/60 inline-flex items-center gap-1 transition-colors"
              title="Salin pesan"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-primary" />
                  <span className="text-primary font-medium">Disalin</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Salin</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => regenerateMessage(message.id)}
              disabled={isGenerating}
              className="px-1.5 py-1 rounded hover:text-foreground hover:bg-muted/60 disabled:opacity-30 inline-flex items-center gap-1 transition-colors"
              title="Kirim ulang pesan ini"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Kirim Ulang</span>
            </button>

            <button
              type="button"
              onClick={handleQuoteReply}
              className="p-1 rounded hover:text-foreground hover:bg-muted/60 transition-colors"
              title="Kutip pesan"
            >
              <Quote className="w-3.5 h-3.5" />
            </button>

            {isUser ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="p-1 rounded hover:text-foreground hover:bg-muted/60 transition-colors"
                  title="Edit pesan"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteMessage(message.id)}
                  className="p-1 rounded hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="Hapus pesan"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <>
                {/* Feedback Buttons (Suka / Kurang Tepat) */}
                <button
                  type="button"
                  onClick={() => handleFeedback('up')}
                  className={`p-1 rounded transition-colors ${
                    feedback === 'up'
                      ? 'text-primary bg-primary/15'
                      : 'hover:text-foreground hover:bg-muted/60'
                  }`}
                  title="Respons membantu"
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => handleFeedback('down')}
                  className={`p-1 rounded transition-colors ${
                    feedback === 'down'
                      ? 'text-destructive bg-destructive/15'
                      : 'hover:text-foreground hover:bg-muted/60'
                  }`}
                  title="Respons kurang tepat"
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                </button>

                {feedback === 'down' && (
                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={() => regenerateMessage(message.id)}
                    className="px-2 py-0.5 rounded-md border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 text-[10px] font-semibold inline-flex items-center gap-1 disabled:opacity-40"
                  >
                    <RotateCw className="w-2.5 h-2.5" />
                    <span>Perbaiki Jawaban</span>
                  </button>
                )}

                {actions.some((a) => a.type === 'RUN_BASH' || a.type === 'RUN_PYTHON') && (
                  <button
                    type="button"
                    onClick={() => setWorkspaceOpen(true, 'terminal')}
                    className="px-1.5 py-0.5 rounded hover:bg-muted text-[10px] font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    title="Buka log di Terminal CLI"
                  >
                    <Terminal className="w-3 h-3 text-primary" />
                    <span>CLI</span>
                  </button>
                )}

                {message.metadata?.latencyMs ? (
                  <span className="text-[10px] font-mono text-muted-foreground/60 ml-1">
                    {(message.metadata.latencyMs / 1000).toFixed(1)}s
                  </span>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

MessageItem.displayName = 'MessageItem';
