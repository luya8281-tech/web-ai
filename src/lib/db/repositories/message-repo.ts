import db from '../index';
import { Message, Attachment, MessageMetadata } from '@/types/chat';

export class MessageRepository {
  static listMessages(conversationId: string): Message[] {
    const rows = db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(conversationId) as any[];

    return rows.map(r => {
      let attachments: Attachment[] = [];
      try {
        attachments = JSON.parse(r.attachments || '[]');
      } catch (e) {}

      let metadata: MessageMetadata = {};
      try {
        metadata = JSON.parse(r.metadata || '{}');
      } catch (e) {}

      return {
        id: r.id,
        conversationId: r.conversation_id,
        role: r.role,
        content: r.content,
        reasoningContent: r.reasoning_content,
        model: r.model,
        provider: r.provider,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        attachments,
        metadata: {
          ...metadata,
          tokenInput: r.token_input ?? metadata.tokenInput,
          tokenOutput: r.token_output ?? metadata.tokenOutput,
          totalTokens: (r.token_input || 0) + (r.token_output || 0) || metadata.totalTokens,
          latencyMs: r.latency_ms ?? metadata.latencyMs,
          finishReason: r.finish_reason ?? metadata.finishReason,
        },
      };
    });
  }

  static getMessage(id: string): Message | null {
    const r = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as any;
    if (!r) return null;

    let attachments: Attachment[] = [];
    try {
      attachments = JSON.parse(r.attachments || '[]');
    } catch (e) {}

    let metadata: MessageMetadata = {};
    try {
      metadata = JSON.parse(r.metadata || '{}');
    } catch (e) {}

    return {
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role,
      content: r.content,
      reasoningContent: r.reasoning_content,
      model: r.model,
      provider: r.provider,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      attachments,
      metadata: {
        ...metadata,
        tokenInput: r.token_input ?? metadata.tokenInput,
        tokenOutput: r.token_output ?? metadata.tokenOutput,
        latencyMs: r.latency_ms ?? metadata.latencyMs,
        finishReason: r.finish_reason ?? metadata.finishReason,
      },
    };
  }

  static createMessage(data: {
    id: string;
    conversationId: string;
    role: string;
    content: string;
    reasoningContent?: string | null;
    model?: string;
    provider?: string;
    tokenInput?: number;
    tokenOutput?: number;
    latencyMs?: number;
    finishReason?: string;
    attachments?: Attachment[];
    metadata?: MessageMetadata;
  }): Message {
    const now = new Date().toISOString();
    const attachJson = JSON.stringify(data.attachments || []);
    const metaJson = JSON.stringify(data.metadata || {});

    db.transaction(() => {
      db.prepare(`
        INSERT INTO messages (
          id, conversation_id, role, content, reasoning_content, model, provider,
          token_input, token_output, latency_ms, finish_reason, attachments, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        data.id,
        data.conversationId,
        data.role,
        data.content,
        data.reasoningContent || null,
        data.model || null,
        data.provider || null,
        data.tokenInput ?? null,
        data.tokenOutput ?? null,
        data.latencyMs ?? null,
        data.finishReason ?? null,
        attachJson,
        metaJson,
        now,
        now
      );

      // Touch parent conversation updated_at
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, data.conversationId);
    })();

    return this.getMessage(data.id)!;
  }

  static updateMessage(id: string, data: Partial<{
    content: string;
    reasoningContent: string | null;
    model: string;
    provider: string;
    tokenInput: number;
    tokenOutput: number;
    latencyMs: number;
    finishReason: string;
    metadata: MessageMetadata;
  }>): Message | null {
    const now = new Date().toISOString();
    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];

    if (data.content !== undefined) { updates.push('content = ?'); params.push(data.content); }
    if (data.reasoningContent !== undefined) { updates.push('reasoning_content = ?'); params.push(data.reasoningContent); }
    if (data.model !== undefined) { updates.push('model = ?'); params.push(data.model); }
    if (data.provider !== undefined) { updates.push('provider = ?'); params.push(data.provider); }
    if (data.tokenInput !== undefined) { updates.push('token_input = ?'); params.push(data.tokenInput); }
    if (data.tokenOutput !== undefined) { updates.push('token_output = ?'); params.push(data.tokenOutput); }
    if (data.latencyMs !== undefined) { updates.push('latency_ms = ?'); params.push(data.latencyMs); }
    if (data.finishReason !== undefined) { updates.push('finish_reason = ?'); params.push(data.finishReason); }
    if (data.metadata !== undefined) { updates.push('metadata = ?'); params.push(JSON.stringify(data.metadata)); }

    params.push(id);
    db.prepare(`UPDATE messages SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    return this.getMessage(id);
  }

  static deleteMessage(id: string): boolean {
    const res = db.prepare('DELETE FROM messages WHERE id = ?').run(id);
    return res.changes > 0;
  }

  /**
   * For "Edit User Message" requirement (item 25):
   * Truncate all subsequent messages in the conversation after the specified messageId.
   */
  static truncateAfterMessage(conversationId: string, messageId: string): number {
    const targetMsg = this.getMessage(messageId);
    if (!targetMsg) return 0;

    const res = db.prepare(`
      DELETE FROM messages 
      WHERE conversation_id = ? 
      AND created_at > ?
    `).run(conversationId, targetMsg.createdAt);

    return res.changes;
  }
}
