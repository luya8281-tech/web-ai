import { Model, ChatStreamChunk, NativeToolCall } from '@/types/chat';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  images?: string[]; // base64 or public URLs
}

/** Skema function ala OpenAI, dikirim pada field `tools`. */
export interface NativeToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  stream?: boolean;
  abortSignal?: AbortSignal;
  tools?: NativeToolSpec[];
}

export interface ChatResponse {
  content: string;
  reasoningContent?: string;
  model: string;
  toolCalls?: NativeToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

export interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  protocol: string;

  listModels(): Promise<Model[]>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat(request: ChatRequest): AsyncIterable<ChatStreamChunk>;
  testConnection(): Promise<{ ok: boolean; message: string; modelCount?: number }>;

  supportsStreaming(): boolean;
  supportsVision(): boolean;
  supportsTools(): boolean;
  supportsImages(): boolean;
}
