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
    <header className="sticky top-0 z-20 flex items-center justify-between h-14 px-3 sm:px-4 border-b border-border bg-background/95 backdrop-blur-sm">
      {/* Left section: Sidebar toggle & Model selector */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Toggle sidebar (Ctrl+B)"
          aria-label="Toggle sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>

        <button
          onClick={() => newChat()}
          className="hidden sm:flex items-center gap-1.5 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs font-medium"
          title="New Chat (Ctrl+Shift+O)"
        >
          <Plus className="w-4 h-4" />
        </button>

        {/* Model Selector Pill */}
        <button
          onClick={() => setModelSelectorOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/70 bg-card hover:bg-muted/80 text-foreground transition-all shadow-sm max-w-[280px] sm:max-w-xs"
        >
          <div className="flex items-center gap-1.5 truncate">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="font-semibold text-xs sm:text-sm truncate">
              {activeModel?.displayName || activeModelId || 'Select Model'}
            </span>
          </div>

          {/* Quick Capability Icons */}
          <div className="hidden md:flex items-center gap-1 text-muted-foreground/80 shrink-0">
            {activeModel?.capabilities.reasoning && (
              <span title="Reasoning model">
                <Brain className="w-3.5 h-3.5 text-purple-400" />
              </span>
            )}
            {activeModel?.capabilities.vision && (
              <span title="Vision capable">
                <Eye className="w-3.5 h-3.5 text-blue-400" />
              </span>
            )}
          </div>

          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-0.5" />
        </button>

        {/* Project Tag */}
        {activeProject && (
          <span
            className="hidden lg:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border"
            style={{ borderColor: activeProject.color || '#3b82f6', color: activeProject.color || '#3b82f6' }}
          >
            📁 {activeProject.name}
          </span>
        )}
      </div>

      {/* Right section: Temporary chat, Export, Settings */}
      <div className="flex items-center gap-1 sm:gap-2">
        {/* Temporary / Private Chat Indicator */}
        <button
          onClick={() => setTemporaryChat(!temporaryChat)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            temporaryChat
              ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
          title="Temporary Chat (Not saved in history)"
        >
          <Shield className="w-4 h-4" />
          <span className="hidden sm:inline">
            {temporaryChat ? 'Incognito' : 'Temporary'}
          </span>
        </button>

        {/* Share / Export Dropdown */}
        <div className="relative">
          <button
            onClick={() => setExportOpen(!exportOpen)}
            disabled={!activeConversation}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
            title="Export conversation"
            aria-label="Export conversation"
          >
            <Share2 className="w-4 h-4" />
          </button>

          {exportOpen && (
            <div className="absolute right-0 mt-2 w-44 rounded-xl border border-border bg-card shadow-lg py-1.5 z-30 animate-fade-in text-xs font-medium">
              <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
                Export Chat
              </div>
              <button
                onClick={() => handleExport('markdown')}
                className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between text-foreground"
              >
                <span>Markdown (.md)</span>
                <Download className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
              <button
                onClick={() => handleExport('json')}
                className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between text-foreground"
              >
                <span>JSON (.json)</span>
                <Download className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
              <button
                onClick={() => handleExport('txt')}
                className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between text-foreground"
              >
                <span>Plain Text (.txt)</span>
                <Download className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
          )}
        </div>

        {/* Settings button */}
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Settings (Ctrl+,)"
          aria-label="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
