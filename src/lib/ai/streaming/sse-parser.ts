import { ChatStreamChunk } from '@/types/chat';

export async function* parseOpenAISSEStream(
  stream: ReadableStream<Uint8Array>,
  abortSignal?: AbortSignal
): AsyncIterable<ChatStreamChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      if (abortSignal?.aborted) {
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep unfinished line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue; // comment or empty

        if (trimmed === 'data: [DONE]') {
          yield { type: 'done' };
          return;
        }

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);

            // Handle usage if passed in chunk
            if (data.usage) {
              yield {
                type: 'usage',
                usage: {
                  promptTokens: data.usage.prompt_tokens || 0,
                  completionTokens: data.usage.completion_tokens || 0,
                  totalTokens: data.usage.total_tokens || 0,
                },
              };
            }

            const choice = data.choices?.[0];
            if (choice) {
              const delta = choice.delta;
              if (delta) {
                // Reasoning content (DeepSeek / Qwen / Nemotron / O1/O3 style)
                if (delta.reasoning_content || delta.reasoning) {
                  yield {
                    type: 'reasoning',
                    reasoning: delta.reasoning_content || delta.reasoning,
                  };
                }

                // Standard content
                if (delta.content) {
                  yield {
                    type: 'token',
                    content: delta.content,
                  };
                }
              }

              if (choice.finish_reason) {
                // Done choice
              }
            }
          } catch (e) {
            // Non-fatal parse warning for malformed intermediate chunk
          }
        }
      }
    }

    // Flush any leftover buffer if it ends with [DONE]
    if (buffer.trim() === 'data: [DONE]') {
      yield { type: 'done' };
    }
  } finally {
    reader.releaseLock();
  }
}
