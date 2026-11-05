import { spawn } from 'child_process';
import { buildHistoryText } from './history-util';
import { AIProvider, ChatRequest, ChatResponse } from '../provider-interface';
import { Model, ChatStreamChunk } from '@/types/chat';

// Codex CLI does not provide a `models` command. Keep this list limited to IDs
// confirmed on this server; the selected model ID is passed to `codex exec`
// without translation.
const CODEX_CLI_MODELS: ReadonlyArray<{ modelId: string; name: string; isDefault?: boolean }> = [
  { modelId: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
  { modelId: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' },
  { modelId: 'gpt-6-astra', name: 'GPT-6 Astra' },
  { modelId: 'gpt-6-sol', name: 'GPT-6 Sol' },
  { modelId: 'gpt-6-luna', name: 'GPT-6 Luna' },
  { modelId: 'gpt-reserve', name: 'GPT Reserve' },
  { modelId: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
  { modelId: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', isDefault: true },
  { modelId: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
  { modelId: 'gpt-5.5', name: 'GPT-5.5' },
] as const;

const CODEX_REASONING_EFFORTS = new Set([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

export class CodexAdapter implements AIProvider {
  id = 'codex';
  name = 'Codex CLI Agent';
  baseUrl = 'local://codex-cli';
  protocol = 'codex-cli';
  private codexPath = '/usr/bin/codex';
  private workspaceDir = '/root';

  constructor(config?: { id?: string, name?: string, apiKey?: string }) {
    if (config?.id) this.id = config.id;
    if (config?.name) this.name = config.name;
  }

  supportsStreaming(): boolean { return true; }
  supportsVision(): boolean { return false; }
  supportsTools(): boolean { return true; } // Codex inherently uses tools
  supportsImages(): boolean { return false; }

  async testConnection(): Promise<{ ok: boolean; message: string; modelCount?: number }> {
    return new Promise((resolve) => {
      const proc = spawn(this.codexPath, ['--version']);
      let out = '';
      proc.stdout.on('data', d => out += d.toString());
      proc.on('close', code => {
        if (code === 0) resolve({ ok: true, message: `Connected to Codex CLI: ${out.trim()}`, modelCount: CODEX_CLI_MODELS.length });
        else resolve({ ok: false, message: 'Failed to run codex --version' });
      });
      proc.on('error', err => resolve({ ok: false, message: err.message }));
    });
  }

  async listModels(): Promise<Model[]> {
    return CODEX_CLI_MODELS.map((model) => ({
      id: `${this.id}:${model.modelId}`,
      providerId: this.id,
      modelId: model.modelId,
      name: `${model.name} (Codex)`,
      displayName: model.name,
      description: 'Run locally through the authenticated Codex CLI.',
      isDefault: model.isDefault ?? false,
      contextWindow: 1000000,
      capabilities: {
        text: true,
        vision: false,
        tools: true,
        images: false,
        reasoning: true,
      },
    }));
  }

  async *streamChat(request: ChatRequest): AsyncGenerator<ChatStreamChunk, void, unknown> {
    // 1. Prepare Prompt
    const lastUserMessage = request.messages[request.messages.length - 1];
    let promptText = lastUserMessage?.content || '';

    // If attachments or context exist, format them into the prompt
    if (request.systemPrompt && request.systemPrompt.trim()) {
      promptText = `[System Instructions: ${request.systemPrompt.trim()}]\n\n${promptText}`;
    }

    // Codex CLI menyuntik persona "coding agent yang ringkas" sendiri; tanpa
    // penanda gaya ini jawabannya jauh lebih kering daripada model chat biasa.
    promptText = `[Gaya Jawaban: bernuansa, hangat, dan komunikatif seperti asisten percakapan — jelaskan konteks seperlunya, jangan gugup kata. Tetap patuhi seluruh instruksi sistem di atas.]\n\n${promptText}`;

    if (request.messages.length > 1) {
      const priorTurns = buildHistoryText(request.messages.slice(0, -1), { budgetChars: 60000 });
      promptText = `Prior conversation context:\n${priorTurns}\n\nCurrent user message:\n${promptText}`;
    }

    const args = [
      'exec',
      '--skip-git-repo-check',
      '--json',
      '--ephemeral',
      '--dangerously-bypass-approvals-and-sandbox' // Auto-approve agent tools without terminal hanging
    ];

    if (request.model) {
      args.push('--model', request.model);
    }

    // Codex reads reasoning effort from configuration rather than a dedicated
    // `exec` flag. Apply a validated per-request override; when omitted, the
    // user's configured CLI default remains in effect.
    const reasoningEffort = request.reasoningEffort?.trim().toLowerCase();
    if (reasoningEffort && CODEX_REASONING_EFFORTS.has(reasoningEffort)) {
      args.push('--config', `model_reasoning_effort="${reasoningEffort}"`);
    }

    // Default CLI untuk verbosity model keluarga GPT-5 sering "low" — sumber
    // utama jawaban pelit. Bisa dinaikkan via env tanpa deploy ulang.
    const verbosity = ['low', 'medium', 'high'].includes((process.env.CODEX_VERBOSITY || '').toLowerCase())
      ? process.env.CODEX_VERBOSITY.toLowerCase()
      : 'medium';
    args.push('--config', `model_verbosity="${verbosity}"`);

    // Pass the prompt as an argument
    args.push(promptText);

    const env: any = { ...process.env };

    const proc = spawn(this.codexPath, args, {
      cwd: this.workspaceDir,
      env
    });

    // Close stdin so it doesn't wait forever
    proc.stdin.end();

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

    const queue: ChatStreamChunk[] = [];
    let resolveNext: (() => void) | null = null;
    let isProcessDone = false;
    let emittedAgentText = '';

    // Codex CLI versions differ: some send appended deltas while others send
    // full message snapshots. Normalize both without duplicating the answer.
    const emitAgentText = (value: unknown, isSnapshot = false) => {
      const text = typeof value === 'string'
        ? value
        : Array.isArray(value)
          ? value.map((part) => typeof part === 'string' ? part : part?.text || part?.content || '').join('')
          : value && typeof value === 'object'
            ? (value as any).text || (value as any).content || ''
            : '';
      if (!text) return;

      let nextText = text;
      if (isSnapshot) {
        if (text.startsWith(emittedAgentText)) nextText = text.slice(emittedAgentText.length);
        else if (emittedAgentText.startsWith(text)) return;
        emittedAgentText = text;
      } else {
        emittedAgentText += text;
      }
      if (!nextText) return;

      const words = nextText.split(/([ \n]+)/);
      for (const word of words) {
        if (!word) continue;
        queue.push({ type: 'token', content: word, delay: 50 } as any);
      }
      if (resolveNext) resolveNext();
    };

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

          if (event.type === 'thread.started') {
            queue.push({
              type: 'reasoning',
              reasoning: `⚡ Codex Agent initialized (Thread: ${event.thread_id}).\n`,
            });
            if (resolveNext) resolveNext();
          } else if (
            (event.type === 'item.updated' || event.type === 'item.delta') &&
            event.item?.type === 'agent_message'
          ) {
            emitAgentText(
              event.delta?.text ?? event.delta?.content ?? event.item.text ?? event.item.content,
              !event.delta
            );
          } else if (event.type === 'item.started' && event.item && event.item.type !== 'agent_message') {
            const toolDesc = event.item.command || event.item.query || event.item.path || JSON.stringify(event.item.args || {});
            queue.push({
              type: 'reasoning',
              reasoning: `\n\n🔧 **Action:** [${event.item.type}] ${toolDesc}\n`
            });
            if (resolveNext) resolveNext();
          } else if (event.type === 'item.completed' && event.item && event.item.type !== 'agent_message') {
            const status = event.item.exit_code === 0 ? 'Success' : 'Completed';
            queue.push({
              type: 'reasoning',
              reasoning: `✅ **Result:** ${status}\n\n`
            });
            if (resolveNext) resolveNext();
          } else if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
            emitAgentText(event.item.text ?? event.item.content, true);
          } else if (event.type === 'turn.completed' && event.usage) {
            queue.push({
              type: 'usage',
              usage: {
                promptTokens: event.usage.input_tokens || 0,
                completionTokens: event.usage.output_tokens || 0,
                totalTokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
                latencyMs: 0,
              },
            });
            if (resolveNext) resolveNext();
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
      if (errStr.includes('Reading additional input')) return; // Ignore this known stderr
      // Let's stream stderr as reasoning so the user sees tool actions!
      queue.push({
        type: 'reasoning',
        reasoning: errStr,
      });
      if (resolveNext) resolveNext();
    });

    proc.on('close', (code) => {
      isProcessDone = true;
      if (code !== 0 && !request.abortSignal?.aborted) {
        queue.push({ type: 'error', error: `Codex agent exited with code ${code}` });
      }
      queue.push({ type: 'done' });
      if (resolveNext) resolveNext();
    });

    proc.on('error', (err) => {
      isProcessDone = true;
      queue.push({ type: 'error', error: `Failed to execute Codex agent: ${err.message}` });
      queue.push({ type: 'done' });
      if (resolveNext) resolveNext();
    });

    try {
      while (true) {
        while (queue.length > 0) {
          const item = queue.shift()!;
          if (item.type === 'done') {
            return;
          }
          if ((item as any).delay) {
            await new Promise(resolve => setTimeout(resolve, (item as any).delay));
          }
          yield item;
        }

        if (isProcessDone && queue.length === 0) {
          break;
        }

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

  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new Error('Codex adapter only supports streaming');
  }
}
