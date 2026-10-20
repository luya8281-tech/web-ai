'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Menu,
  Plus,
  Settings,
  BookOpen,
  Pin,
  Download,
  ChevronDown,
  Terminal,
  Plug,
  ShieldAlert,
  KeyRound,
} from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { useUIStore } from '@/stores/ui-store';
import { AbstractSpinner } from './abstract-spinner';

export const TopNav: React.FC = () => {
  const {
    activeConversation,
    messages,
    newChat,
    pinConversation,
    projects,
    activeProjectId,
    activeModelId,
    activeProviderId,
    models,
    providers,
    setProviderAndModel,
    temporaryChat,
    setTemporaryChat,
    isGenerating,
    generatingActions,
  } = useChatStore();

  const {
    toggleSidebar,
    setSettingsOpen,
    setSkillsDialogOpen,
    setConnectorsDialogOpen,
    setVaultDialogOpen,
    setModelSelectorOpen,
    workspaceOpen,
    setWorkspaceOpen,
    activeConnectors,
    addToast,
  } = useUIStore();

  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeProject = projects.find(
    (p) => p.id === (activeConversation?.projectId || activeProjectId)
  );
  const activeModel = models.find(
    (m) => m.modelId === activeModelId || m.id === activeModelId
  );

  const isExecuting = isGenerating && generatingActions.some((a) => a.status === 'running');
  const currentRunningAction =
    generatingActions.find((a) => a.status === 'running') ||
    (generatingActions.length > 0 ? generatingActions[generatingActions.length - 1] : null);

  const getShortModelName = () => {
    const raw = activeModel?.displayName || activeModel?.name || activeModelId || 'Pilih Model';
    return raw.length > 22 ? raw.slice(0, 20) + '…' : raw;
  };

  const handleExportMarkdown = () => {
    if (!activeConversation?.id) return;
    window.open(`/api/conversations/${activeConversation.id}/export?format=markdown`, '_blank');
  };

  const handleTogglePin = async () => {
    if (!activeConversation?.id) return;
    const nextPinned = !activeConversation.pinned;
    await pinConversation(activeConversation.id, nextPinned);
  };

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between h-11 sm:h-12 px-2.5 sm:px-5 bg-background/90 backdrop-blur-md font-sans">
      {/* Left: Sidebar Toggle, Active Project, Conversation Title & Live Agent Status */}
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 pr-1.5">
        <button
          type="button"
          onClick={toggleSidebar}
          className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 flex items-center justify-center transition-colors shrink-0"
          title="Buka atau tutup navigasi sidebar"
          aria-label="Buka atau tutup navigasi sidebar"
        >
          <Menu className="w-4 h-4" />
        </button>

        {activeProject && (
          <span
            className="hidden md:inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border truncate max-w-[120px] shrink-0"
            style={{
              borderColor: activeProject.color || 'var(--primary)',
              color: activeProject.color || 'var(--primary)',
            }}
          >
            {activeProject.name}
          </span>
        )}

        <div className="min-w-0 flex items-center gap-1.5">
          <h1 className="text-xs sm:text-sm font-semibold text-foreground truncate max-w-[115px] sm:max-w-[240px] md:max-w-[320px]">
            {activeConversation?.title || 'Ruang Kerja'}
          </h1>

          {(isGenerating || isExecuting) && (
            <button
              type="button"
              onClick={() => {
                const actType = currentRunningAction?.type;
                if (actType === 'BUKA_WEB' || actType === 'SCREENSHOT_WEB' || actType === 'BROWSER') {
                  setWorkspaceOpen(true, 'browser', currentRunningAction);
                } else if (actType === 'CARI_WEB') {
                  setWorkspaceOpen(true, 'sources', currentRunningAction);
                } else {
                  setWorkspaceOpen(true, 'terminal', currentRunningAction);
                }
              }}
              className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-[11px] text-primary font-medium shrink-0 hover:bg-primary/20 transition-colors"
              title="Agen sedang bekerja — Klik untuk membuka CLI / Web Aktif"
            >
              <AbstractSpinner size={12} className="text-primary" />
              <span className="truncate max-w-[180px]">
                {isExecuting && currentRunningAction
                  ? `${currentRunningAction.type}: Live Panel`
                  : 'Menyusun respons...'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Right: Compact Mobile Controls + Desktop Tools */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        {/* Claude-Style Chatbot Model Selector Pill */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
            className="h-7 sm:h-8 px-2 sm:px-2.5 rounded-lg border border-border bg-card hover:bg-muted text-foreground text-[11px] sm:text-xs font-medium flex items-center gap-1 sm:gap-1.5 transition-colors"
            title="Pilih model AI"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            <span className="truncate max-w-[92px] sm:max-w-[160px]">{getShortModelName()}</span>
            <ChevronDown
              className={`w-3 h-3 sm:w-3.5 sm:h-3.5 text-muted-foreground transition-transform duration-150 shrink-0 ${
                modelDropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {modelDropdownOpen && (
            <div className="absolute right-0 mt-1.5 w-68 sm:w-72 rounded-xl border border-border bg-card shadow-2xl py-1.5 z-50 text-xs">
              <div className="px-3 py-1.5 border-b border-border flex items-center justify-between">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  Model Chatbot Aktif
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setModelDropdownOpen(false);
                    setModelSelectorOpen(true);
                  }}
                  className="text-[11px] font-medium text-primary hover:underline"
                >
                  Semua Model ({models.length})
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto py-1 divide-y divide-border/30">
                {models.slice(0, 12).map((m) => {
                  const isSelected = m.modelId === activeModelId || m.id === activeModelId;
                  const provName =
                    providers.find((p) => p.id === m.providerId)?.name || m.providerId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setProviderAndModel(m.providerId, m.modelId);
                        setModelDropdownOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors ${
                        isSelected
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-foreground hover:bg-muted/60'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{m.displayName || m.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                          {provName}
                        </div>
                      </div>
                      {isSelected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="border-t border-border mt-1 pt-1 px-1.5 space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setTemporaryChat(!temporaryChat);
                    setModelDropdownOpen(false);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg text-left flex items-center justify-between hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <ShieldAlert className="w-3.5 h-3.5 text-primary" />
                    <span>Mode Chat Sementara</span>
                  </span>
                  <span className="text-[10px] font-mono">
                    {temporaryChat ? 'AKTIF' : 'NONAKTIF'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Live CLI / Terminal / Active Web Workspace Toggle */}
        <button
          type="button"
          onClick={() => setWorkspaceOpen(!workspaceOpen)}
          className={`h-7 sm:h-8 px-2 sm:px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
            workspaceOpen
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card hover:bg-muted text-foreground'
          }`}
          title="Buka atau tutup panel CLI & Web Aktif di bawah chat"
        >
          <Terminal className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">CLI & Web</span>
          {generatingActions.length > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          )}
        </button>

        {/* Connectors Hub Button (Desktop) */}
        <button
          type="button"
          onClick={() => setConnectorsDialogOpen(true)}
          className="hidden md:flex h-8 px-2.5 rounded-lg border border-border bg-card hover:bg-muted text-foreground text-xs font-medium items-center gap-1.5 transition-colors"
          title="Konektor AI"
        >
          <Plug className="w-3.5 h-3.5 text-primary" />
          <span className="hidden xl:inline">Konektor</span>
        </button>

        {/* Skills Catalog Button (Desktop) */}
        <button
          type="button"
          onClick={() => setSkillsDialogOpen(true)}
          className="hidden md:flex h-8 px-2.5 rounded-lg border border-border bg-card hover:bg-muted text-foreground text-xs font-medium items-center gap-1.5 transition-colors"
          title="Buka Katalog Skill Server"
        >
          <BookOpen className="w-3.5 h-3.5 text-primary" />
          <span className="hidden xl:inline">Skill</span>
        </button>

        {/* Vault / Brankas Sandi & Email Button (Desktop & Mobile) */}
        <button
          type="button"
          onClick={() => setVaultDialogOpen(true)}
          className="flex h-7 sm:h-8 px-2 sm:px-2.5 rounded-lg border border-border bg-card hover:bg-muted text-foreground text-xs font-medium items-center gap-1.5 transition-colors"
          title="Buka Brankas Sandi & Email (Vault)"
        >
          <KeyRound className="w-3.5 h-3.5 text-primary" />
          <span className="hidden md:inline">Vault</span>
        </button>

        {/* Pin & Export when conversation is active (Desktop) */}
        {activeConversation && (
          <button
            type="button"
            onClick={handleTogglePin}
            className={`hidden lg:flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
              activeConversation.pinned
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground'
            }`}
            title={activeConversation.pinned ? 'Lepas sematan' : 'Sematkan percakapan'}
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
        )}

        {activeConversation && messages.length > 0 && (
          <button
            type="button"
            onClick={handleExportMarkdown}
            className="hidden lg:flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Unduh transkrip (.md)"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        )}

        {/* New Chat Button */}
        <button
          type="button"
          onClick={() => newChat()}
          className="h-7 w-7 sm:h-8 sm:w-auto sm:px-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
          title="Mulai percakapan baru"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.2]" />
          <span className="hidden sm:inline">Baru</span>
        </button>

        {/* Settings Button (Desktop - on mobile available via Sidebar) */}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="hidden sm:flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          title="Pengaturan"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
