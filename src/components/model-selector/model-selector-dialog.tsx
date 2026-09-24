'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  X,
  Brain,
  Eye,
  Wrench,
  Check,
  RefreshCw,
  Sparkles,
  Server,
  Layers,
} from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { useUIStore } from '@/stores/ui-store';
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

  // Filter models
  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      const matchProvider =
        selectedProviderTab === 'all' || m.providerId === selectedProviderTab;
      const matchSearch =
        !search.trim() ||
        m.displayName.toLowerCase().includes(search.toLowerCase()) ||
        m.modelId.toLowerCase().includes(search.toLowerCase()) ||
        (m.description && m.description.toLowerCase().includes(search.toLowerCase()));
      return matchProvider && matchSearch;
    });
  }, [models, selectedProviderTab, search]);

  const handleSelectModel = (model: Model) => {
    setProviderAndModel(model.providerId, model.modelId);
    setModelSelectorOpen(false);
    addToast(`Switched to ${model.displayName}`, 'info');
  };

  const handleRefreshDiscovery = async () => {
    setIsRefreshing(true);
    try {
      await loadModels(selectedProviderTab === 'all' ? undefined : selectedProviderTab, true);
      addToast('Model catalog refreshed from provider API', 'success');
    } catch (e) {
      addToast('Failed to refresh models', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!modelSelectorOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
      {/* Modal Card */}
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Select AI Model</h2>
          </div>
          <button
            onClick={() => setModelSelectorOpen(false)}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Provider Filter Tabs */}
        <div className="p-4 border-b border-border space-y-3 bg-muted/20">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name, provider, reasoning, vision..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* Provider Filter Tabs */}
          <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs">
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setSelectedProviderTab('all')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  selectedProviderTab === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                All Providers ({models.length})
              </button>

              {providers.map((p) => {
                const count = models.filter((m) => m.providerId === p.id).length;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProviderTab(p.id)}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-colors shrink-0 ${
                      selectedProviderTab === p.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {p.name} ({count})
                  </button>
                );
              })}
            </div>

            {/* Refresh from API button */}
            <button
              onClick={handleRefreshDiscovery}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-medium shrink-0 disabled:opacity-50"
              title="Discover models from API"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-primary' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Models List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredModels.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No models match your search criteria.
            </div>
          ) : (
            filteredModels.map((model) => {
              const isCurrent =
                model.modelId === activeModelId &&
                model.providerId === activeProviderId;
              const providerName =
                providers.find((p) => p.id === model.providerId)?.name ||
                model.providerId;

              return (
                <div
                  key={model.id}
                  onClick={() => handleSelectModel(model)}
                  className={`group flex items-start justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isCurrent
                      ? 'border-primary/60 bg-primary/5 shadow-xs'
                      : 'border-border bg-card hover:bg-muted/50 hover:border-border/80'
                  }`}
                >
                  <div className="space-y-1.5 flex-1 min-w-0 pr-3">
                    {/* Title & Badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground">
                        {model.displayName}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-muted text-[10px] uppercase font-bold text-muted-foreground">
                        {providerName}
                      </span>
                      {model.contextWindow && (
                        <span className="px-2 py-0.5 rounded-md bg-secondary text-[10px] font-medium text-secondary-foreground">
                          {(model.contextWindow / 1000).toFixed(0)}K context
                        </span>
                      )}
                    </div>

                    {/* Capabilities */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {model.capabilities.reasoning && (
                        <span className="inline-flex items-center gap-1 text-purple-400 font-medium">
                          <Brain className="w-3.5 h-3.5" />
                          <span>Reasoning</span>
                        </span>
                      )}
                      {model.capabilities.vision && (
                        <span className="inline-flex items-center gap-1 text-blue-400 font-medium">
                          <Eye className="w-3.5 h-3.5" />
                          <span>Vision</span>
                        </span>
                      )}
                      {model.capabilities.tools && (
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                          <Wrench className="w-3.5 h-3.5" />
                          <span>Tools</span>
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    {model.description && (
                      <p className="text-xs text-muted-foreground/80 line-clamp-1">
                        {model.description}
                      </p>
                    )}
                  </div>

                  {/* Selected check */}
                  {isCurrent && (
                    <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 mt-1">
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
