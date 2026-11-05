import { ChatStreamChunk, NativeToolCall } from '@/types/chat';

/** Akumulator lintas event: argumen tool-call datang terpecah per beberapa karakter. */
export type ToolCallAccumulator = Map<number, { id?: string; name: string; arguments: string }>;

function textFromValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromValue).join('');
  if (value && typeof value === 'object') {
    const part = value as Record<string, unknown>;
    return textFromValue(part.text ?? part.content ?? part.value ?? '');
  }
  return '';
}

function parseEvent(rawEvent: string, toolCalls?: ToolCallAccumulator): ChatStreamChunk[] | 'done' {
  const data = rawEvent
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n')
    .trim();

  if (!data) return [];
  if (data === '[DONE]') return 'done';

  try {
    const payload = JSON.parse(data);
    const chunks: ChatStreamChunk[] = [];
    const usage = payload.usage;
    if (usage) {
      const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
      const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
      chunks.push({
        type: 'usage',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: usage.total_tokens ?? promptTokens + completionTokens,
        },
      });
    }

    // Standard Chat Completions and common compatible-gateway delta shapes.
    const delta = payload.choices?.[0]?.delta ?? payload.delta ?? payload.message?.delta;
    if (delta) {
      const reasoning = textFromValue(delta.reasoning_content ?? delta.reasoning ?? delta.thinking);
      const content = textFromValue(delta.content ?? delta.text);
      if (reasoning) chunks.push({ type: 'reasoning', reasoning });
      if (content) chunks.push({ type: 'token', content });

      if (toolCalls && Array.isArray(delta.tool_calls)) {
        delta.tool_calls.forEach((frag: any, pos: number) => {
          const idx = typeof frag?.index === 'number' ? frag.index : pos;
          const slot = toolCalls.get(idx) || { name: '', arguments: '' };
          if (frag?.id) slot.id = frag.id;
          const fn = frag?.function || {};
          if (typeof fn.name === 'string' && fn.name) slot.name += fn.name;
          if (typeof fn.arguments === 'string') slot.arguments += fn.arguments;
          toolCalls.set(idx, slot);
        });
      }
    }
    return chunks;
  } catch {
    // A malformed event must not stop the rest of a live response.
    return [];
  }
}

export async function* parseOpenAISSEStream(
  stream: ReadableStream<Uint8Array>,
  abortSignal?: AbortSignal
): AsyncIterable<ChatStreamChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  const toolCalls: ToolCallAccumulator = new Map();
  let buffer = '';

  const flushToolCalls = (): ChatStreamChunk[] => {
    const calls: NativeToolCall[] = Array.from(toolCalls.values()).filter((c) => c.name || c.arguments);
    return calls.length ? [{ type: 'tool_calls', toolCalls: calls }] : [];
  };

  try {
    while (true) {
      if (abortSignal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const event of events) {
        const parsed = parseEvent(event, toolCalls);
        if (parsed === 'done') {
          yield* flushToolCalls();
          yield { type: 'done' };
          return;
        }
        yield* parsed;
      }

      // A few OpenAI-compatible gateways send one complete `data:` JSON line
      // at a time but omit SSE's blank event separator. Preserve token-by-token
      // rendering for that non-standard, but common, variant.
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const parsed = parseEvent(line, toolCalls);
        if (parsed === 'done') {
          yield* flushToolCalls();
          yield { type: 'done' };
          return;
        }
        yield* parsed;
      }
    }

    // Some compatible servers omit the final blank line.
    if (buffer.trim()) {
      const parsed = parseEvent(buffer, toolCalls);
      if (parsed === 'done') yield* flushToolCalls();
      else yield* parsed;
    }
    yield* flushToolCalls();
  } finally {
    reader.releaseLock();
  }
}
