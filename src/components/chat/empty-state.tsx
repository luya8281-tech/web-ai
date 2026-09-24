'use client';

import React from 'react';
import { Sparkles, Code, FileText, Lightbulb, Compass, Zap } from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { useUIStore } from '@/stores/ui-store';

export const EmptyState: React.FC = () => {
  const { activeProviderId, activeModelId, models, providers, sendMessage } = useChatStore();
  const { setModelSelectorOpen } = useUIStore();

  const activeModel = models.find(m => m.modelId === activeModelId || m.id === activeModelId);
  const activeProvider = providers.find(p => p.id === activeProviderId);

  const suggestions = [
    {
      icon: <Code className="w-4 h-4 text-blue-400" />,
      title: 'Write code & scripts',
      prompt: 'Write a high-performance TypeScript worker with error handling and retry logic.',
    },
    {
      icon: <FileText className="w-4 h-4 text-emerald-400" />,
      title: 'Analyze or summarize',
      prompt: 'Summarize the core architectural benefits of using WAL mode in SQLite compared to traditional journaling.',
    },
    {
      icon: <Lightbulb className="w-4 h-4 text-amber-400" />,
      title: 'Brainstorm ideas',
      prompt: 'Brainstorm 5 innovative feature ideas for an autonomous multi-provider AI assistant.',
    },
    {
      icon: <Compass className="w-4 h-4 text-purple-400" />,
      title: 'Explain complex concepts',
      prompt: 'Explain how Server-Sent Events (SSE) work under the hood and why they avoid WebSocket overhead for LLM streaming.',
    },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-2xl mx-auto">
      {/* Sparkle icon */}
      <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4 shadow-sm">
        <Sparkles className="w-6 h-6" />
      </div>

      {/* Main Title */}
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-2">
        How can I help you today?
      </h1>

      {/* Model Indicator */}
      <div className="flex items-center gap-2 mb-8 text-xs text-muted-foreground">
        <span>Using:</span>
        <button
          onClick={() => setModelSelectorOpen(true)}
          className="inline-flex items-center gap-1.5 font-medium text-foreground hover:text-primary transition-colors underline decoration-dotted"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>{activeProvider?.name || 'VPS AI'}</span>
          <span>·</span>
          <span>{activeModel?.displayName || activeModelId}</span>
        </button>
      </div>

      {/* Suggestion Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left">
        {suggestions.map((item, index) => (
          <button
            key={index}
            onClick={() => sendMessage(item.prompt)}
            className="flex flex-col p-3.5 rounded-xl border border-border bg-card/60 hover:bg-muted/60 transition-all hover:border-primary/40 text-left group shadow-xs"
          >
            <div className="flex items-center gap-2 font-medium text-xs sm:text-sm text-foreground mb-1">
              {item.icon}
              <span>{item.title}</span>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {item.prompt}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
};
