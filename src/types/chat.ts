export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  dataUrl?: string; // base64 for vision/inline if needed
}

export interface MessageMetadata {
  provider?: string;
  model?: string;
  tokenInput?: number;
  tokenOutput?: number;
  totalTokens?: number;
  latencyMs?: number;
  finishReason?: string;
  [key: string]: unknown;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  reasoningContent?: string | null;
  model?: string;
  provider?: string;
  createdAt: string;
  updatedAt?: string;
  attachments?: Attachment[];
  metadata?: MessageMetadata;
}

export interface Conversation {
  id: string;
  userId: string;
  projectId?: string | null;
  title: string;
  providerId: string;
  modelId: string;
  pinned: boolean;
  archived: boolean;
  temporary: boolean;
  systemPrompt?: string | null;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoningEffort?: string | null;
  createdAt: string;
  updatedAt: string;
  messages?: Message[];
  messageCount?: number;
}

export interface ModelCapabilities {
  text: boolean;
  vision: boolean;
  tools: boolean;
  images: boolean;
  reasoning: boolean;
}

export interface ModelPricing {
  currency?: string;
  unit?: string;
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

export interface Model {
  id: string; // providerId:modelId or modelId
  providerId: string;
  modelId: string;
  name: string;
  displayName: string;
  description?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities: ModelCapabilities;
  pricing?: ModelPricing;
  isDefault?: boolean;
  isEnabled?: boolean;
}

export type ProviderProtocol = 'openai-compatible' | 'anthropic-compatible' | 'mock';

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  isDefault: boolean;
  isEnabled: boolean;
  isSystem: boolean;
  modelsCount?: number;
  hasApiKey?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  defaultProviderId?: string;
  defaultModelId?: string;
  color?: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserSettings {
  id: string;
  userId: string;
  theme: 'dark' | 'light' | 'system';
  fontSize: 'small' | 'normal' | 'large';
  compactMode: boolean;
  sendOnEnter: boolean;
  autoTitle: boolean;
  showTimestamps: boolean;
  streamResponses: boolean;
  codeLineNumbers: boolean;
  systemPrompt: string;
  defaultProviderId?: string;
  defaultModelId?: string;
  updatedAt: string;
}

export interface ChatStreamChunk {
  type: 'token' | 'reasoning' | 'usage' | 'error' | 'done';
  content?: string;
  reasoning?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latencyMs?: number;
  };
  error?: string;
}
