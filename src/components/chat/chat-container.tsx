'use client';

import React, { useRef, useEffect, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { MessageItem } from './message-item';
import { EmptyState } from './empty-state';
import { Composer } from './composer';
import { TopNav } from './top-nav';
import { AgentWorkspacePanel } from './agent-workspace-panel';
import { MarkdownRenderer } from '../markdown/markdown-renderer';
import { ThinkingCard } from './thinking-card';
import { ActionTimeline } from './action-timeline';
import { TaskBoard } from './task-board';
import { AbstractSpinner } from './abstract-spinner';
import { ThinkingStatus } from './thinking-status';
import { cleanMessageContent, extractInlineMedia } from '@/lib/utils/clean-content';
import { UniversalFileCard } from './universal-file-card';
import { CornerActionHUD } from './corner-action-hud';
import { GlobalAudioPlayer } from './global-audio-player';
import { JobBanner } from './job-banner';

export const ChatContainer: React.FC = () => {
  const {
    messages,
    isGenerating,
    reconnecting,
    generatingContent,
    generatingReasoning,
    generatingActions,
    generatingTasks,
    activeConversationId,
    stopGeneration,
    resumeGeneration,
    selectConversation,
  } = useChatStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const userScrolledUpRef = useRef<boolean>(false);
  const prevMessagesLengthRef = useRef<number>(messages.length);

  // Otomatis sambung ulang / muat ulang respons HANYA ketika pengguna benar-benar
  // kembali dari luar aplikasi / tab background (visibilitychange) atau kembali online.
  useEffect(() => {
    let isChecking = false;
    const handleVisibilityOrOnline = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (isChecking) return;

      const curr = useChatStore.getState();
      const convId = curr.activeConversationId;
      if (!convId) return;

      // JANGAN PERNAH menyela atau menginterupsi streaming lokal yang sedang aktif membaca token!
      if (curr.isGenerating && curr.abortController !== null && !curr.reconnecting) {
        return;
      }

      isChecking = true;
      try {
        const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(convId)}&t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        const latest = useChatStore.getState();

        // Pastikan kembali tidak menyela stream lokal yang sedang aktif membaca token
        if (latest.isGenerating && latest.abortController !== null && !latest.reconnecting) {
          return;
        }

        if (data.running && !latest.reconnecting) {
          // Server masih memproses jawaban saat pengguna kembali ke Chrome dari luar
          latest.resumeGeneration(convId);
        } else if (!data.running && (latest.reconnecting || (latest.isGenerating && latest.abortController === null))) {
          // Server sudah selesai selagi pengguna di luar Chrome -> muat pesan terbaru dari DB
          await latest.selectConversation(convId);
          useChatStore.setState({
            isGenerating: false,
            reconnecting: false,
            generatingContent: '',
            generatingReasoning: '',
            generatingActions: [],
          });
        }
      } catch {
        // abaikan jika jaringan belum siap
      } finally {
        isChecking = false;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrOnline);
    window.addEventListener('online', handleVisibilityOrOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrOnline);
      window.removeEventListener('online', handleVisibilityOrOnline);
    };
  }, [activeConversationId, resumeGeneration, selectConversation]);

  // Scroll to bottom ONLY when a user sends a new message (never when assistant finishes)
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === 'user') {
        userScrolledUpRef.current = false;
        setShowScrollBottom(false);
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      } else {
        const container = scrollContainerRef.current;
        if (container) {
          const { scrollTop, scrollHeight, clientHeight } = container;
          const isAtBottom = scrollHeight - scrollTop - clientHeight < 60;
          if (!isAtBottom) {
            setShowScrollBottom(true);
            userScrolledUpRef.current = true;
          }
        }
      }
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages]);

  // Handle live token stream: only stay pinned if user has NOT scrolled up
  useEffect(() => {
    if (userScrolledUpRef.current) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    if (distanceFromBottom < 60) {
      container.scrollTop = scrollHeight;
    }
  }, [generatingContent, generatingReasoning, generatingActions]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 60;

    if (isAtBottom) {
      userScrolledUpRef.current = false;
      setShowScrollBottom(false);
    } else {
      userScrolledUpRef.current = true;
      setShowScrollBottom(true);
    }
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        userScrolledUpRef.current = true;
        setShowScrollBottom(true);
      }
    };

    let touchStartY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches && e.touches.length > 0) {
        touchStartY = e.touches[0].clientY;
      }
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches && e.touches.length > 0) {
        const touchY = e.touches[0].clientY;
        if (touchY > touchStartY + 4) {
          userScrolledUpRef.current = true;
          setShowScrollBottom(true);
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: true });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  const scrollToBottom = () => {
    userScrolledUpRef.current = false;
    setShowScrollBottom(false);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isGenerating) {
        stopGeneration();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isGenerating, stopGeneration]);

  const hasMessages = messages.length > 0 || isGenerating;
  const isExecuting = isGenerating && generatingActions.some((a) => a.status === 'running');
  const currentRunningAction =
    generatingActions.find((a) => a.status === 'running') ||
    (generatingActions.length > 0 ? generatingActions[generatingActions.length - 1] : null);

  return (
    <div className="flex-1 flex flex-col h-[100dvh] overflow-hidden bg-background relative">
      {/* 4-Corner Animated Action HUD for Workspace */}
      <CornerActionHUD isExecuting={isExecuting} currentAction={currentRunningAction} />

      {/* Top Header */}
      <TopNav />

      {/* Banner tugas latar belakang (deploy/restart detached) */}
      <JobBanner />

      {/* Persistent Global Audio Mini-Player (survives chat switching & backgrounding) */}
      <GlobalAudioPlayer />

      {/* Main Chat Scroll Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col pt-3 sm:pt-4"
      >
        {!hasMessages ? (
          <EmptyState />
        ) : (
          <div className="flex-1 pb-3">
            {/* Historical Messages */}
            {messages.map((message, idx) => (
              <MessageItem
                key={message.id || idx}
                message={message}
                nextMessage={messages[idx + 1]}
                isLastMessage={idx === messages.length - 1}
                isLastAssistant={
                  idx === messages.length - 1 && message.role === 'assistant'
                }
              />
            ))}

            {/* Live Streaming Assistant Message */}
            {isGenerating && (
              <div className="w-full py-3 sm:py-4 px-3 sm:px-6 flex justify-center transition-colors">
                <div className="w-full max-w-3xl flex flex-col items-start">
                  <div className="group min-w-0 w-full">
                    {/* Laporan tugas live (agen reporter) */}
                    {generatingTasks.length > 0 && <TaskBoard tasks={generatingTasks} live />}

                    {/* Aksi kronologis: teks -> kartu aksi -> teks -> aksi */}
                    {generatingActions.length > 0 && (
                      <ActionTimeline actions={generatingActions} />
                    )}

                    {/* Reasoning sisa yang mengalir SETELAH aksi terakhir.
                        Ditempatkan di sini agar kartu thinking ngekor kronologis:
                        aksi -> thinking -> teks jawaban (tidak menumpuk di atas). */}
                    {(() => {
                      const attached = generatingActions.reduce(
                        (n, a) => n + (a.reasoningBefore?.length || 0),
                        0
                      );
                      const tail = (generatingReasoning || '').slice(attached);
                      return tail.trim() ? <ThinkingCard reasoning={tail} isLive={isGenerating} /> : null;
                    })()}

                    {/* Live Inline Media Cards */}
                    {extractInlineMedia(generatingContent).length > 0 && (
                      <div className="my-2.5 space-y-2 font-sans">
                        {extractInlineMedia(generatingContent).map((media) => (
                          <UniversalFileCard key={media.id} media={media} />
                        ))}
                      </div>
                    )}

                    {/* Progressive Clean Markdown Token Render */}
                    {cleanMessageContent(generatingContent, true) ? (
                      <div className="text-foreground text-[15px] sm:text-[15.5px] leading-relaxed text-left break-words my-2.5">
                        <MarkdownRenderer content={cleanMessageContent(generatingContent, true)} />
                      </div>
                    ) : reconnecting ? (
                      <div className="flex items-center gap-2.5 text-xs text-primary py-1.5 px-3 rounded-xl border border-primary/30 bg-primary/10 w-fit">
                        <AbstractSpinner size={15} className="text-primary" />
                        <span>Menyambung ulang ke proses latar belakang...</span>
                      </div>
                    ) : isExecuting ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                        <AbstractSpinner size={16} className="text-primary" />
                        <span className="text-shimmer">Menjalankan aksi...</span>
                      </div>
                    ) : isGenerating ? (
                      <div className="flex items-center gap-3 text-sm text-muted-foreground py-1">
                        <AbstractSpinner size={24} className="text-primary" />
                        <ThinkingStatus />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} className="h-3" />
          </div>
        )}
      </div>

      {/* Floating Scroll to Bottom Button */}
      {showScrollBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-24 left-1/2 -translate-x-1/2 p-2 rounded-full bg-card/90 backdrop-blur-md border border-border/60 shadow-lg hover:bg-muted text-foreground/80 hover:text-foreground transition-all z-10"
          title="Ke bagian bawah"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      {/* Inline Live Web / CLI / Sources Panel directly below the chat in the same column */}
      <AgentWorkspacePanel />

      {/* Sticky Bottom Composer */}
      <Composer />
    </div>
  );
};
