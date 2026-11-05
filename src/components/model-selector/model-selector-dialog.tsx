'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  X,
  Brain,
  Eye,
  Wrench,
  Check,
  RefreshCw,
  Cpu,
} from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { useUIStore } from '@/stores/ui-store';
import { isFrontierModel } from '@/lib/ai/frontier';
import { Model } from '@/types/chat';

export const ModelSelectorDialog: React.FC = () => {
  const {
    models,
    providers,
    activeModelId,
    activeProviderId,
    setProviderAndModel,
    loadModels,
  } = useChatStore();

  const { modelSelectorOpen, setModelSelectorOpen, addToast } = useUIStore();

  const [search, setSearch] = useState('');
  const [selectedProviderTab, setSelectedProviderTab] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Close with Escape key (R-32)
  useEffect(() => {
    if (!modelSelectorOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModelSelectorOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modelSelectorOpen, setModelSelectorOpen]);

  const filteredModels = useMemo(() => {
    return models
      .filter((m) => {
        const matchProvider =
          selectedProviderTab === 'all' || m.providerId === selectedProviderTab;
        const matchSearch =
          !search.trim() ||
          m.displayName.toLowerCase().includes(search.toLowerCase()) ||
          m.modelId.toLowerCase().includes(search.toLowerCase()) ||
          (m.description && m.description.toLowerCase().includes(search.toLowerCase()));
        return matchProvider && matchSearch;
      })
      .sort((a, b) =>
        (a.displayName || a.name || a.modelId).localeCompare(
          b.displayName || b.name || b.modelId,
          undefined,
          { sensitivity: 'base', numeric: true }
        )
      );
  }, [models, selectedProviderTab, search]);

  const handleSelectModel = (model: Model) => {
    setProviderAndModel(model.providerId, model.modelId);
    setModelSelectorOpen(false);
    addToast(`Model aktif: ${model.displayName}`, 'info');
  };

  const handleRefreshDiscovery = async () => {
    setIsRefreshing(true);
    try {
      await loadModels(selectedProviderTab === 'all' ? undefined : selectedProviderTab, true);
      addToast('Katalog model diperbarui dari API', 'success');
    } catch {
      addToast('Gagal memuat ulang model', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!modelSelectorOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-selector-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/65 backdrop-blur-xs font-sans"
    >
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-secondary/40">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" />
            <h2 id="model-selector-title" className="text-sm sm:text-base font-semibold text-foreground">
              Pilih Model & Provider AI
            </h2>
            <span className="px-2 py-0.5 rounded bg-secondary border border-border text-xs font-mono text-muted-foreground">
              {models.length} model
            </span>
          </div>
          <button
            type="button"
            onClick={() => setModelSelectorOpen(false)}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Tutup pemilih model"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Provider Filter Tabs */}
        <div className="p-4 border-b border-border space-y-3 bg-background/60">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Cari nama model, provider, reasoning, vision..."
              aria-label="Cari model AI"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs">
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedProviderTab('all')}
                className={`min-h-[34px] px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  selectedProviderTab === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                Semua ({models.length})
              </button>

              {providers.map((p) => {
                const count = models.filter((m) => m.providerId === p.id).length;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedProviderTab(p.id)}
                    className={`min-h-[34px] px-3 py-1.5 rounded-lg font-medium transition-colors shrink-0 ${
                      selectedProviderTab === p.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {p.name} ({count})
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleRefreshDiscovery}
              disabled={isRefreshing}
              className="min-h-[34px] flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-medium shrink-0 disabled:opacity-50"
              title="Perbarui daftar model dari API"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-primary' : ''}`} />
              <span className="hidden sm:inline">Sinkronkan</span>
            </button>
          </div>
        </div>

        {/* Models List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredModels.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <p className="text-sm font-medium text-foreground">
                Tidak ada model yang cocok dengan filter &ldquo;{search}&rdquo;.
              </p>
              <p className="text-xs text-muted-foreground">
                Ubah kata kunci pencarian atau pilih tab provider Semua.
              </p>
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="px-3 py-1.5 rounded-lg border border-border bg-secondary text-xs font-medium text-foreground hover:bg-muted"
                >
                  Reset Filter
                </button>
              )}
            </div>
          ) : (
            filteredModels.map((model, idx) => {
              const isCurrent =
                model.modelId === activeModelId &&
                model.providerId === activeProviderId;
              const providerName =
                providers.find((p) => p.id === model.providerId)?.name ||
                model.providerId;
              const isFrontier = isFrontierModel(model);

              const firstChar = (model.displayName || model.name || model.modelId).trim().charAt(0).toUpperCase();
              const prevChar =
                idx > 0
                  ? (filteredModels[idx - 1].displayName || filteredModels[idx - 1].name || filteredModels[idx - 1].modelId).trim().charAt(0).toUpperCase()
                  : null;
              const showLetterHeader = !search.trim() && firstChar !== prevChar;

              return (
                <React.Fragment key={model.id}>
                  {showLetterHeader && (
                    <div className="sticky top-0 z-10 -mx-1 px-3 py-1 bg-card/95 backdrop-blur-xs border-y border-border/40 text-[11px] font-bold text-primary tracking-wider uppercase flex items-center gap-2">
                      <span>{firstChar}</span>
                      <div className="h-px bg-border/40 flex-1" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleSelectModel(model)}
                    className={`w-full text-left flex items-start justify-between p-3.5 rounded-xl border transition-colors ${
                      isCurrent
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-card hover:bg-secondary/60'
                    }`}
                  >
                    <div className="space-y-1.5 flex-1 min-w-0 pr-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground">
                          {model.displayName}
                        </span>

                        {isFrontier && (
                          <span className="px-2 py-0.5 rounded bg-primary/15 border border-primary/30 text-[10px] font-mono font-semibold text-primary">
                            Frontier
                          </span>
                        )}

                        <span className="px-2 py-0.5 rounded bg-secondary border border-border text-[10px] font-mono text-muted-foreground">
                          {providerName}
                        </span>

                        {model.contextWindow && (
                          <span className="px-2 py-0.5 rounded bg-secondary border border-border text-[10px] font-mono text-muted-foreground">
                            {(model.contextWindow / 1000).toFixed(0)}K ctx
                          </span>
                        )}
                      </div>

                      {/* Capabilities (Monochrome + single accent - R-29) */}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {model.capabilities.reasoning && (
                          <span className="inline-flex items-center gap-1 font-medium text-foreground/85">
                            <Brain className="w-3.5 h-3.5 text-primary" />
                            <span>Reasoning</span>
                          </span>
                        )}
                        {model.capabilities.vision && (
                          <span className="inline-flex items-center gap-1 font-medium text-foreground/85">
                            <Eye className="w-3.5 h-3.5 text-primary" />
                            <span>Vision</span>
                          </span>
                        )}
                        {model.capabilities.tools && (
                          <span className="inline-flex items-center gap-1 font-medium text-foreground/85">
                            <Wrench className="w-3.5 h-3.5 text-primary" />
                            <span>Tools</span>
                          </span>
                        )}
                      </div>

                      {model.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {model.description}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 mt-1">
                      {isCurrent && (
                        <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      )}
                    </div>
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
