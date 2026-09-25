'use client';

import React from 'react';
import { ActionInfo } from '@/types/chat';

interface CornerActionHUDProps {
  isExecuting: boolean;
  currentAction?: ActionInfo | null;
}

export const CornerActionHUD: React.FC<CornerActionHUDProps> = ({
  isExecuting,
  currentAction,
}) => {
  if (!isExecuting) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-30 transition-opacity duration-700 animate-fade-in overflow-hidden">
      {/* Soft Ambient Corner Vignettes - Warm Organic Claude Glow */}
      <div className="absolute top-0 left-0 w-48 h-48 bg-radial from-primary/[0.07] via-primary/[0.02] to-transparent rounded-full blur-2xl animate-pulse" style={{ animationDuration: '4s' }} />
      <div className="absolute top-0 right-0 w-48 h-48 bg-radial from-primary/[0.07] via-primary/[0.02] to-transparent rounded-full blur-2xl animate-pulse" style={{ animationDuration: '4s', animationDelay: '1s' }} />
      <div className="absolute bottom-16 left-0 w-48 h-48 bg-radial from-primary/[0.07] via-primary/[0.02] to-transparent rounded-full blur-2xl animate-pulse" style={{ animationDuration: '4s', animationDelay: '2s' }} />
      <div className="absolute bottom-16 right-0 w-48 h-48 bg-radial from-primary/[0.07] via-primary/[0.02] to-transparent rounded-full blur-2xl animate-pulse" style={{ animationDuration: '4s', animationDelay: '3s' }} />

      {/* ================= TOP-LEFT CORNER: Minimalist Hairline Accent ================= */}
      <div className="absolute top-16 left-4 sm:left-6 flex items-center gap-2">
        <div className="w-3.5 h-3.5 border-t border-l border-primary/40 rounded-tl-[3px] transition-all" />
        <span className="text-[10px] tracking-wider uppercase font-medium text-primary/70 select-none hidden sm:inline">
          Menjalankan Aksi
        </span>
      </div>

      {/* ================= TOP-RIGHT CORNER: Minimalist Hairline Accent ================= */}
      <div className="absolute top-16 right-4 sm:right-6 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-primary/80 animate-pulse" style={{ animationDuration: '2s' }} />
        <div className="w-3.5 h-3.5 border-t border-r border-primary/40 rounded-tr-[3px] transition-all" />
      </div>

      {/* ================= BOTTOM-LEFT CORNER: Minimalist Hairline Accent ================= */}
      <div className="absolute bottom-28 left-4 sm:left-6 flex items-center gap-2">
        <div className="w-3.5 h-3.5 border-b border-l border-primary/40 rounded-bl-[3px] transition-all" />
      </div>

      {/* ================= BOTTOM-RIGHT CORNER: Elegant Floating Pill ================= */}
      <div className="absolute bottom-28 right-4 sm:right-6 flex items-center gap-2.5">
        {currentAction && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/90 border border-primary/25 text-foreground/90 text-xs font-medium shadow-md shadow-black/5 backdrop-blur-md max-w-[240px] sm:max-w-xs truncate animate-slide-in-up">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" style={{ animationDuration: '1.8s' }} />
            <span className="truncate text-xs">{currentAction.label}</span>
          </div>
        )}
        <div className="w-3.5 h-3.5 border-b border-r border-primary/40 rounded-br-[3px] transition-all" />
      </div>
    </div>
  );
};
