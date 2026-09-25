'use client';

import React, { useState } from 'react';
import {
  Menu,
  ChevronDown,
  Share2,
  Plus,
  Shield,
  Download,
  Settings,
  Sparkles,
  Eye,
  Brain,
  Wrench,
  MoreVertical,
  ArrowLeft,
} from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { useUIStore } from '@/stores/ui-store';

export const TopNav: React.FC = () => {
  const {
    activeConversation,
    activeProviderId,
    activeModelId,
    models,
    providers,
    temporaryChat,
    setTemporaryChat,
    newChat,
    projects,
    activeProjectId,
  } = useChatStore();

  const { toggleSidebar, setModelSelectorOpen, setSettingsOpen, addToast } = useUIStore();
  const [exportOpen, setExportOpen] = useState(false);

  const activeModel = models.find(m => m.modelId === activeModelId || m.id === activeModelId);
  const activeProvider = providers.find(p => p.id === activeProviderId);
  const activeProject = projects.find(p => p.id === (activeConversation?.projectId || activeProjectId));

  const handleExport = async (format: 'markdown' | 'json' | 'txt') => {
    setExportOpen(false);
    if (!activeConversation) {
      addToast('No active conversation to export', 'error');
      return;
    }
    try {
      const res = await fetch(`/api/conversations/${activeConversation.id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      });
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeConversation.title || 'conversation'}.${format === 'markdown' ? 'md' : format}`;
      a.click();
      URL.revokeObjectURL(url);
      addToast(`Exported as ${format.toUpperCase()}`, 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between h-14 px-3 sm:px-4 border-b border-border/40 bg-background/95 backdrop-blur-sm">
      {/* Left: Menu toggle */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          title="Toggle sidebar (Ctrl+B)"
          aria-label="Toggle sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Project Tag (desktop) */}
        {activeProject && (
          <span
            className="hidden lg:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border"
            style={{ borderColor: activeProject.color || '#3b82f6', color: activeProject.color || '#3b82f6' }}
          >
            📁 {activeProject.name}
          </span>
        )}
      </div>

      {/* Center: Conversation Title or Claude Branding */}
      <div className="text-center truncate px-2 max-w-[180px] sm:max-w-xs md:max-w-md">
        <span className="font-medium text-xs sm:text-sm text-foreground/85 truncate block">
          {activeConversation?.title || 'Claude'}
        </span>
      </div>

      {/* Right: New Chat Pill (+) & More Options (⋮) */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => newChat()}
          className="w-8 h-8 rounded-full bg-muted/70 hover:bg-muted text-foreground flex items-center justify-center transition-colors shadow-xs"
          title="Percakapan Baru"
          aria-label="Percakapan Baru"
        >
          <Plus className="w-4 h-4 stroke-[2.2]" />
        </button>

        <button
          onClick={() => setSettingsOpen(true)}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          title="Pengaturan"
          aria-label="Pengaturan"
        >
          <MoreVertical className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};
