'use client';

import React, { useRef, useEffect, useState } from 'react';
import { ArrowDown, Sparkles, Brain, Loader2 } from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { MessageItem } from './message-item';
import { EmptyState } from './empty-state';
import { Composer } from './composer';
import { TopNav } from './top-nav';
import { MarkdownRenderer } from '../markdown/markdown-renderer';

export const ChatContainer: React.FC = () => {
  const {
    messages,
    isGenerating,
    generatingContent,
    generatingReasoning,
    activeModelId,
    activeProviderId,
    stopGeneration,
  } = useChatStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  // Auto-scroll on new message or streaming token
  useEffect(() => {
    if (!showScrollBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, generatingContent, generatingReasoning, showScrollBottom]);

  // Handle scroll detection
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
    setShowScrollBottom(!isNearBottom);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollBottom(false);
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

  return (
    <div className="flex-1 flex flex-col h-[100dvh] overflow-hidden bg-background">
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
                  !isGenerating &&
                  idx === messages.length - 1 &&
                  message.role === 'assistant'
                }
              />
            ))}

            {/* Live Streaming Assistant Message */}
            {isGenerating && (
              <div className="w-full py-4 sm:py-6 px-3 sm:px-6 bg-muted/15 border-y border-border/30">
                <div className="max-w-3xl mx-auto flex gap-3 sm:gap-4">
                  {/* Avatar */}
                  <div className="shrink-0 pt-0.5">
                    <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-semibold text-xs shadow-sm animate-pulse-subtle">
                      <Sparkles className="w-4 h-4" />
                    </div>
                  </div>

                  {/* Streaming Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{activeModelId}</span>
                      <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] uppercase font-medium">
                        {activeProviderId}
                      </span>
                    </div>

                    {/* Live Reasoning Output */}
                    {generatingReasoning && (
                      <div className="my-2 p-3 rounded-lg border border-purple-500/20 bg-purple-950/10 text-xs">
                        <div className="flex items-center gap-2 text-purple-400 font-medium mb-1">
                          <Brain className="w-3.5 h-3.5 animate-pulse" />
                          <span>Thinking...</span>
                        </div>
                        <div className="text-muted-foreground font-mono text-[12px] whitespace-pre-wrap leading-relaxed">
                          {generatingReasoning}
                        </div>
                      </div>
                    )}

                    {/* Progressive Markdown Token Render */}
                    {generatingContent ? (
                      <MarkdownRenderer content={generatingContent} />
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
          className="absolute bottom-24 right-6 sm:right-10 p-2.5 rounded-full bg-card border border-border shadow-md hover:bg-muted text-foreground transition-all z-10"
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
