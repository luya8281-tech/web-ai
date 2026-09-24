'use client';

import React from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useUIStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((toast) => {
        let Icon = Info;
        let colorClasses = 'border-border bg-card text-foreground';

        if (toast.type === 'success') {
          Icon = CheckCircle;
          colorClasses = 'border-emerald-500/30 bg-card text-foreground';
        } else if (toast.type === 'error') {
          Icon = AlertCircle;
          colorClasses = 'border-destructive/30 bg-card text-foreground';
        }

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl border shadow-lg text-xs font-medium animate-slide-in-up ${colorClasses}`}
          >
            <div className="flex items-center gap-2.5">
              <Icon
                className={`w-4 h-4 shrink-0 ${
                  toast.type === 'success'
                    ? 'text-emerald-400'
                    : toast.type === 'error'
                    ? 'text-destructive'
                    : 'text-primary'
                }`}
              />
              <span className="leading-snug">{toast.message}</span>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-muted-foreground hover:text-foreground p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
