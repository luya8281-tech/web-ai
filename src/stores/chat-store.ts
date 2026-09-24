import { create } from 'zustand';
import { Conversation, Message, Model, Provider, Project, Attachment } from '@/types/chat';
import { useUIStore } from './ui-store';

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
  renameConversation: (id: string, newTitle: string) => Promise<void>;
  pinConversation: (id: string, pinned: boolean) => Promise<void>;
  archiveConversation: (id: string, archived: boolean) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  setProviderAndModel: (providerId: string, modelId: string) => void;
  setSystemPrompt: (prompt: string) => void;
  setParameters: (params: { temperature?: number; topP?: number; maxTokens?: number; reasoningEffort?: string }) => void;
  setTemporaryChat: (temp: boolean) => void;
  setSearchQuery: (query: string) => void;
  addAttachment: (att: Attachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  loadProviders: () => Promise<void>;
  loadModels: (providerId?: string, refresh?: boolean) => Promise<void>;
  loadProjects: () => Promise<void>;
  createProject: (data: { name: string; description?: string; systemPrompt?: string; color?: string }) => Promise<Project | null>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  activeConversation: null,
  messages: [],
  providers: [],
  models: [],
  activeProviderId: 'xkiro',
  activeModelId: 'qwen/qwen3.7-plus:free',
  projects: [],
  activeProjectId: null,

  isGenerating: false,
  generatingReasoning: '',
  generatingContent: '',
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

  loadInitialData: async () => {
    await Promise.all([
      get().loadProviders(),
      get().loadModels(),
      get().loadConversations(),
      get().loadProjects(),
    ]);

    // Restore last active conversation if available, or load most recent
    if (typeof window !== 'undefined') {
      const savedId = localStorage.getItem('antigravity_active_conv');
      const convs = get().conversations;
      if (savedId && convs.some(c => c.id === savedId)) {
        await get().selectConversation(savedId);
      } else if (convs.length > 0) {
        await get().selectConversation(convs[0].id);
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
        const models: Model[] = data.models || [];
        set({ models });

        const currentActive = models.find(m => m.modelId === get().activeModelId || m.id === get().activeModelId);
        if (!currentActive && models.length > 0) {
          set({
            activeProviderId: models[0].providerId,
            activeModelId: models[0].modelId,
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

      const res = await fetch(`/api/conversations?${query.toString()}`);
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
      const res = await fetch(`/api/conversations/${id}`);
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
      generatingUsage: undefined,
      abortController,
      attachments: [], // Clear attachments on send
    });

    try {
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
              assistantMsgId = data.assistantMessageId;
              if (data.conversationId) {
                set({ activeConversationId: data.conversationId });
                if (typeof window !== 'undefined' && !state.temporaryChat) {
                  localStorage.setItem('antigravity_active_conv', data.conversationId);
                }
                get().loadConversations();
              }
            } else if (eventType === 'reasoning') {
              fullReasoning += data.reasoning;
              set({ generatingReasoning: fullReasoning });
            } else if (eventType === 'token') {
              fullContent += data.content;
              set({ generatingContent: fullContent });
            } else if (eventType === 'usage') {
              set({ generatingUsage: data });
            } else if (eventType === 'error') {
              useUIStore.getState().addToast(data.error, 'error');
              fullContent += `\n\n> ⚠️ *Error: ${data.error}*`;
              set({ generatingContent: fullContent });
            } else if (eventType === 'done') {
              // Final event
            }
          } catch (e) {}
        }
      }

      // Finalize assistant message into history
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
        },
      };

      set((curr) => ({
        messages: [...curr.messages, finalizedAssistantMsg],
        isGenerating: false,
        abortController: null,
        generatingContent: '',
        generatingReasoning: '',
      }));

      // Refresh conversations list to update title and timestamps
      get().loadConversations();
    } catch (err: any) {
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
          };
          set((curr) => ({ messages: [...curr.messages, interruptedMsg] }));
        }
        useUIStore.getState().addToast('Response stopped', 'info');
      } else {
        useUIStore.getState().addToast(err.message || 'Generation error', 'error');
      }
      set({
        isGenerating: false,
        abortController: null,
        generatingContent: '',
        generatingReasoning: '',
      });
    }
  },

  stopGeneration: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
    }
  },

  regenerateMessage: async (messageId: string, overrideModelId?: string) => {
    const { messages, activeConversationId } = get();
    if (!activeConversationId) return;

    const targetIdx = messages.findIndex(m => m.id === messageId);
    if (targetIdx === -1) return;

    // Find preceding user message
    let userMsgIdx = targetIdx;
    while (userMsgIdx >= 0 && messages[userMsgIdx].role !== 'user') {
      userMsgIdx--;
    }
    if (userMsgIdx < 0) return;

    const userMessage = messages[userMsgIdx];

    // Truncate from DB
    await fetch(`/api/messages/${userMessage.id}/truncate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: activeConversationId }),
    });

    // Truncate local messages up to userMessage
    set({ messages: messages.slice(0, userMsgIdx + 1) });

    if (overrideModelId) {
      set({ activeModelId: overrideModelId });
    }

    // Trigger regeneration
    get().sendMessage(userMessage.content, userMessage.attachments);
  },

  editMessage: async (messageId: string, newContent: string) => {
    const { messages, activeConversationId } = get();
    if (!activeConversationId) return;

    const targetIdx = messages.findIndex(m => m.id === messageId);
    if (targetIdx === -1) return;

    // Truncate after message in DB and update content
    await fetch(`/api/messages/${messageId}/truncate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: activeConversationId,
        newContent,
      }),
    });

    // Truncate local state
    const truncatedList = messages.slice(0, targetIdx);
    set({ messages: truncatedList });

    // Send new message
    get().sendMessage(newContent);
  },

  deleteMessage: async (messageId: string) => {
    try {
      const res = await fetch(`/api/messages/${messageId}`, { method: 'DELETE' });
      if (res.ok) {
        set((curr) => ({ messages: curr.messages.filter(m => m.id !== messageId) }));
        useUIStore.getState().addToast('Message deleted', 'info');
      }
    } catch (err) {
      console.error('Failed to delete message:', err);
    }
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
