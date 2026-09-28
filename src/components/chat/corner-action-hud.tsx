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

      {/* ================= TOP-LEFT CORNER: Animated HUD Bracket ================= */}
      <div className="absolute top-14 left-3 sm:left-6 flex items-center gap-2.5">
        <div className="relative w-4 h-4">
          <div className="w-full h-full border-t-2 border-l-2 border-primary rounded-tl-md shadow-[0_0_10px_rgba(59,130,246,0.8)] animate-pulse" />
          <span className="absolute top-0 left-0 w-1.5 h-1.5 bg-primary rounded-full animate-ping opacity-90" />
        </div>
        <span className="text-[10px] tracking-wider uppercase font-semibold text-primary/80 select-none hidden sm:inline">
          Menjalankan Aksi
        </span>
      </div>

      {/* ================= TOP-RIGHT CORNER: Animated HUD Bracket ================= */}
      <div className="absolute top-14 right-3 sm:right-6 flex items-center gap-2.5">
        <span className="w-2 h-2 rounded-full bg-primary animate-pulse" style={{ animationDuration: '1.5s' }} />
        <div className="relative w-4 h-4">
          <div className="w-full h-full border-t-2 border-r-2 border-primary rounded-tr-md shadow-[0_0_10px_rgba(59,130,246,0.8)] animate-pulse" />
          <span className="absolute top-0 right-0 w-1.5 h-1.5 bg-primary rounded-full animate-ping opacity-90" />
        </div>
      </div>

      {/* ================= BOTTOM-LEFT CORNER: Animated HUD Bracket ================= */}
      <div className="absolute bottom-24 left-3 sm:left-6 flex items-center gap-2">
        <div className="relative w-4 h-4">
          <div className="w-full h-full border-b-2 border-l-2 border-primary rounded-bl-md shadow-[0_0_10px_rgba(59,130,246,0.8)] animate-pulse" />
          <span className="absolute bottom-0 left-0 w-1.5 h-1.5 bg-primary rounded-full animate-ping opacity-90" />
        </div>
      </div>

      {/* ================= BOTTOM-RIGHT CORNER: Animated HUD Bracket & Live Pill ================= */}
      <div className="absolute bottom-24 right-3 sm:right-6 flex items-center gap-2.5">
        {currentAction && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/95 border border-primary/40 text-foreground text-xs font-medium shadow-xl shadow-primary/10 backdrop-blur-xl max-w-[240px] sm:max-w-xs truncate animate-in fade-in slide-in-from-bottom-2 duration-200">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" style={{ animationDuration: '1.2s' }} />
            <span className="truncate text-xs font-semibold">{currentAction.label}</span>
          </div>
        )}
        <div className="relative w-4 h-4">
          <div className="w-full h-full border-b-2 border-r-2 border-primary rounded-br-md shadow-[0_0_10px_rgba(59,130,246,0.8)] animate-pulse" />
          <span className="absolute bottom-0 right-0 w-1.5 h-1.5 bg-primary rounded-full animate-ping opacity-90" />
        </div>
      </div>
    </div>
  );
};
