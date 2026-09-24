import { ProviderRepository } from '../db/repositories/provider-repo';
import { AIProvider, ChatRequest, ChatResponse } from './provider-interface';
import { OpenAICompatibleAdapter } from './adapters/openai-adapter';
import { AnthropicAdapter } from './adapters/anthropic-adapter';
import { MockDevAdapter } from './adapters/mock-adapter';
import { AntigravityAgentAdapter } from './adapters/antigravity-adapter';
import { ChatStreamChunk } from '@/types/chat';

export class AIRouter {
  static getProviderInstance(providerId: string): AIProvider {
    // Check if Antigravity native agent
    if (providerId === 'antigravity') {
      return new AntigravityAgentAdapter();
    }

    // Check if mock
    if (providerId === 'mock-dev') {
      return new MockDevAdapter();
    }

    // Check if VPS AI from environment
    if (providerId === 'vps-ai' && process.env.VPS_AI_BASE_URL) {
      return new OpenAICompatibleAdapter({
        id: 'vps-ai',
        name: process.env.VPS_AI_NAME || 'My VPS AI',
        baseUrl: process.env.VPS_AI_BASE_URL,
        apiKey: process.env.VPS_AI_API_KEY,
      });
    }

    const providerRecord = ProviderRepository.getProvider(providerId);
    if (!providerRecord) {
      throw new Error(`Provider '${providerId}' not found. Please configure it in Provider Settings.`);
    }

    const apiKey = ProviderRepository.getProviderApiKey(providerId) || undefined;

    switch (providerRecord.protocol) {
      case 'antigravity-agent':
        return new AntigravityAgentAdapter();

      case 'anthropic-compatible':
        return new AnthropicAdapter({
          id: providerRecord.id,
          name: providerRecord.name,
          baseUrl: providerRecord.baseUrl,
          apiKey,
        });

      case 'mock':
        return new MockDevAdapter();

      case 'openai-compatible':
      default:
        return new OpenAICompatibleAdapter({
          id: providerRecord.id,
          name: providerRecord.name,
          baseUrl: providerRecord.baseUrl,
          apiKey,
        });
    }
  }

  static async chat(
    providerId: string,
    request: ChatRequest
  ): Promise<ChatResponse> {
    const startTime = Date.now();
    const provider = this.getProviderInstance(providerId);

    try {
      const response = await provider.chat(request);
      const latency = Date.now() - startTime;
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        provider: providerId,
        model: request.model,
        latencyMs: latency,
        status: 'success',
      }));
      return response;
    } catch (err: any) {
      const latency = Date.now() - startTime;
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        provider: providerId,
        model: request.model,
        latencyMs: latency,
        status: 'error',
        error: err.message,
      }));
      throw err;
    }
  }

  static async *streamChat(
    providerId: string,
    request: ChatRequest
  ): AsyncIterable<ChatStreamChunk> {
    const startTime = Date.now();
    const provider = this.getProviderInstance(providerId);

    try {
      const stream = provider.streamChat(request);
      for await (const chunk of stream) {
        yield chunk;
      }
      const latency = Date.now() - startTime;
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        provider: providerId,
        model: request.model,
        latencyMs: latency,
        status: 'stream_completed',
      }));
    } catch (err: any) {
      const latency = Date.now() - startTime;
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        provider: providerId,
        model: request.model,
        latencyMs: latency,
        status: 'stream_error',
        error: err.message,
      }));
      yield { type: 'error', error: err.message };
    }
  }
}
