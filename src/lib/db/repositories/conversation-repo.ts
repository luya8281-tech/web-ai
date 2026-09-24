import db from '../index';
import { Conversation, Message } from '@/types/chat';

export class ConversationRepository {
  static listConversations(params: {
    userId: string;
    projectId?: string | null;
    search?: string;
    archived?: boolean;
    pinned?: boolean;
    limit?: number;
    offset?: number;
  }): { conversations: Conversation[]; total: number } {
    let query = `
      SELECT c.*, 
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
      FROM conversations c
      WHERE c.user_id = ?
    `;
    const countQuery = `SELECT COUNT(*) as count FROM conversations c WHERE c.user_id = ?`;
    const queryParams: any[] = [params.userId];
    const countParams: any[] = [params.userId];

    if (params.projectId !== undefined) {
      if (params.projectId === null) {
        query += ` AND c.project_id IS NULL`;
      } else {
        query += ` AND c.project_id = ?`;
        queryParams.push(params.projectId);
        countParams.push(params.projectId);
      }
    }

    if (params.archived !== undefined) {
      query += ` AND c.archived = ?`;
      queryParams.push(params.archived ? 1 : 0);
      countParams.push(params.archived ? 1 : 0);
    } else {
      query += ` AND c.archived = 0`;
      countParams.push(0);
    }

    if (params.pinned !== undefined) {
      query += ` AND c.pinned = ?`;
      queryParams.push(params.pinned ? 1 : 0);
      countParams.push(params.pinned ? 1 : 0);
    }

    if (params.search && params.search.trim()) {
      const term = `%${params.search.trim()}%`;
      query += ` AND (c.title LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content LIKE ?))`;
      queryParams.push(term, term);
      countParams.push(term, term);
    }

    // Sort pinned first, then newest updated
    query += ` ORDER BY c.pinned DESC, c.updated_at DESC`;

    if (params.limit) {
      query += ` LIMIT ? OFFSET ?`;
      queryParams.push(params.limit, params.offset || 0);
    }

    const totalRow = db.prepare(countQuery).get(...countParams) as { count: number };
    const rows = db.prepare(query).all(...queryParams) as any[];

    const conversations = rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      projectId: r.project_id,
      title: r.title,
      providerId: r.provider_id,
      modelId: r.model_id,
      pinned: Boolean(r.pinned),
      archived: Boolean(r.archived),
      temporary: Boolean(r.temporary),
      systemPrompt: r.system_prompt,
      temperature: r.temperature,
      topP: r.top_p,
      maxTokens: r.max_tokens,
      reasoningEffort: r.reasoning_effort,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      messageCount: r.message_count || 0,
    }));

    return {
      conversations,
      total: totalRow ? totalRow.count : 0,
    };
  }

  static getConversation(id: string): Conversation | null {
    const r = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
      FROM conversations c
      WHERE c.id = ?
    `).get(id) as any;

    if (!r) return null;
    return {
      id: r.id,
      userId: r.user_id,
      projectId: r.project_id,
      title: r.title,
      providerId: r.provider_id,
      modelId: r.model_id,
      pinned: Boolean(r.pinned),
      archived: Boolean(r.archived),
      temporary: Boolean(r.temporary),
      systemPrompt: r.system_prompt,
      temperature: r.temperature,
      topP: r.top_p,
      maxTokens: r.max_tokens,
      reasoningEffort: r.reasoning_effort,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      messageCount: r.message_count || 0,
    };
  }

  static createConversation(data: {
    id: string;
    userId: string;
    projectId?: string | null;
    title?: string;
    providerId: string;
    modelId: string;
    pinned?: boolean;
    archived?: boolean;
    temporary?: boolean;
    systemPrompt?: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    reasoningEffort?: string;
  }): Conversation {
    const now = new Date().toISOString();
    const title = data.title || 'New Conversation';

    db.prepare(`
      INSERT INTO conversations (
        id, user_id, project_id, title, provider_id, model_id, pinned, archived, temporary,
        system_prompt, temperature, top_p, max_tokens, reasoning_effort, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id,
      data.userId,
      data.projectId || null,
      title,
      data.providerId,
      data.modelId,
      data.pinned ? 1 : 0,
      data.archived ? 1 : 0,
      data.temporary ? 1 : 0,
      data.systemPrompt || null,
      data.temperature ?? 0.7,
      data.topP ?? 1.0,
      data.maxTokens ?? null,
      data.reasoningEffort || null,
      now,
      now
    );

    return this.getConversation(data.id)!;
  }

  static updateConversation(id: string, data: Partial<{
    title: string;
    providerId: string;
    modelId: string;
    pinned: boolean;
    archived: boolean;
    temporary: boolean;
    systemPrompt: string | null;
    temperature: number;
    topP: number;
    maxTokens: number | null;
    reasoningEffort: string | null;
    projectId: string | null;
  }>): Conversation | null {
    const now = new Date().toISOString();
    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];

    if (data.title !== undefined) { updates.push('title = ?'); params.push(data.title); }
    if (data.providerId !== undefined) { updates.push('provider_id = ?'); params.push(data.providerId); }
    if (data.modelId !== undefined) { updates.push('model_id = ?'); params.push(data.modelId); }
    if (data.pinned !== undefined) { updates.push('pinned = ?'); params.push(data.pinned ? 1 : 0); }
    if (data.archived !== undefined) { updates.push('archived = ?'); params.push(data.archived ? 1 : 0); }
    if (data.temporary !== undefined) { updates.push('temporary = ?'); params.push(data.temporary ? 1 : 0); }
    if (data.systemPrompt !== undefined) { updates.push('system_prompt = ?'); params.push(data.systemPrompt); }
    if (data.temperature !== undefined) { updates.push('temperature = ?'); params.push(data.temperature); }
    if (data.topP !== undefined) { updates.push('top_p = ?'); params.push(data.topP); }
    if (data.maxTokens !== undefined) { updates.push('max_tokens = ?'); params.push(data.maxTokens); }
    if (data.reasoningEffort !== undefined) { updates.push('reasoning_effort = ?'); params.push(data.reasoningEffort); }
    if (data.projectId !== undefined) { updates.push('project_id = ?'); params.push(data.projectId); }

    params.push(id);
    db.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    return this.getConversation(id);
  }

  static touchConversation(id: string): void {
    const now = new Date().toISOString();
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, id);
  }

  static deleteConversation(id: string): boolean {
    const res = db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    return res.changes > 0;
  }
}

