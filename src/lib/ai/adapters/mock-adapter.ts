import { AIProvider, ChatRequest, ChatResponse } from '../provider-interface';
import { Model, ChatStreamChunk } from '@/types/chat';

export class MockDevAdapter implements AIProvider {
  id = 'mock-dev';
  name = 'Development Provider';
  baseUrl = 'http://localhost/mock';
  protocol = 'mock';

  supportsStreaming(): boolean { return true; }
  supportsVision(): boolean { return true; }
  supportsTools(): boolean { return true; }
  supportsImages(): boolean { return true; }

  async testConnection(): Promise<{ ok: boolean; message: string; modelCount?: number }> {
    return {
      ok: true,
      message: '✓ Development Provider is ready for local offline simulation.',
      modelCount: 2,
    };
  }

  async listModels(): Promise<Model[]> {
    return [
      {
        id: 'mock-dev:dev-fast-echo',
        providerId: 'mock-dev',
        modelId: 'dev-fast-echo',
        name: 'dev-fast-echo',
        displayName: 'Dev Fast Echo [Offline Mode]',
        description: 'Instant mock generator for local UI development and testing.',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        capabilities: { text: true, vision: true, tools: false, images: false, reasoning: true },
        isEnabled: true,
      },
      {
        id: 'mock-dev:dev-reasoning',
        providerId: 'mock-dev',
        modelId: 'dev-reasoning',
        name: 'dev-reasoning',
        displayName: 'Dev Reasoning Streamer [Offline Mode]',
        description: 'Simulates thinking tokens followed by markdown response.',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        capabilities: { text: true, vision: true, tools: true, images: true, reasoning: true },
        isEnabled: true,
      },
    ];
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const lastMsg = request.messages[request.messages.length - 1]?.content || 'Hello';
    return {
      content: `[Development Provider] This is a development response.\n\nYou asked:\n> ${lastMsg}\n\nHere is a code sample to verify syntax highlighting:\n\`\`\`typescript\nfunction greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n\`\`\``,
      reasoningContent: 'Simulated dev thinking: analyzing user input in offline sandbox mode.',
      model: request.model,
      usage: {
        promptTokens: 15,
        completionTokens: 45,
        totalTokens: 60,
      },
    };
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    // 1. Yield reasoning tokens
    yield { type: 'reasoning', reasoning: 'Simulating offline chain-of-thought analysis...\nVerifying request parameters and formulating response structure.' };
    await new Promise(r => setTimeout(r, 60));

    // 2. Yield development tokens
    const text = `This is a development response from **${this.name}**.\n\nYour message was received successfully.\n\n\`\`\`javascript\n// Development provider verification\nconsole.log("AI Chat Platform online!");\n\`\`\`\n\n- Multi-provider support active\n- Markdown and code block verification passed\n- Real SSE streaming simulation complete.`;
    const words = text.split(' ');

    for (const word of words) {
      if (request.abortSignal?.aborted) {
        yield { type: 'done' };
        return;
      }
      yield { type: 'token', content: word + ' ' };
      await new Promise(r => setTimeout(r, 20));
    }

    // 3. Yield usage
    yield {
      type: 'usage',
      usage: {
        promptTokens: 25,
        completionTokens: 75,
        totalTokens: 100,
      },
    };

    yield { type: 'done' };
  }
}
