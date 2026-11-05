import { create } from 'zustand';
import { Conversation, Message, Model, Provider, Project, Attachment, ActionInfo, UserLocation, TaskItem } from '@/types/chat';
import { useUIStore } from './ui-store';
import { useSettingsStore } from './settings-store';

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  messages: Message[];
  providers: Provider[];
  models: Model[];
  activeProviderId: string;
  activeModelId: string;
  projects: Project[];
  activeProjectId: string | null;

  // Real-time generation state
  isGenerating: boolean;
  generatingReasoning: string;
  generatingContent: string;
  generatingActions: ActionInfo[];
  generatingTasks: TaskItem[];
  generatingUsage?: { promptTokens: number; completionTokens: number; totalTokens: number; latencyMs?: number };
  abortController: AbortController | null;

  // Custom AI Parameters
  systemPrompt: string;
  temperature: number;
  topP: number;
  maxTokens?: number;
  reasoningEffort?: string;
  temporaryChat: boolean;
  searchQuery: string;
  attachments: Attachment[];
  userLocation: UserLocation | null;
  locationStatus: 'idle' | 'requesting' | 'granted' | 'denied' | 'error';
  reconnecting: boolean;
  resumeGeneration: (conversationId: string) => Promise<void>;

  // Actions
  loadInitialData: () => Promise<void>;
  loadConversations: (archived?: boolean) => Promise<void>;
  selectConversation: (id: string | null) => Promise<void>;
  newChat: (projectId?: string | null) => void;
  sendMessage: (content: string, customAttachments?: Attachment[]) => Promise<void>;
  stopGeneration: () => void;
  regenerateMessage: (messageId: string, overrideModelId?: string) => Promise<void>;
  editMessage: (messageId: string, newContent: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  setMessageFeedback: (messageId: string, feedback: 'up' | 'down' | null) => void;
  renameConversation: (id: string, newTitle: string) => Promise<void>;
  pinConversation: (id: string, pinned: boolean) => Promise<void>;
  archiveConversation: (id: string, archived: boolean) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  setProviderAndModel: (providerId: string, modelId: string) => void;
  setSystemPrompt: (prompt: string) => void;
  setParameters: (params: { temperature?: number; topP?: number; maxTokens?: number; reasoningEffort?: string }) => void;
  setTemporaryChat: (temp: boolean) => void;
  setSearchQuery: (query: string) => void;
  setUserLocation: (loc: UserLocation | null) => void;
  setLocationStatus: (s: 'idle' | 'requesting' | 'granted' | 'denied' | 'error') => void;
  requestUserLocation: (opts?: { ipFallback?: boolean }) => Promise<UserLocation | null>;
  addAttachment: (att: Attachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  loadProviders: () => Promise<void>;
  loadModels: (providerId?: string, refresh?: boolean) => Promise<void>;
  loadProjects: () => Promise<void>;
  createProject: (data: { name: string; description?: string; systemPrompt?: string; color?: string }) => Promise<Project | null>;
}

let resumeToken = 0;
let reasoningAttachedLen = 0;
let userStoppedFlag = false;
let detachedFlag = false;

function triggerBackgroundNotification(title: string, body: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const cleanBody = body.replace(/\[[^\]]+\]/g, '').replace(/[#*_`>]/g, '').trim().slice(0, 140);
    new Notification(title, {
      body: cleanBody || 'Respons AI telah selesai diproses.',
      icon: '/icon-192.png',
      tag: 'ai-chat-done',
    });
  } catch {}
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  activeConversation: null,
  messages: [],
  providers: [],
  models: [],
  activeProviderId: 'antigravity',
  activeModelId: 'gemini-3.8-flash-high',
  projects: [],
  activeProjectId: null,

  isGenerating: false,
  generatingReasoning: '',
  generatingContent: '',
  generatingActions: [],
  generatingTasks: [],
  generatingUsage: undefined,
  abortController: null,

  systemPrompt: '',
  temperature: 0.7,
  topP: 1.0,
  maxTokens: undefined,
  reasoningEffort: undefined,
  temporaryChat: false,
  searchQuery: '',
  attachments: [],
  userLocation: (typeof window !== 'undefined' ? (() => { try { const raw = localStorage.getItem('antigravity_user_location'); return raw ? JSON.parse(raw) : null; } catch { return null; } })() : null),
  locationStatus: (typeof window !== 'undefined' && localStorage.getItem('antigravity_user_location') ? 'granted' : 'idle'),

  reconnecting: false,

  resumeGeneration: async (conversationId: string) => {
    if (!conversationId) return;
    const token = ++resumeToken;
    set({ isGenerating: true, reconnecting: true, abortController: null });
    const deadline = Date.now() + 20 * 60 * 1000;
    let lastPreviewText = '';
    while (token === resumeToken && Date.now() < deadline) {
      try {
        const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}&t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          if (data.running) {
            if (typeof data.content === 'string') lastPreviewText = data.content;
            set({
              generatingContent: data.content || '',
              generatingReasoning: data.reasoning || '',
              generatingActions: Array.isArray(data.actions) ? data.actions : [],
              generatingTasks: Array.isArray(data.tasks) ? data.tasks : [],
            });
          } else {
            break;
          }
        }
      } catch {
        // jaringan belum pulih: coba lagi
      }
      await new Promise((r) => setTimeout(r, 950));
    }
    if (token !== resumeToken) return;
    if (get().activeConversationId === conversationId) {
      await get().selectConversation(conversationId);
    }
    get().loadConversations();
    const msgs = get().messages;
    const lastMsg = msgs[msgs.length - 1];
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      triggerBackgroundNotification(
        'Tugas AI Selesai',
        lastMsg?.content || lastPreviewText || 'Balasan baru tersedia di ruang kerja.'
      );
    }
    set({
      isGenerating: false,
      reconnecting: false,
      generatingContent: '',
      generatingReasoning: '',
      generatingActions: [],
    });
  },

  loadInitialData: async () => {
    await Promise.all([
      get().loadProviders(),
      get().loadModels(),
      get().loadConversations(),
      get().loadProjects(),
    ]);

    // Restore last active conversation if available, or load most recent
    if (typeof window !== 'undefined') {
      // Jangan timpa chat yang sedang aktif/streaming (mis. komponen di-remount
      // oleh error boundary atau HMR); itu yang membuat isi chat tiba-tiba hilang.
      const live = get();
      if (live.isGenerating || live.messages.length > 0 || live.activeConversationId) {
        return;
      }
      const savedId = localStorage.getItem('antigravity_active_conv');
      let convs = get().conversations;
      if (convs.length === 0) {
        // Daftar gagal dimuat (server sibuk/restart): coba sekali lagi
        await new Promise((r) => setTimeout(r, 800));
        await get().loadConversations();
        convs = get().conversations;
      }
      if (savedId) {
        // Percaya pada ID tersimpan walau daftar (limit 50) belum memuatnya
        await get().selectConversation(savedId);
      }
      if (!get().activeConversationId && convs.length > 0) {
        await get().selectConversation(convs[0].id);
      }
      // Halaman dimuat ulang saat jawaban masih diproses di server: sambung ulang
      const convId = get().activeConversationId;
      if (convId) {
        try {
          const r = await fetch(`/api/chat?conversationId=${encodeURIComponent(convId)}`, { cache: 'no-store' });
          const d = await r.json();
          if (d.running) get().resumeGeneration(convId);
        } catch {}
      }
    }
  },

  loadProviders: async () => {
    try {
      const res = await fetch('/api/providers');
      if (res.ok) {
        const data = await res.json();
        const providers: Provider[] = data.providers || [];
        set({ providers });
        const defaultProv = providers.find(p => p.isDefault) || providers[0];
        if (defaultProv && !get().activeProviderId) {
          set({ activeProviderId: defaultProv.id });
        }
      }
    } catch (err) {
      console.error('Failed to load providers:', err);
    }
  },

  loadModels: async (providerId, refresh) => {
    try {
      let url = '/api/models';
      const params = new URLSearchParams();
      if (providerId) params.append('providerId', providerId);
      if (refresh) params.append('refresh', 'true');
      if (params.toString()) url += `?${params.toString()}`;

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const models: Model[] = (data.models || []).sort((a: Model, b: Model) =>
          (a.displayName || a.name || a.modelId).localeCompare(
            b.displayName || b.name || b.modelId,
            undefined,
            { sensitivity: 'base', numeric: true }
          )
        );
        set({ models });

        const currentActive = models.find(m => m.modelId === get().activeModelId || m.id === get().activeModelId);
        if (!currentActive && models.length > 0) {
          const defaultModel = models.find(m => m.isDefault) || models[0];
          set({
            activeProviderId: defaultModel.providerId,
            activeModelId: defaultModel.modelId,
          });
        }
      }
    } catch (err) {
      console.error('Failed to load models:', err);
    }
  },

  loadConversations: async (archived = false) => {
    try {
      const query = new URLSearchParams();
      if (archived) query.append('archived', 'true');
      const search = get().searchQuery;
      if (search) query.append('search', search);
      query.append('t', Date.now().toString());

      const res = await fetch(`/api/conversations?${query.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        set({ conversations: data.conversations || [] });
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  },

  loadProjects: async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        set({ projects: data.projects || [] });
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  },

  selectConversation: async (id) => {
    if (typeof window !== 'undefined') {
      if (id) {
        localStorage.setItem('antigravity_active_conv', id);
      } else {
        localStorage.removeItem('antigravity_active_conv');
      }
    }

    if (!id) {
      set({
        activeConversationId: null,
        activeConversation: null,
        messages: [],
      });
      return;
    }

    try {
      // Stream lokal sedang berjalan di percakapan ini: jangan timpa pesan dengan
      // salinan DB yang belum memuat jawaban yang sedang dibuat.
      const pre = get();
      if (pre.isGenerating && pre.abortController !== null && pre.activeConversationId === id) {
        return;
      }
      const res = await fetch(`/api/conversations/${id}?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const conv: Conversation = data.conversation;
        set({
          activeConversationId: conv.id,
          activeConversation: conv,
          messages: conv.messages || [],
          activeProviderId: conv.providerId,
          activeModelId: conv.modelId,
          systemPrompt: conv.systemPrompt || '',
          temperature: conv.temperature ?? 0.7,
          topP: conv.topP ?? 1.0,
          maxTokens: conv.maxTokens ?? undefined,
          reasoningEffort: conv.reasoningEffort ?? undefined,
          temporaryChat: conv.temporary,
        });
      }
    } catch (err) {
      console.error('Failed to load conversation details:', err);
    }
  },

  newChat: (projectId = null) => {
    const { abortController } = get();
    // Lepas dari stream lama tanpa menghentikan generasi di server
    detachedFlag = true;
    resumeToken++;
    if (abortController) {
      abortController.abort();
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem('antigravity_active_conv');
    }
    set({
      activeConversationId: null,
      activeConversation: null,
      messages: [],
      activeProjectId: projectId,
      generatingContent: '',
      generatingReasoning: '',
      isGenerating: false,
      attachments: [],
    });
  },

  sendMessage: async (content: string, customAttachments?: Attachment[]) => {
    const state = get();
    if (state.isGenerating) return;

    const promptText = content.trim();
    const currentAttachments = customAttachments || state.attachments;

    if (!promptText && currentAttachments.length === 0) return;

    // `/usage` is a local Codex command, not a model prompt. Read the account
    // quota snapshot from Codex's app-server and render it in the conversation.
    if (promptText === '/usage' && state.activeProviderId === 'codex-local' && currentAttachments.length === 0) {
      const now = new Date().toISOString();
      const userMessage: Message = {
        id: `usage_user_${Date.now()}`,
        conversationId: state.activeConversationId || 'temp',
        role: 'user',
        content: '/usage',
        createdAt: now,
      };
      set({ messages: [...state.messages, userMessage], attachments: [] });
      try {
        const response = await fetch('/api/codex/usage', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to read Codex usage.');
        const limits = data.rateLimitsByLimitId || (data.rateLimits ? { codex: data.rateLimits } : {});
        const displayOrder = ['codex', 'gpt-reserve'];
        const rows = Object.entries(limits as Record<string, any>)
          .sort(([left], [right]) => {
            const leftIndex = displayOrder.indexOf(left);
            const rightIndex = displayOrder.indexOf(right);
            return (leftIndex === -1 ? displayOrder.length : leftIndex) - (rightIndex === -1 ? displayOrder.length : rightIndex);
          })
          .map(([id, limit]) => {
          const formatWindow = (window: any, title: string) => {
            if (!window) return null;
            const remainingPercent = typeof window.usedPercent === 'number'
              ? Math.max(0, Math.min(100, 100 - window.usedPercent))
              : null;
            const filled = remainingPercent === null ? 0 : Math.round(remainingPercent / 10);
            const bar = remainingPercent === null ? '──────────' : `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
            const reset = window.resetsAt
              ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(window.resetsAt * 1000))
              : 'waktu reset tidak tersedia';
            const remaining = remainingPercent === null ? 'Data kuota belum tersedia' : `**${remainingPercent}% tersisa**`;
            return `_${title}_\n\`${bar}\`  ${remaining}\nReset: ${reset}`;
          };
          const label = id === 'codex' ? 'Kuota Codex' : id === 'gpt-reserve' ? 'GPT Reserve' : (limit.limitName || id);
          const primaryMinutes = Number(limit.primary?.windowDurationMins);
          const primaryLabel = Number.isFinite(primaryMinutes) && primaryMinutes >= 60
            ? `Sesi ${Math.round(primaryMinutes / 60)} jam`
            : 'Sesi saat ini';
          const secondaryMinutes = Number(limit.secondary?.windowDurationMins);
          const secondaryLabel = Number.isFinite(secondaryMinutes) && secondaryMinutes >= 6 * 24 * 60
            ? 'Kuota mingguan'
            : 'Periode panjang';
          const windows = [
            formatWindow(limit.primary, primaryLabel),
            formatWindow(limit.secondary, secondaryLabel),
          ].filter(Boolean);
          return `**${label}**\n${windows.length ? windows.join('\n\n') : 'Data kuota belum tersedia.'}`;
        });
        const content = [
          '### Pemakaian Codex',
          data.ordinaryUsageAllowed === false ? '🔴 Penggunaan reguler sedang tidak tersedia.' : '🟢 Penggunaan reguler tersedia.',
          rows.length ? rows.join('\n\n') : 'Data batas penggunaan dari akun Codex belum tersedia.',
          '_Persentase menunjukkan kuota yang masih tersedia pada setiap periode._',
        ].join('\n\n');
        set((current) => ({ messages: [...current.messages, {
          id: `usage_result_${Date.now()}`,
          conversationId: state.activeConversationId || 'temp',
          role: 'assistant',
          content,
          provider: 'codex-local',
          model: state.activeModelId,
          createdAt: new Date().toISOString(),
        }] }));
      } catch (error: any) {
        useUIStore.getState().addToast(error.message || 'Gagal membaca usage Codex.', 'error');
      }
      return;
    }

    // Optimistic user message
    const tempUserMsgId = `temp_user_${Date.now()}`;
    const optimisticUserMsg: Message = {
      id: tempUserMsgId,
      conversationId: state.activeConversationId || 'pending',
      role: 'user',
      content: promptText,
      attachments: currentAttachments,
      createdAt: new Date().toISOString(),
    };

    const nextMessages = [...state.messages, optimisticUserMsg];
    const abortController = new AbortController();

    set({
      messages: nextMessages,
      isGenerating: true,
      generatingReasoning: '',
      generatingContent: '',
      generatingActions: [],
      generatingTasks: [],
      generatingUsage: undefined,
      abortController,
      attachments: [], // Clear attachments on send
    });

    userStoppedFlag = false;
    reasoningAttachedLen = 0;
    detachedFlag = false;
    let streamConvId: string | null = state.activeConversationId;
    let gotDone = false;
    try {
      // Otomatis minta izin lokasi GPS ke browser jika pesan menanyakan lokasi/cuaca sekitar
      const existingLoc = get().userLocation;
      const isIpOnly = Boolean(existingLoc?.label && existingLoc.label.includes('via IP'));
      const asksLocationOrWeather =
        /(lokasi|di ?mana (?:saya|aku|posisi|kita)|cuaca|hujan|suhu|posisi(?:ku| saya)|sekitar sini|dekat sini|terdekat|koordinat|tempat(?:ku| saya)|kota(?:ku| saya)|daerah(?:ku| saya))/i.test(
          promptText
        );
      if (asksLocationOrWeather && (!existingLoc || isIpOnly)) {
        await get().requestUserLocation({ ipFallback: true });
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: state.activeConversationId || undefined,
          message: promptText,
          providerId: state.activeProviderId,
          modelId: state.activeModelId,
          temporary: state.temporaryChat,
          systemPrompt: state.systemPrompt || undefined,
          temperature: state.temperature,
          topP: state.topP,
          maxTokens: state.maxTokens,
          reasoningEffort: state.reasoningEffort,
          attachments: currentAttachments,
          userLocation: get().userLocation || undefined,
          searchQuota: useUIStore.getState().searchSourceQuota,
          activeConnectors: useUIStore.getState().activeConnectors,
          claudePersona: useSettingsStore.getState().settings.claudePersona || 'claude-official',
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errorJson.error || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No readable stream received.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let activeConvId = state.activeConversationId;
      let assistantMsgId = `msg_asst_${Date.now()}`;
      let fullContent = '';
      let fullReasoning = '';

      // High-performance 60fps render scheduler to eliminate markdown re-parse stutter
      let rafId: number | null = null;
      const scheduleRender = () => {
        if (rafId === null && typeof window !== 'undefined') {
          rafId = requestAnimationFrame(() => {
            set({
              generatingContent: fullContent,
              generatingReasoning: fullReasoning,
            });
            rafId = null;
          });
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const rawEvent of events) {
          const lines = rawEvent.split('\n');
          let eventType = '';
          let dataStr = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
          }

          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            if (eventType === 'meta') {
              activeConvId = data.conversationId;
              streamConvId = data.conversationId;
              assistantMsgId = data.assistantMessageId;
              if (data.userMessageId) {
                set((curr) => ({
                  messages: curr.messages.map((m) =>
                    m.id === tempUserMsgId
                      ? {
                          ...m,
                          id: data.userMessageId,
                          conversationId: data.conversationId || m.conversationId,
                        }
                      : m
                  ),
                }));
              }
              if (data.conversationId) {
                set({ activeConversationId: data.conversationId });
                if (typeof window !== 'undefined' && !state.temporaryChat) {
                  localStorage.setItem('antigravity_active_conv', data.conversationId);
                }
                get().loadConversations();
              }
            } else if (eventType === 'reset') {
              // Teks pra-tool bukan jawaban final: bersihkan buffer supaya
              // hanya jawaban akhir yang tampil dan tersimpan.
              fullContent = '';
              set({ generatingContent: '' });
            } else if (eventType === 'action') {
              // Real-time live action update with status & details
              const actionData = data as ActionInfo;
              set((curr) => {
                const existingIdx = curr.generatingActions.findIndex(
                  (a) => (actionData.id && a.id === actionData.id) || (a.label === actionData.label && a.status === 'running' && actionData.status === 'done')
                );
                if (existingIdx !== -1) {
                  const updated = [...curr.generatingActions];
                  updated[existingIdx] = { ...updated[existingIdx], ...actionData };
                  return { generatingActions: updated };
                }
                // Lampirkan reasoning yang terkumpul sejak aksi terakhir agar
                // kartu thinking muncul kronologis tepat sebelum aksinya.
                const enriched = { ...actionData };
                if (fullReasoning.length > reasoningAttachedLen) {
                  enriched.reasoningBefore = fullReasoning.slice(reasoningAttachedLen);
                  reasoningAttachedLen = fullReasoning.length;
                }
                // When a new action starts running, clear current round text buffer so the next round's tokens stream below it!
                fullContent = '';
                return {
                  generatingActions: [...curr.generatingActions, enriched],
                  generatingContent: '',
                };
              });
            } else if (eventType === 'task_update') {
              const taskList = Array.isArray(data?.tasks) ? (data.tasks as TaskItem[]) : [];
              set({ generatingTasks: taskList });
            } else if (eventType === 'reasoning') {
              fullReasoning += data.reasoning;
              scheduleRender();
            } else if (eventType === 'token') {
              fullContent += data.content;
              scheduleRender();
            } else if (eventType === 'usage') {
              set({ generatingUsage: data });
            } else if (eventType === 'error') {
              useUIStore.getState().addToast(data.error, 'error');
              fullContent += `\n\n> ⚠️ *Error: ${data.error}*`;
              scheduleRender();
            } else if (eventType === 'done') {
              gotDone = true;
            }
          } catch (e) {}
        }
      }

      // Stream terputus sebelum event 'done' (mis. tab di-background): sambung ulang
      if (!gotDone && streamConvId && !userStoppedFlag) {
        throw Object.assign(new Error('stream-disconnected'), { name: 'StreamDisconnected' });
      }

      // Flush final content immediately
      if (rafId !== null && typeof window !== 'undefined') {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      set({
        generatingContent: fullContent,
        generatingReasoning: fullReasoning,
      });

      const isErrorReply =
        !fullContent.trim() ||
        /^(?:\s*>\s*⚠️\s*\*?Error:|\s*⚠️\s*Gagal menghubungi model)/i.test(fullContent.trim());

      // Finalize assistant message into history with persistent action history
      const finalizedAssistantMsg: Message = {
        id: assistantMsgId,
        conversationId: activeConvId || 'temp',
        role: 'assistant',
        content: fullContent,
        reasoningContent: fullReasoning || null,
        model: state.activeModelId,
        provider: state.activeProviderId,
        createdAt: new Date().toISOString(),
        metadata: {
          tokenInput: get().generatingUsage?.promptTokens,
          tokenOutput: get().generatingUsage?.completionTokens,
          totalTokens: get().generatingUsage?.totalTokens,
          actions: get().generatingActions, // Persist live action history into message metadata!
          tasks: get().generatingTasks,
        },
      };

      set((curr) => {
        const updatedMsgs = isErrorReply
          ? curr.messages.map((m, idx) =>
              idx === curr.messages.length - 1 && m.role === 'user'
                ? { ...m, metadata: { ...m.metadata, sendFailed: true } }
                : m
            )
          : curr.messages;
        return {
          messages: [...updatedMsgs, finalizedAssistantMsg],
          isGenerating: false,
          abortController: null,
          generatingContent: '',
          generatingReasoning: '',
          generatingActions: [],
        };
      });

      if (
        typeof document !== 'undefined' &&
        (document.visibilityState === 'hidden' || /\[IZIN\s*:/i.test(fullContent))
      ) {
        triggerBackgroundNotification(
          /\[IZIN\s*:/i.test(fullContent) ? 'Izin Tindakan Diperlukan' : 'Respons AI Selesai',
          fullContent
        );
      }

      // Refresh conversations list to update title and timestamps
      get().loadConversations();
    } catch (err: any) {
      if (detachedFlag) {
        set({ isGenerating: false, reconnecting: false, abortController: null, generatingContent: '', generatingReasoning: '', generatingActions: [] });
        return;
      }
      if (!userStoppedFlag && streamConvId && !state.temporaryChat) {
        // Koneksi putus (keluar dari Chrome, jaringan berganti, dll). Server tetap
        // menyelesaikan jawaban; tunggu lalu muat ulang dari database.
        await get().resumeGeneration(streamConvId);
        return;
      }
      if (err.name === 'AbortError') {
        // Interrupted by user clicking Stop button: preserve partial response!
        const partial = get().generatingContent;
        const partialReasoning = get().generatingReasoning;
        if (partial.trim() || partialReasoning.trim()) {
          const interruptedMsg: Message = {
            id: `msg_int_${Date.now()}`,
            conversationId: state.activeConversationId || 'temp',
            role: 'assistant',
            content: partial + '\n\n*(Response stopped by user)*',
            reasoningContent: partialReasoning || null,
            model: state.activeModelId,
            provider: state.activeProviderId,
            createdAt: new Date().toISOString(),
            metadata: {
              actions: get().generatingActions,
            },
          };
          set((curr) => ({ messages: [...curr.messages, interruptedMsg] }));
        }
        useUIStore.getState().addToast('Response stopped', 'info');
      } else {
        // Tandai pesan pengguna terakhir sebagai gagal terkirim agar muncul tombol Kirim Ulang
        set((curr) => ({
          messages: curr.messages.map((m, idx) =>
            idx === curr.messages.length - 1 && m.role === 'user'
              ? {
                  ...m,
                  metadata: {
                    ...m.metadata,
                    sendFailed: true,
                    errorMessage: err.message || 'Gagal mengirim pesan',
                  },
                }
              : m
          ),
        }));
        useUIStore.getState().addToast(err.message || 'Gagal mengirim pesan', 'error');
      }
      set({
        isGenerating: false,
        abortController: null,
        generatingContent: '',
        generatingReasoning: '',
        generatingActions: [],
      });
    }
  },

  stopGeneration: () => {
    userStoppedFlag = true;
    const { abortController, activeConversationId, reconnecting } = get();
    if (activeConversationId) {
      fetch(`/api/chat?conversationId=${encodeURIComponent(activeConversationId)}`, { method: 'DELETE' }).catch(() => {});
    }
    if (abortController) {
      abortController.abort();
    }
    if (reconnecting) {
      resumeToken++;
      set({ isGenerating: false, reconnecting: false, generatingContent: '', generatingReasoning: '', generatingActions: [] });
      if (activeConversationId) setTimeout(() => get().selectConversation(activeConversationId), 800);
    }
  },

  regenerateMessage: async (messageId: string, overrideModelId?: string) => {
    const { messages, activeConversationId } = get();

    const targetIdx = messages.findIndex(m => m.id === messageId);
    if (targetIdx === -1) return;

    // Find preceding user message (or the user message itself if clicked on user bubble)
    let userMsgIdx = targetIdx;
    while (userMsgIdx >= 0 && messages[userMsgIdx].role !== 'user') {
      userMsgIdx--;
    }
    if (userMsgIdx < 0) return;

    const userMessage = messages[userMsgIdx];

    // Truncate from DB if already saved in a conversation
    if (activeConversationId && !userMessage.id.startsWith('temp_user_')) {
      try {
        await fetch(`/api/messages/${userMessage.id}/truncate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: activeConversationId }),
        });
      } catch {}
    }

    // Truncate local messages before userMessage so sendMessage appends it cleanly
    set({ messages: messages.slice(0, userMsgIdx) });

    if (overrideModelId) {
      set({ activeModelId: overrideModelId });
    }

    // Trigger regeneration
    get().sendMessage(userMessage.content, userMessage.attachments);
  },

  editMessage: async (messageId: string, newContent: string) => {
    const { messages, activeConversationId } = get();

    const targetIdx = messages.findIndex(m => m.id === messageId);
    if (targetIdx === -1) return;

    // Truncate after message in DB and update content if persisted
    if (activeConversationId && !messageId.startsWith('temp_user_')) {
      try {
        await fetch(`/api/messages/${messageId}/truncate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: activeConversationId,
            newContent,
          }),
        });
      } catch {}
    }

    // Truncate local state
    const truncatedList = messages.slice(0, targetIdx);
    set({ messages: truncatedList });

    // Send new message
    get().sendMessage(newContent);
  },

  deleteMessage: async (messageId: string) => {
    if (messageId.startsWith('temp_user_') || messageId.startsWith('msg_int_')) {
      set((curr) => ({ messages: curr.messages.filter(m => m.id !== messageId) }));
      return;
    }
    try {
      const res = await fetch(`/api/messages/${messageId}`, { method: 'DELETE' });
      if (res.ok) {
        set((curr) => ({ messages: curr.messages.filter(m => m.id !== messageId) }));
      }
    } catch (err) {
      console.error('Failed to delete message:', err);
    }
  },

  setMessageFeedback: (messageId: string, feedback: 'up' | 'down' | null) => {
    set((curr) => ({
      messages: curr.messages.map((m) =>
        m.id === messageId
          ? { ...m, metadata: { ...m.metadata, feedback } }
          : m
      ),
    }));
    try {
      if (typeof window !== 'undefined') {
        const key = `antigravity_feedback_${messageId}`;
        if (feedback) localStorage.setItem(key, feedback);
        else localStorage.removeItem(key);
      }
    } catch {}
  },

  renameConversation: async (id: string, newTitle: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      if (res.ok) {
        set((curr) => ({
          conversations: curr.conversations.map(c => c.id === id ? { ...c, title: newTitle } : c),
          activeConversation: curr.activeConversation?.id === id ? { ...curr.activeConversation, title: newTitle } : curr.activeConversation,
        }));
        useUIStore.getState().addToast('Conversation renamed', 'success');
      }
    } catch (err) {
      console.error('Failed to rename conversation:', err);
    }
  },

  pinConversation: async (id: string, pinned: boolean) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned }),
      });
      if (res.ok) {
        get().loadConversations();
        useUIStore.getState().addToast(pinned ? 'Pinned' : 'Unpinned', 'info');
      }
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  },

  archiveConversation: async (id: string, archived: boolean) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
      if (res.ok) {
        get().loadConversations();
        useUIStore.getState().addToast(archived ? 'Archived' : 'Unarchived', 'info');
      }
    } catch (err) {
      console.error('Failed to toggle archive:', err);
    }
  },

  deleteConversation: async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (typeof window !== 'undefined' && localStorage.getItem('antigravity_active_conv') === id) {
          localStorage.removeItem('antigravity_active_conv');
        }
        if (get().activeConversationId === id) {
          get().newChat();
        }
        get().loadConversations();
        useUIStore.getState().addToast('Conversation deleted', 'info');
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  },

  setProviderAndModel: (providerId: string, modelId: string) => {
    set({ activeProviderId: providerId, activeModelId: modelId });
    // Update active conversation in DB if open
    const { activeConversationId } = get();
    if (activeConversationId) {
      fetch(`/api/conversations/${activeConversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, modelId }),
      }).catch(console.error);
    }
  },

  setSystemPrompt: (prompt: string) => set({ systemPrompt: prompt }),
  setParameters: (params) => set((curr) => ({ ...curr, ...params })),
  setTemporaryChat: (temp: boolean) => set({ temporaryChat: temp }),
  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
    get().loadConversations();
  },

  setUserLocation: (loc) => {
    set({ userLocation: loc, locationStatus: loc ? 'granted' : 'idle' });
    try {
      if (typeof window !== 'undefined') {
        if (loc) localStorage.setItem('antigravity_user_location', JSON.stringify(loc));
        else localStorage.removeItem('antigravity_user_location');
      }
    } catch {}
  },
  setLocationStatus: (s) => set({ locationStatus: s }),
  requestUserLocation: async (opts?: { ipFallback?: boolean }) => {
    const useIpFallback = opts?.ipFallback !== false;
    const saveLoc = (loc: UserLocation, msg?: string) => {
      set({ userLocation: loc, locationStatus: 'granted' });
      try { localStorage.setItem('antigravity_user_location', JSON.stringify(loc)); } catch {}
      if (msg) useUIStore.getState().addToast(msg, 'success');
    };
    const fetchIpLocation = async (): Promise<UserLocation | null> => {
      try {
        const res = await fetch('/api/location', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const loc: UserLocation = {
          lat: data.lat,
          lon: data.lon,
          label: data.label ? `${data.label} (via IP)` : 'via IP',
          accuracy: data.accuracy,
          updatedAt: Date.now(),
        };
        saveLoc(loc, `GPS tak tersedia — dipakai perkiraan IP: ${data.label || `${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}`}. Akurasi setingkat kota.`);
        return loc;
      } catch (e: any) {
        set({ locationStatus: 'error' });
        useUIStore.getState().addToast(`Lokasi IP juga gagal: ${e.message}. Ketik nama kota manual, cth: "cuaca Jakarta".`, 'error');
        return null;
      }
    };
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      if (useIpFallback) {
        set({ locationStatus: 'requesting' });
        return fetchIpLocation();
      }
      set({ locationStatus: 'error' });
      useUIStore.getState().addToast('Perangkat tidak mendukung GPS. Ketik nama kota manual, cth: "cuaca Jakarta".', 'error');
      return null;
    }
    // Geolocation API butuh secure context (HTTPS/localhost). Tanpa itu langsung fallback IP.
    if (typeof window !== 'undefined' && (window as any).isSecureContext === false) {
      useUIStore.getState().addToast('Browser memblokir GPS karena situs dibuka via HTTP. Memakai perkiraan lokasi IP...', 'info');
      if (useIpFallback) {
        set({ locationStatus: 'requesting' });
        return fetchIpLocation();
      }
    }
    set({ locationStatus: 'requesting' });
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc: UserLocation = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            updatedAt: Date.now(),
          };
          saveLoc(loc, `Lokasi GPS aktif: ${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}. AI bisa cek cuaca lokasimu.`);
          resolve(loc);
        },
        async (err) => {
          // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
          const reason = err.code === 1
            ? 'Izin lokasi ditolak di browser'
            : err.code === 3
              ? 'GPS timeout (sinyal lemah)'
              : `GPS tak tersedia (${err.message || 'code ' + err.code})`;
          if (useIpFallback) {
            useUIStore.getState().addToast(`${reason}. Mencoba lokasi via IP...`, 'info');
            resolve(await fetchIpLocation());
          } else {
            const denied = err.code === 1;
            set({ locationStatus: denied ? 'denied' : 'error' });
            useUIStore.getState().addToast(
              denied ? 'Izin lokasi ditolak. Klik ikon gembok di address bar > izinkan Location, lalu coba lagi.' : `${reason}.`,
              'error'
            );
            resolve(null);
          }
        },
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
      );
    });
  },
  addAttachment: (att: Attachment) => {
    set((curr) => ({ attachments: [...curr.attachments, att] }));
  },

  removeAttachment: (id: string) => {
    set((curr) => ({ attachments: curr.attachments.filter(a => a.id !== id) }));
  },

  clearAttachments: () => set({ attachments: [] }),

  createProject: async (data) => {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const json = await res.json();
        get().loadProjects();
        useUIStore.getState().addToast(`Project "${data.name}" created`, 'success');
        return json.project;
      }
      return null;
    } catch (e) {
      return null;
    }
  },
}));
