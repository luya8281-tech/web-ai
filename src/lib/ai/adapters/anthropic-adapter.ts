import { AIProvider, ChatMessage, ChatRequest, ChatResponse } from '../provider-interface';
import { Model, ChatStreamChunk } from '@/types/chat';

export class AnthropicAdapter implements AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  protocol = 'anthropic-compatible';

  constructor(config: { id: string; name: string; baseUrl?: string; apiKey?: string }) {
    this.id = config.id;
    this.name = config.name;
    this.baseUrl = (config.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  supportsStreaming(): boolean { return true; }
  supportsVision(): boolean { return true; }
  supportsTools(): boolean { return true; }
  supportsImages(): boolean { return true; }

  async testConnection(): Promise<{ ok: boolean; message: string; modelCount?: number }> {
    if (!this.apiKey) {
      return { ok: false, message: 'Anthropic API key is required.' };
    }
    try {
      const res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const text = await res.text();
        return { ok: false, message: `Anthropic error (${res.status}): ${text}` };
      }

      return { ok: true, message: 'Anthropic connection successful!' };
    } catch (e: any) {
      return { ok: false, message: `Connection failed: ${e.message}` };
    }
  }

  async listModels(): Promise<Model[]> {
    // Anthropic curated standard models
    return [
      {
        id: `${this.id}:claude-3-7-sonnet-20250219`,
        providerId: this.id,
        modelId: 'claude-3-7-sonnet-20250219',
        name: 'claude-3-7-sonnet-20250219',
        displayName: 'Claude 3.7 Sonnet',
        description: 'Anthropic flagship hybrid reasoning & coding model',
        contextWindow: 200000,
        maxOutputTokens: 64000,
        capabilities: { text: true, vision: true, tools: true, images: true, reasoning: true },
        isEnabled: true,
      },
      {
        id: `${this.id}:claude-3-5-sonnet-20241022`,
        providerId: this.id,
        modelId: 'claude-3-5-sonnet-20241022',
        name: 'claude-3-5-sonnet-20241022',
        displayName: 'Claude 3.5 Sonnet',
        description: 'Industry-leading intelligence and coding speed',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        capabilities: { text: true, vision: true, tools: true, images: true, reasoning: false },
        isEnabled: true,
      },
      {
        id: `${this.id}:claude-3-5-haiku-20241022`,
        providerId: this.id,
        modelId: 'claude-3-5-haiku-20241022',
        name: 'claude-3-5-haiku-20241022',
        displayName: 'Claude 3.5 Haiku',
        description: 'Ultra-fast and cost-effective model',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        capabilities: { text: true, vision: true, tools: true, images: true, reasoning: false },
        isEnabled: true,
      },
    ];
  }

  private formatMessages(requestMessages: ChatMessage[]) {
    return requestMessages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.images && m.images.length > 0) {
          const contentParts: any[] = [];
          for (const img of m.images) {
            const match = img.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              let mediaType = match[1];
              if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) {
                mediaType = 'image/jpeg';
              }
              contentParts.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: match[2],
                },
              });
            }
          }
          if (m.content) {
            contentParts.push({ type: 'text', text: m.content });
          }
          return { role: m.role, content: contentParts.length > 0 ? contentParts : m.content };
        }
        return { role: m.role, content: m.content };
      });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const messages = this.formatMessages(request.messages);

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.model,
        messages,
        system: request.systemPrompt,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature,
      }),
      signal: request.abortSignal,
    });

    if (!res.ok) {
      throw new Error(`Anthropic error (${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    const text = data.content?.map((c: any) => c.text).join('') || '';

    return {
      content: text,
      model: data.model,
      usage: data.usage ? {
        promptTokens: data.usage.input_tokens || 0,
        completionTokens: data.usage.output_tokens || 0,
        totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
      } : undefined,
    };
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const messages = this.formatMessages(request.messages);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey || '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: request.model,
          messages,
          system: request.systemPrompt,
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature,
          stream: true,
        }),
        signal: request.abortSignal,
      });
    } catch (err: any) {
      yield { type: 'error', error: err.message };
      return;
    }

    if (!res.ok) {
      yield { type: 'error', error: `Anthropic error (${res.status}): ${await res.text()}` };
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            try {
              const event = JSON.parse(dataStr);
              if (event.type === 'content_block_delta' && event.delta?.text) {
                yield { type: 'token', content: event.delta.text };
              }
              if (event.type === 'message_delta' && event.usage) {
                yield {
                  type: 'usage',
                  usage: {
                    promptTokens: 0,
                    completionTokens: event.usage.output_tokens || 0,
                    totalTokens: event.usage.output_tokens || 0,
                  },
                };
              }
            } catch (e) {}
          }
        }
      }
      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }
}
