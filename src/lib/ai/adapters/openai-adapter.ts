import { AIProvider, ChatRequest, ChatResponse } from '../provider-interface';
import { Model, ChatStreamChunk, ModelCapabilities } from '@/types/chat';
import { parseOpenAISSEStream } from '../streaming/sse-parser';

export class OpenAICompatibleAdapter implements AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  protocol = 'openai-compatible';

  constructor(config: { id: string; name: string; baseUrl: string; apiKey?: string }) {
    this.id = config.id;
    this.name = config.name;
    // Normalize baseUrl: strip trailing slashes
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  supportsStreaming(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return true;
  }

  supportsTools(): boolean {
    return true;
  }

  supportsImages(): boolean {
    return true;
  }

  async testConnection(): Promise<{ ok: boolean; message: string; modelCount?: number }> {
    try {
      const url = `${this.baseUrl}/models`;
      const res = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { ok: false, message: `Authentication failed (Status ${res.status}): Invalid API Key.` };
        }
        if (res.status === 404) {
          // If /models is not found, try a tiny test completion
          return await this.testCompletionFallback();
        }
        return { ok: false, message: `Server returned error status ${res.status}: ${res.statusText}` };
      }

      const json = await res.json();
      const list = json.data || json.models || (Array.isArray(json) ? json : []);
      return {
        ok: true,
        message: `Connected successfully! Discovered ${list.length} models.`,
        modelCount: list.length,
      };
    } catch (err: any) {
      if (err.name === 'TimeoutError') {
        return { ok: false, message: `Connection timed out after 10s. Check if ${this.baseUrl} is reachable.` };
      }
      return { ok: false, message: `Connection failed: ${err.message}` };
    }
  }

  private async testCompletionFallback(): Promise<{ ok: boolean; message: string; modelCount?: number }> {
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: 'default',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: `Authentication failed (Status ${res.status}): Invalid API Key.` };
      }
      return { ok: true, message: 'Endpoint is reachable and responding.' };
    } catch (e: any) {
      return { ok: false, message: `Endpoint unreachable: ${e.message}` };
    }
  }

  async listModels(): Promise<Model[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        console.warn(`[${this.name}] /models returned status ${res.status}`);
        return [];
      }

      const data = await res.json();
      const rawList: any[] = data.data || data.models || (Array.isArray(data) ? data : []);

      return rawList.map((m: any) => {
        const modelId = m.id || m.modelId || m.name;
        const displayName = m.display_name || m.name || modelId;

        // Auto-detect capabilities
        const caps: ModelCapabilities = {
          text: true,
          vision: Boolean(
            m.capabilities?.vision ||
            m.modality?.includes('vision') ||
            modelId.toLowerCase().includes('vision') ||
            modelId.toLowerCase().includes('-vl') ||
            modelId.toLowerCase().includes('omni') ||
            modelId.toLowerCase().includes('4o')
          ),
          tools: Boolean(
            m.capabilities?.tools !== false &&
            !modelId.toLowerCase().includes('nano')
          ),
          images: Boolean(
            m.capabilities?.images ||
            modelId.toLowerCase().includes('image')
          ),
          reasoning: Boolean(
            m.capabilities?.reasoning ||
            m.reasoning_efforts ||
            modelId.toLowerCase().includes('r1') ||
            modelId.toLowerCase().includes('reasoning') ||
            modelId.toLowerCase().includes('o1') ||
            modelId.toLowerCase().includes('o3')
          ),
        };

        return {
          id: `${this.id}:${modelId}`,
          providerId: this.id,
          modelId,
          name: m.name || modelId,
          displayName,
          description: m.description || `Hosted by ${this.name}`,
          contextWindow: m.context_length || m.context_window || 128000,
          maxOutputTokens: m.max_output_tokens || 4096,
          capabilities: caps,
          pricing: m.pricing,
          isEnabled: true,
        };
      });
    } catch (err: any) {
      console.error(`[${this.name}] Failed to list models:`, err.message);
      return [];
    }
  }

  private buildPayload(request: ChatRequest, stream = false): Record<string, any> {
    const formattedMessages: any[] = [];

    // Inject system prompt if provided
    if (request.systemPrompt && request.systemPrompt.trim()) {
      formattedMessages.push({
        role: 'system',
        content: request.systemPrompt.trim(),
      });
    }

    for (const msg of request.messages) {
      if (msg.role === 'system' && request.systemPrompt) {
        // Skip duplicate system if already prepended
        continue;
      }

      if (msg.images && msg.images.length > 0) {
        // Multi-modal message format
        const contentParts: any[] = [{ type: 'text', text: msg.content }];
        for (const img of msg.images) {
          contentParts.push({
            type: 'image_url',
            image_url: {
              url: img.startsWith('data:') || img.startsWith('http') ? img : `data:image/jpeg;base64,${img}`,
            },
          });
        }
        formattedMessages.push({
          role: msg.role,
          content: contentParts,
        });
      } else {
        formattedMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    const payload: Record<string, any> = {
      model: request.model,
      messages: formattedMessages,
      stream,
    };

    if (request.temperature !== undefined) payload.temperature = request.temperature;
    if (request.topP !== undefined) payload.top_p = request.topP;
    if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens;
    if (request.reasoningEffort && request.reasoningEffort !== 'off') {
      payload.reasoning_effort = request.reasoningEffort;
    }

    return payload;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const payload = this.buildPayload(request, false);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: request.abortSignal,
    });

    if (!res.ok) {
      const errText = await res.text();
      let parsedMessage = errText;
      try {
        const json = JSON.parse(errText);
        parsedMessage = json.error?.message || json.message || errText;
      } catch (e) {}

      if (res.status === 401) throw new Error(`Authentication error (401): ${parsedMessage}`);
      if (res.status === 429) throw new Error(`Rate limit exceeded (429): ${parsedMessage}`);
      if (res.status === 404) throw new Error(`Model not found (404): Model '${request.model}' is unavailable on this provider.`);
      throw new Error(`Provider returned error (${res.status}): ${parsedMessage}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const message = choice?.message || {};

    return {
      content: message.content || '',
      reasoningContent: message.reasoning_content || null,
      model: data.model || request.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
      } : undefined,
      finishReason: choice?.finish_reason || 'stop',
    };
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    const payload = this.buildPayload(request, true);
    let res: Response;

    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
        signal: request.abortSignal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        yield { type: 'done' };
        return;
      }
      yield { type: 'error', error: `Koneksi ke provider ${this.name} terputus: ${err.message}. Silakan coba pilih model lain.` };
      return;
    }

    if (!res.ok) {
      const errText = await res.text();
      let parsed = errText;
      try {
        const json = JSON.parse(errText);
        parsed = json.error?.message || json.message || errText;
      } catch (e) {}

      yield { type: 'error', error: `Provider error (${res.status}): ${parsed}` };
      return;
    }

    if (!res.body) {
      yield { type: 'error', error: 'No response body stream received from provider.' };
      return;
    }

    yield* parseOpenAISSEStream(res.body, request.abortSignal);
  }
}
