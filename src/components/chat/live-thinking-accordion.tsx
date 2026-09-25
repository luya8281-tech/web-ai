'use client';

import React, { useState } from 'react';
import { Brain, ChevronDown } from 'lucide-react';

interface LiveThinkingAccordionProps {
  reasoning: string;
  isLive?: boolean;
}

export const LiveThinkingAccordion: React.FC<LiveThinkingAccordionProps> = ({ reasoning, isLive = false }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!reasoning || !reasoning.trim()) return null;

  const wordCount = reasoning.trim().split(/\s+/).length;

  return (
    <div className="my-2.5 rounded-xl border border-purple-500/25 bg-purple-950/15 overflow-hidden transition-all duration-200 shadow-xs">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3.5 py-2 text-xs text-purple-300 hover:text-purple-200 hover:bg-purple-900/20 transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 font-medium">
          <div className="relative flex items-center justify-center">
            <Brain className={`w-3.5 h-3.5 text-purple-400 ${isLive ? 'animate-pulse' : ''}`} />
            {isLive && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping" />
            )}
          </div>
          <span>{isLive ? 'Sedang Berpikir...' : 'Proses Pemikiran (Thinking)'}</span>
          <span className="text-[10px] text-purple-400/60 font-mono">({wordCount} kata)</span>
        </div>

        <div className="flex items-center gap-1.5 text-purple-400/70 text-[11px]">
          <span>{isOpen ? 'Sembunyikan' : 'Buka'}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && (
        <div className="px-3.5 py-3 border-t border-purple-500/15 bg-black/30 font-mono text-[11.5px] text-purple-200/80 whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto select-text">
          {reasoning}
        </div>
      )}
    </div>
  );
};
