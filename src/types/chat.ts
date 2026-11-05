export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  dataUrl?: string; // base64 for vision/inline if needed
}

export interface UserLocation {
  lat: number;
  lon: number;
  label?: string;
  accuracy?: number;
  updatedAt?: number;
}

export interface SearchSource {
  index?: number;
  title: string;
  url: string;
  sourceUrl?: string;
  domain: string;
  siteName?: string;
  favicon?: string;
  snippet?: string;
}

export type TaskStatus = 'aktif' | 'tertunda' | 'selesai' | 'batal';

export interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  summary?: string;
  next?: string;
  updatedAt: number;
}

export interface ActionInfo {
  id?: string;
  type: string;
  label: string;
  status: 'running' | 'done';
  /** Argumen asli tool: perintah bash, query, URL, atau path berkas. */
  subject?: string;
  startedAt?: number;
  durationMs?: number;
  isError?: boolean;
  review?: { verdict: 'allow' | 'warn' | 'block'; reason: string };
  /** Potongan reasoning yang mendahului aksi ini (diisi klien agar kronologis). */
  reasoningBefore?: string;
  details?: string;
  textBefore?: string;
  timestamp?: number;
  sources?: SearchSource[];
  command?: string;
  output?: string;
  url?: string;
  screenshotUrl?: string;
  videoUrl?: string;
  embedUrl?: string;
}

export interface MessageMetadata {
  provider?: string;
  model?: string;
  tokenInput?: number;
  tokenOutput?: number;
  totalTokens?: number;
  latencyMs?: number;
  finishReason?: string;
  actions?: ActionInfo[];
  tasks?: TaskItem[];
  sendFailed?: boolean;
  errorMessage?: string;
  feedback?: 'up' | 'down' | null;
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

export type ProviderProtocol = 'openai-compatible' | 'anthropic-compatible' | 'mock' | 'antigravity-agent' | 'codex-cli' | 'opencode-cli';

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

export type AppTheme = 'dark' | 'light' | 'midnight' | 'nord' | 'mocha' | 'rose' | 'sand' | 'system';

export interface UserSettings {
  id: string;
  userId: string;
  theme: AppTheme;
  fontSize: 'small' | 'normal' | 'large';
  fontFamily?: 'serif' | 'sans' | 'mono';
  compactMode: boolean;
  sendOnEnter: boolean;
  autoTitle: boolean;
  showTimestamps: boolean;
  streamResponses: boolean;
  codeLineNumbers: boolean;
  systemPrompt: string;
  defaultProviderId?: string;
  defaultModelId?: string;
  memoryEnabled: boolean;
  claudePersona?: string;
  updatedAt: string;
}

/** Panggilan tool native (OpenAI function calling) yang sudah lengkap terkumpul. */
export interface NativeToolCall {
  id?: string;
  name: string;
  /** JSON mentah seperti yang dikirim model; bisa tidak valid. */
  arguments: string;
}

export interface ChatStreamChunk {
  type: 'token' | 'reasoning' | 'usage' | 'error' | 'tool_calls' | 'done';
  content?: string;
  reasoning?: string;
  toolCalls?: NativeToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latencyMs?: number;
  };
  error?: string;
}
