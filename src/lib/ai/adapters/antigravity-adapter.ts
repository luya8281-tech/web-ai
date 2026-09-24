import { spawn } from 'child_process';
import { AIProvider, ChatRequest, ChatResponse } from '../provider-interface';
import { Model, ChatStreamChunk } from '@/types/chat';

export class AntigravityAgentAdapter implements AIProvider {
  id = 'antigravity';
  name = 'Antigravity AI (Agent & Tools)';
  baseUrl = 'local://antigravity-cli';
  protocol = 'antigravity-agent';
  private agyPath = '/root/.local/bin/agy';
  private workspaceDir = '/root';

  supportsStreaming(): boolean { return true; }
  supportsVision(): boolean { return true; }
  supportsTools(): boolean { return true; }
  supportsImages(): boolean { return true; }

  async testConnection(): Promise<{ ok: boolean; message: string; modelCount?: number }> {
    return new Promise((resolve) => {
      const proc = spawn(this.agyPath, ['models'], {
        cwd: this.workspaceDir,
        timeout: 10000,
      });

      let stdout = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });

      proc.on('close', (code) => {
        if (code === 0 && stdout.includes('gemini-')) {
          resolve({
            ok: true,
            message: '✓ Antigravity CLI and Agentic Ecosystem are active and ready.',
            modelCount: 14,
          });
        } else {
          resolve({
            ok: false,
            message: `Antigravity CLI exited with code ${code}. Check /root/.local/bin/agy.`,
          });
        }
      });

      proc.on('error', (err) => {
        resolve({
          ok: false,
          message: `Failed to execute agy binary: ${err.message}`,
        });
      });
    });
  }

  async listModels(): Promise<Model[]> {
    return [
      {
        id: 'antigravity:gemini-3.8-flash-high',
        providerId: 'antigravity',
        modelId: 'gemini-3.8-flash-high',
        name: 'gemini-3.8-flash-high',
        displayName: 'Gemini 3.8 Flash (High Effort Agent)',
        description: 'Native Antigravity agent with full tool execution, bash, web search, and reasoning.',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        capabilities: { text: true, vision: true, tools: true, images: true, reasoning: true },
        isEnabled: true,
      },
      {
        id: 'antigravity:claude-sonnet-4-6',
        providerId: 'antigravity',
        modelId: 'claude-sonnet-4-6',
        name: 'claude-sonnet-4-6',
        displayName: 'Claude Sonnet 4.6 (Agent Thinking)',
        description: 'Hybrid reasoning and high-precision coding agent within Antigravity.',
        contextWindow: 200000,
        maxOutputTokens: 64000,
        capabilities: { text: true, vision: true, tools: true, images: true, reasoning: true },
        isEnabled: true,
      },
      {
        id: 'antigravity:gemini-3.1-pro-high',
        providerId: 'antigravity',
        modelId: 'gemini-3.1-pro-high',
        name: 'gemini-3.1-pro-high',
        displayName: 'Gemini 3.1 Pro (High Reasoning)',
        description: 'Deep problem-solving and architectural synthesis agent.',
        contextWindow: 1048576,
        maxOutputTokens: 65536,
        capabilities: { text: true, vision: true, tools: true, images: true, reasoning: true },
        isEnabled: true,
      },
      {
        id: 'antigravity:claude-opus-4-6-thinking',
        providerId: 'antigravity',
        modelId: 'claude-opus-4-6-thinking',
        name: 'claude-opus-4-6-thinking',
        displayName: 'Claude Opus 4.6 (Max Reasoning)',
        description: 'Maximum intelligence tier for extremely complex multifaceted projects.',
        contextWindow: 200000,
        maxOutputTokens: 64000,
        capabilities: { text: true, vision: true, tools: true, images: true, reasoning: true },
        isEnabled: true,
      },
      {
        id: 'antigravity:gpt-oss-120b-medium',
        providerId: 'antigravity',
        modelId: 'gpt-oss-120b-medium',
        name: 'gpt-oss-120b-medium',
        displayName: 'GPT-OSS 120B (Medium Effort)',
        description: 'Open-weights high-efficiency model running through Antigravity gateway.',
        contextWindow: 128000,
        maxOutputTokens: 40960,
        capabilities: { text: true, vision: false, tools: true, images: false, reasoning: true },
        isEnabled: true,
      },
    ];
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    let fullText = '';
    let reasoning = '';
    let usage: any;

    for await (const chunk of this.streamChat(request)) {
      if (chunk.type === 'token' && chunk.content) fullText += chunk.content;
      if (chunk.type === 'reasoning' && chunk.reasoning) reasoning += chunk.reasoning;
      if (chunk.type === 'usage' && chunk.usage) usage = chunk.usage;
    }

    return {
      content: fullText,
      reasoningContent: reasoning || undefined,
      model: request.model,
      usage,
    };
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamChunk> {
    // 1. Prepare Prompt
    const lastUserMessage = request.messages[request.messages.length - 1];
    let promptText = lastUserMessage?.content || '';

    // If attachments or context exist, format them into the prompt
    if (request.systemPrompt && request.systemPrompt.trim()) {
      promptText = `[System Instructions: ${request.systemPrompt.trim()}]\n\n${promptText}`;
    }

    // Include recent conversational history context if multi-turn
    if (request.messages.length > 1) {
      const priorTurns = request.messages.slice(-5, -1).map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n\n');
      promptText = `Prior conversation context:\n${priorTurns}\n\nCurrent user message:\n${promptText}`;
    }

    const args = [
      '-p',
      promptText,
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions', // Auto-approve agent tools without terminal hanging
    ];

    if (request.model) {
      args.push('--model', request.model);
    }

    // Spawn agy process
    const proc = spawn(this.agyPath, args, {
      cwd: this.workspaceDir,
      env: { ...process.env, PAGER: 'cat' },
    });

    // Mitigation: Handle abort signal (kill child process cleanly when Stop is pressed)
    const abortHandler = () => {
      try {
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 1500);
      } catch (e) {}
    };

    if (request.abortSignal) {
      request.abortSignal.addEventListener('abort', abortHandler);
    }

    // Buffer output lines
    const queue: ChatStreamChunk[] = [];
    let resolveNext: (() => void) | null = null;
    let isProcessDone = false;
    let hasYieldedTokens = false;

    let buffer = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed);

          // 1. Initialization event
          if (event.event === 'init') {
            queue.push({
              type: 'reasoning',
              reasoning: `⚡ Antigravity Agent initialized (${event.init?.model || request.model}). Tools active.\n`,
            });
            if (resolveNext) resolveNext();
          }

          // 2. Step Update
          else if (event.event === 'step_update') {
            const step = event.step_update;
            if (step) {
              // Tool execution tracking (Web Search, Terminal Command, Skills, etc.)
              if (step.step_type === 'tool' || step.step_type === 'tool_call') {
                const toolName = step.tool_name || step.tool_info?.name || 'tool';
                const params = step.tool_info?.parameters || {};

                if (step.state === 'ACTIVE') {
                  let toolDesc = `🔧 [Tool: ${toolName}] Menjalankan aksi agent...\n`;
                  if (toolName === 'search_web' && params.query) {
                    toolDesc = `🌐 [Web Search Real-Time] Mencari web: "${params.query}"...\n`;
                  } else if (toolName === 'run_command' && params.CommandLine) {
                    toolDesc = `⚡ [Server Automation] Eksekusi terminal VPS: \`${params.CommandLine.substring(0, 80)}\`...\n`;
                  } else if (toolName === 'read_url_content' && params.Url) {
                    toolDesc = `🔗 [Live Web Browsing] Membaca URL: ${params.Url}...\n`;
                  } else if (toolName === 'view_file' && params.AbsolutePath) {
                    toolDesc = `📁 [Workspace VPS] Membaca file: ${params.AbsolutePath}...\n`;
                  }

                  queue.push({
                    type: 'reasoning',
                    reasoning: toolDesc,
                  });
                  if (resolveNext) resolveNext();
                } else if (step.state === 'DONE') {
                  const duration = step.duration_seconds ? ` (${step.duration_seconds.toFixed(1)}s)` : '';
                  queue.push({
                    type: 'reasoning',
                    reasoning: `✓ [Selesai] ${toolName}${duration}\n\n`,
                  });
                  if (resolveNext) resolveNext();
                }
              } else if (step.thinking_delta) {
                queue.push({
                  type: 'reasoning',
                  reasoning: step.thinking_delta,
                });
                if (resolveNext) resolveNext();
              } else if (step.text_delta) {
                // Actual assistant response text
                hasYieldedTokens = true;
                queue.push({
                  type: 'token',
                  content: step.text_delta,
                });
                if (resolveNext) resolveNext();
              }
            }
          }

          // 3. Final Result event
          else if (event.event === 'result') {
            const result = event.result;
            if (result?.response && !hasYieldedTokens) {
              hasYieldedTokens = true;
              queue.push({
                type: 'token',
                content: result.response,
              });
              if (resolveNext) resolveNext();
            }

            if (result?.usage) {
              queue.push({
                type: 'usage',
                usage: {
                  promptTokens: result.usage.input_tokens || 0,
                  completionTokens: result.usage.output_tokens || 0,
                  totalTokens: result.usage.total_tokens || 0,
                  latencyMs: Math.round((result.duration_seconds || 0) * 1000),
                },
              });
              if (resolveNext) resolveNext();
            }
          }
        } catch (e) {
          // If non-JSON text appears
          if (trimmed && !trimmed.startsWith('{')) {
            queue.push({ type: 'token', content: trimmed + '\n' });
            if (resolveNext) resolveNext();
          }
        }
      }
    });

    proc.stderr.on('data', (errChunk: Buffer) => {
      const errStr = errChunk.toString('utf-8');
      // Ignore routine progress spinners
      if (!errStr.includes('Fetching available models') && !errStr.includes('Thinking')) {
        console.warn('[agy stderr]', errStr);
      }
    });

    proc.on('close', (code) => {
      isProcessDone = true;
      if (code !== 0 && !request.abortSignal?.aborted) {
        queue.push({ type: 'error', error: `Antigravity agent exited with code ${code}` });
      }
      queue.push({ type: 'done' });
      if (resolveNext) resolveNext();
    });

    proc.on('error', (err) => {
      isProcessDone = true;
      queue.push({ type: 'error', error: `Failed to execute Antigravity agent: ${err.message}` });
      queue.push({ type: 'done' });
      if (resolveNext) resolveNext();
    });

    // Async generator yielding from queue
    try {
      while (true) {
        while (queue.length > 0) {
          const item = queue.shift()!;
          if (item.type === 'done') {
            return;
          }
          yield item;
        }

        if (isProcessDone && queue.length === 0) {
          break;
        }

        // Wait for more data
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
        resolveNext = null;
      }
    } finally {
      if (request.abortSignal) {
        request.abortSignal.removeEventListener('abort', abortHandler);
      }
      abortHandler();
    }
  }
}
