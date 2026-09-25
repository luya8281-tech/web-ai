'use client';

import React, { useState } from 'react';
import {
  X,
  Sliders,
  Palette,
  MessageSquare,
  Server,
  Keyboard,
  Plus,
  Check,
  AlertCircle,
  Loader2,
  Trash2,
  Edit2,
  ExternalLink,
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settings-store';
import { useChatStore } from '@/stores/chat-store';
import { useUIStore } from '@/stores/ui-store';
import { Provider } from '@/types/chat';

export const SettingsDialog: React.FC = () => {
  const { settings, updateSettings } = useSettingsStore();
  const { providers, loadProviders, loadModels } = useChatStore();
  const { settingsOpen, setSettingsOpen, currentSettingsTab, addToast } = useUIStore();

  const [activeTab, setActiveTab] = useState<'general' | 'appearance' | 'chat' | 'providers' | 'shortcuts'>(
    (currentSettingsTab as any) || 'general'
  );

  // New Provider Form State
  const [addingProvider, setAddingProvider] = useState(false);
  const [providerForm, setProviderForm] = useState({
    id: '',
    name: '',
    baseUrl: '',
    apiKey: '',
    protocol: 'openai-compatible' as 'openai-compatible' | 'anthropic-compatible' | 'mock' | 'antigravity-agent',
  });
  const [testStatus, setTestStatus] = useState<{ loading: boolean; ok?: boolean; message?: string } | null>(null);

  // Edit Provider State
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editProviderForm, setEditProviderForm] = useState({
    name: '',
    baseUrl: '',
    apiKey: '',
  });
  const [editSaving, setEditSaving] = useState(false);

  if (!settingsOpen) return null;

  const handleTestConnection = async () => {
    if (!providerForm.baseUrl) {
      setTestStatus({ loading: false, ok: false, message: 'Base URL is required' });
      return;
    }
    setTestStatus({ loading: true });
    try {
      const res = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: providerForm.baseUrl,
          apiKey: providerForm.apiKey || undefined,
          protocol: providerForm.protocol,
        }),
      });
      const data = await res.json();
      setTestStatus({ loading: false, ok: data.ok, message: data.message });
    } catch (e: any) {
      setTestStatus({ loading: false, ok: false, message: e.message });
    }
  };

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!providerForm.name || !providerForm.baseUrl) {
      addToast('Name and Base URL are required', 'error');
      return;
    }
    const safeId = providerForm.id.trim() || providerForm.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: safeId,
          name: providerForm.name,
          baseUrl: providerForm.baseUrl,
          apiKey: providerForm.apiKey || undefined,
          protocol: providerForm.protocol,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create provider');
      }

      await loadProviders();
      await loadModels(safeId, true);
      addToast(`Provider "${providerForm.name}" connected!`, 'success');
      setAddingProvider(false);
      setProviderForm({ id: '', name: '', baseUrl: '', apiKey: '', protocol: 'openai-compatible' });
      setTestStatus(null);
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const handleDeleteProvider = async (id: string, name: string) => {
    if (!confirm(`Delete provider "${name}"?`)) return;
    try {
      const res = await fetch(`/api/providers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await loadProviders();
        await loadModels();
        addToast(`Provider "${name}" removed`, 'info');
      }
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const startEditProvider = (p: Provider) => {
    setEditingProviderId(p.id);
    setEditProviderForm({ name: p.name, baseUrl: p.baseUrl || '', apiKey: '' });
  };

  const handleSaveEditProvider = async () => {
    if (!editingProviderId) return;
    setEditSaving(true);
    try {
      const body: Record<string, any> = {};
      if (editProviderForm.name) body.name = editProviderForm.name;
      if (editProviderForm.baseUrl) body.baseUrl = editProviderForm.baseUrl;
      if (editProviderForm.apiKey) body.apiKey = editProviderForm.apiKey;

      const res = await fetch(`/api/providers/${editingProviderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update provider');
      }
      await loadProviders();
      addToast('Provider updated', 'success');
      setEditingProviderId(null);
    } catch (e: any) {
      addToast(e.message, 'error');
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
      <div className="relative w-full max-w-3xl h-[80vh] flex flex-col md:flex-row rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Settings Sidebar */}
        <div className="w-full md:w-56 p-3 border-b md:border-b-0 md:border-r border-border bg-muted/20 flex md:flex-col gap-1 overflow-x-auto shrink-0">
          <div className="hidden md:block px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Settings
          </div>

          <button
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 ${
              activeTab === 'general' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>General</span>
          </button>

          <button
            onClick={() => setActiveTab('appearance')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 ${
              activeTab === 'appearance' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Palette className="w-4 h-4" />
            <span>Appearance</span>
          </button>

          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 ${
              activeTab === 'chat' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Chat Settings</span>
          </button>

          <button
            onClick={() => setActiveTab('providers')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 ${
              activeTab === 'providers' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>AI Providers</span>
          </button>

          <button
            onClick={() => setActiveTab('shortcuts')}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 ${
              activeTab === 'shortcuts' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Keyboard className="w-4 h-4" />
            <span>Shortcuts</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-card">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h3 className="text-base font-semibold text-foreground capitalize">
              {activeTab === 'providers' ? 'AI Provider Management' : `${activeTab} Settings`}
            </h3>
            <button
              onClick={() => setSettingsOpen(false)}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm">
            {/* 1. GENERAL TAB */}
            {activeTab === 'general' && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">Send Message on Enter</div>
                    <div className="text-xs text-muted-foreground">Press Shift+Enter for new line</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.sendOnEnter}
                    onChange={(e) => updateSettings({ sendOnEnter: e.target.checked })}
                    className="w-4 h-4 accent-primary rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">Automatic Conversation Titles</div>
                    <div className="text-xs text-muted-foreground">Generate title from first prompt automatically</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.autoTitle}
                    onChange={(e) => updateSettings({ autoTitle: e.target.checked })}
                    className="w-4 h-4 accent-primary rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">Show Message Timestamps</div>
                    <div className="text-xs text-muted-foreground">Display exact time next to messages</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.showTimestamps}
                    onChange={(e) => updateSettings({ showTimestamps: e.target.checked })}
                    className="w-4 h-4 accent-primary rounded"
                  />
                </div>
              </div>
            )}

            {/* 2. APPEARANCE TAB */}
            {activeTab === 'appearance' && (
              <div className="space-y-5">
                <div>
                  <label className="block font-medium text-foreground mb-2">Theme</label>
                  <div className="grid grid-cols-3 gap-3">
                    {['dark', 'light', 'system'].map((t) => (
                      <button
                        key={t}
                        onClick={() => updateSettings({ theme: t as any })}
                        className={`p-3 rounded-xl border text-xs font-semibold capitalize transition-all ${
                          settings.theme === t
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted/40 hover:bg-muted text-muted-foreground'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-2">Font Size</label>
                  <div className="grid grid-cols-3 gap-3">
                    {['small', 'normal', 'large'].map((s) => (
                      <button
                        key={s}
                        onClick={() => updateSettings({ fontSize: s as any })}
                        className={`p-3 rounded-xl border text-xs font-semibold capitalize transition-all ${
                          settings.fontSize === s
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-muted/40 hover:bg-muted text-muted-foreground'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div>
                    <div className="font-medium text-foreground">Compact Message Mode</div>
                    <div className="text-xs text-muted-foreground">Reduce vertical message padding</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.compactMode}
                    onChange={(e) => updateSettings({ compactMode: e.target.checked })}
                    className="w-4 h-4 accent-primary rounded"
                  />
                </div>
              </div>
            )}

            {/* 3. CHAT TAB */}
            {activeTab === 'chat' && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">Stream Responses</div>
                    <div className="text-xs text-muted-foreground">Stream tokens progressively via SSE</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.streamResponses}
                    onChange={(e) => updateSettings({ streamResponses: e.target.checked })}
                    className="w-4 h-4 accent-primary rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">Code Line Numbers</div>
                    <div className="text-xs text-muted-foreground">Display gutter line numbers in code blocks</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.codeLineNumbers}
                    onChange={(e) => updateSettings({ codeLineNumbers: e.target.checked })}
                    className="w-4 h-4 accent-primary rounded"
                  />
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Global System Prompt</label>
                  <div className="text-xs text-muted-foreground mb-2">
                    Default instructions applied when not overridden by conversation or project.
                  </div>
                  <textarea
                    value={settings.systemPrompt}
                    onChange={(e) => updateSettings({ systemPrompt: e.target.value })}
                    rows={4}
                    className="w-full p-3 rounded-xl border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                  />
                </div>
              </div>
            )}

            {/* 4. PROVIDERS TAB */}
            {activeTab === 'providers' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    Connect OpenAI-compatible endpoints, VPS AI gateways, or Anthropic services.
                  </div>
                  {!addingProvider && (
                    <button
                      onClick={() => setAddingProvider(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary-hover transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Provider</span>
                    </button>
                  )}
                </div>

                {/* Add Provider Form */}
                {addingProvider && (
                  <form onSubmit={handleSaveProvider} className="p-4 rounded-xl border border-primary/40 bg-muted/20 space-y-3">
                    <div className="font-semibold text-foreground text-xs uppercase tracking-wide">
                      Connect New Provider
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Provider Name</label>
                        <input
                          type="text"
                          placeholder="e.g. My VPS AI / vLLM / Ollama"
                          value={providerForm.name}
                          onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
                          required
                          className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Protocol</label>
                        <select
                          value={providerForm.protocol}
                          onChange={(e) => setProviderForm({ ...providerForm, protocol: e.target.value as any })}
                          className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-xs"
                        >
                          <option value="openai-compatible">OpenAI Compatible (vLLM, Ollama, xKiro, Vyce)</option>
                          <option value="antigravity-agent">Antigravity Native Agent (Tools, Bash, Skills)</option>
                          <option value="anthropic-compatible">Anthropic Compatible</option>
                          <option value="mock">Development Mock</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Base URL</label>
                      <input
                        type="url"
                        placeholder="http://127.0.0.1:8000/v1 or https://..."
                        value={providerForm.baseUrl}
                        onChange={(e) => setProviderForm({ ...providerForm, baseUrl: e.target.value })}
                        required
                        className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">API Key (Stored Server-Side)</label>
                      <input
                        type="password"
                        placeholder="sk-... or token (optional for local models)"
                        value={providerForm.apiKey}
                        onChange={(e) => setProviderForm({ ...providerForm, apiKey: e.target.value })}
                        className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-xs font-mono"
                      />
                    </div>

                    {/* Test Connection Button & Result Indicator */}
                    <div className="pt-1 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={handleTestConnection}
                        disabled={testStatus?.loading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-xs font-medium text-foreground transition-colors"
                      >
                        {testStatus?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        <span>Test Connection</span>
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setAddingProvider(false);
                            setTestStatus(null);
                          }}
                          className="px-3 py-1.5 text-xs rounded-lg hover:bg-muted text-muted-foreground"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary-hover"
                        >
                          Save & Connect
                        </button>
                      </div>
                    </div>

                    {/* Test Connection Feedback Display */}
                    {testStatus && !testStatus.loading && (
                      <div
                        className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                          testStatus.ok
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-destructive/10 text-destructive border border-destructive/20'
                        }`}
                      >
                        {testStatus.ok ? (
                          <Check className="w-4 h-4 shrink-0" />
                        ) : (
                          <AlertCircle className="w-4 h-4 shrink-0" />
                        )}
                        <span>{testStatus.message}</span>
                      </div>
                    )}
                  </form>
                )}

                {/* Providers List */}
                <div className="space-y-3">
                  {providers.map((p) => (
                    <div key={p.id} className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
                      <div className="flex items-center justify-between p-4">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground">{p.name}</span>
                            {p.isDefault && (
                              <span className="px-2 py-0.5 rounded-md bg-primary/20 text-primary text-[10px] font-bold uppercase">
                                Default
                              </span>
                            )}
                            {p.isSystem && (
                              <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px] font-medium uppercase">
                                System
                              </span>
                            )}
                            <span className="w-2 h-2 rounded-full bg-emerald-500" title="Connected" />
                          </div>
                          <div className="text-xs text-muted-foreground font-mono truncate">{p.baseUrl}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {p.modelsCount || 0} models · {p.protocol}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 ml-3 shrink-0">
                          <button
                            onClick={() => editingProviderId === p.id ? setEditingProviderId(null) : startEditProvider(p)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Edit provider"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteProvider(p.id, p.name)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                            title="Delete provider"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Inline Edit Form */}
                      {editingProviderId === p.id && (
                        <div className="border-t border-border p-4 bg-muted/20 space-y-3">
                          <div className="text-xs font-semibold text-foreground uppercase tracking-wide">Edit Provider</div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-muted-foreground mb-1">Display Name</label>
                              <input
                                type="text"
                                value={editProviderForm.name}
                                onChange={(e) => setEditProviderForm({ ...editProviderForm, name: e.target.value })}
                                className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-muted-foreground mb-1">Base URL</label>
                              <input
                                type="url"
                                value={editProviderForm.baseUrl}
                                onChange={(e) => setEditProviderForm({ ...editProviderForm, baseUrl: e.target.value })}
                                className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-xs"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">
                              New API Key <span className="text-muted-foreground/60 font-normal">(leave blank to keep current)</span>
                            </label>
                            <input
                              type="password"
                              placeholder="sk-... (leave blank to keep existing)"
                              value={editProviderForm.apiKey}
                              onChange={(e) => setEditProviderForm({ ...editProviderForm, apiKey: e.target.value })}
                              className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-xs font-mono"
                            />
                          </div>
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => setEditingProviderId(null)}
                              className="px-3 py-1.5 text-xs rounded-lg hover:bg-muted text-muted-foreground"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleSaveEditProvider}
                              disabled={editSaving}
                              className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary-hover disabled:opacity-60 flex items-center gap-1.5"
                            >
                              {editSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                              Save Changes
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 5. SHORTCUTS TAB */}
            {activeTab === 'shortcuts' && (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground mb-4">
                  Quick keyboard commands to streamline your workflow.
                </div>
                <div className="divide-y divide-border text-xs">
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-foreground">Open Command Palette / Search</span>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border font-mono text-[11px]">
                      Ctrl + K
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-foreground">New Chat Session</span>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border font-mono text-[11px]">
                      Ctrl + Shift + O
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-foreground">Stop Generating Response</span>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border font-mono text-[11px]">
                      Escape
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-foreground">Toggle Sidebar</span>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border font-mono text-[11px]">
                      Ctrl + B
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-foreground">Send Message</span>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border font-mono text-[11px]">
                      Enter
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <span className="text-foreground">New Line in Prompt</span>
                    <kbd className="px-2 py-1 rounded bg-muted border border-border font-mono text-[11px]">
                      Shift + Enter
                    </kbd>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
