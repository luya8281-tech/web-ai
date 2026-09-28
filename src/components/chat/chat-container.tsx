'use client';

import React, { useRef, useEffect, useState } from 'react';
import { ArrowDown, Sparkles, Brain, Loader2 } from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { MessageItem } from './message-item';
import { EmptyState } from './empty-state';
import { Composer } from './composer';
import { TopNav } from './top-nav';
import { MarkdownRenderer } from '../markdown/markdown-renderer';
import { LiveThinkingAccordion } from './live-thinking-accordion';
import { ActionContentRenderer } from './action-content-renderer';
import { CornerActionHUD } from './corner-action-hud';

export const ChatContainer: React.FC = () => {
  const {
    messages,
    isGenerating,
    generatingContent,
    generatingReasoning,
    generatingActions,
    activeModelId,
    activeProviderId,
    stopGeneration,
  } = useChatStore();

  // Auth state is seeded by chat-app.tsx, no need to re-fetch on mount

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const userScrolledUpRef = useRef<boolean>(false);
  const prevMessagesLengthRef = useRef<number>(messages.length);

  // Scroll to bottom ONLY when a user sends a new message (never when assistant finishes)
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === 'user') {
        userScrolledUpRef.current = false;
        setShowScrollBottom(false);
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      } else {
        // Assistant message finished!
        // DO NOT scroll down! Preserve the user's reading position.
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

  // Handle live token stream: DO NOT use smooth scrollIntoView on every token!
  // Only anchor to bottom if the user has NOT scrolled up and is already at the bottom
  useEffect(() => {
    if (userScrolledUpRef.current) return; // User is reading above -> Freeze auto-scroll completely!

    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    // Only stay pinned if user was already within 60px of the bottom
    if (distanceFromBottom < 60) {
      container.scrollTop = scrollHeight;
    }
  }, [generatingContent, generatingReasoning]);

  // Handle scroll detection and user scroll intention
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

  // Wheel and touch listeners: if user scrolls or swipes up, immediately freeze auto-scroll
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        // User scrolled UP
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
          // User swiped down to see older content above
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

  // Keyboard shortcut listener for Escape to stop generation
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
  const currentRunningAction = generatingActions.find((a) => a.status === 'running') || (generatingActions.length > 0 ? generatingActions[generatingActions.length - 1] : null);

  return (
    <div className="flex-1 flex flex-col h-[100dvh] overflow-hidden bg-background relative">
      {/* 4-Corner Animated Action HUD for Workspace */}
      <CornerActionHUD isExecuting={isExecuting} currentAction={currentRunningAction} />

      {/* Top Header */}
      <TopNav />

      {/* Main Chat Scroll Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col"
      >
        {!hasMessages ? (
          <EmptyState />
        ) : (
          <div className="flex-1 pb-4">
            {/* Historical Messages */}
            {messages.map((message, idx) => (
              <MessageItem
                key={message.id || idx}
                message={message}
                isLastAssistant={
                  idx === messages.length - 1 &&
                  message.role === 'assistant'
                }
              />
            ))}

            {/* Live Streaming Assistant Message */}
            {isGenerating && (
              <div className="w-full py-3.5 sm:py-4 px-4 sm:px-6 flex justify-center transition-colors">
                <div className="w-full max-w-3xl">
                  {/* Content Area */}
                  <div className="group min-w-0 w-full">

                  {/* Live Reasoning Output (Collapsible Accordion) */}
                  {generatingReasoning && (
                    <LiveThinkingAccordion reasoning={generatingReasoning} isLive={true} />
                  )}

                  {/* Progressive Markdown & In-place Action Cards */}
                  {generatingContent || generatingActions.length > 0 ? (
                    <ActionContentRenderer
                      content={generatingContent}
                      actions={generatingActions}
                      isLive={true}
                    />
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span>Assistant is thinking...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            )}

            <div ref={messagesEndRef} className="h-4" />
          </div>
        )}
      </div>

      {/* Floating Scroll to Bottom Button */}
      {showScrollBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-28 left-1/2 -translate-x-1/2 p-2 rounded-full bg-card/90 backdrop-blur-md border border-border/60 shadow-lg hover:bg-muted text-foreground/80 hover:text-foreground transition-all z-10"
          title="Scroll to bottom"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      {/* Sticky Bottom Composer */}
      <Composer />
    </div>
  );
};
