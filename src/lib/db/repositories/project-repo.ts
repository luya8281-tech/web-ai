import db from '../index';
import { Project } from '@/types/chat';

export class ProjectRepository {
  static listProjects(userId: string): Project[] {
    const rows = db.prepare(`
      SELECT * FROM projects 
      WHERE user_id = ? 
      ORDER BY name ASC
    `).all(userId) as any[];

    return rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      name: r.name,
      description: r.description,
      systemPrompt: r.system_prompt,
      defaultProviderId: r.default_provider_id,
      defaultModelId: r.default_model_id,
      color: r.color,
      icon: r.icon,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  static getProject(id: string): Project | null {
    const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      userId: r.user_id,
      name: r.name,
      description: r.description,
      systemPrompt: r.system_prompt,
      defaultProviderId: r.default_provider_id,
      defaultModelId: r.default_model_id,
      color: r.color,
      icon: r.icon,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  static createProject(data: {
    id: string;
    userId: string;
    name: string;
    description?: string;
    systemPrompt?: string;
    defaultProviderId?: string;
    defaultModelId?: string;
    color?: string;
    icon?: string;
  }): Project {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO projects (
        id, user_id, name, description, system_prompt, default_provider_id, default_model_id, color, icon, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id,
      data.userId,
      data.name,
      data.description || null,
      data.systemPrompt || null,
      data.defaultProviderId || null,
      data.defaultModelId || null,
      data.color || '#3b82f6',
      data.icon || 'folder',
      now,
      now
    );

    return this.getProject(data.id)!;
  }

  static updateProject(id: string, data: Partial<{
    name: string;
    description: string;
    systemPrompt: string;
    defaultProviderId: string;
    defaultModelId: string;
    color: string;
    icon: string;
  }>): Project | null {
    const now = new Date().toISOString();
    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];

    if (data.name !== undefined) { updates.push('name = ?'); params.push(data.name); }
    if (data.description !== undefined) { updates.push('description = ?'); params.push(data.description); }
    if (data.systemPrompt !== undefined) { updates.push('system_prompt = ?'); params.push(data.systemPrompt); }
    if (data.defaultProviderId !== undefined) { updates.push('default_provider_id = ?'); params.push(data.defaultProviderId); }
    if (data.defaultModelId !== undefined) { updates.push('default_model_id = ?'); params.push(data.defaultModelId); }
    if (data.color !== undefined) { updates.push('color = ?'); params.push(data.color); }
    if (data.icon !== undefined) { updates.push('icon = ?'); params.push(data.icon); }

    params.push(id);
    db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    return this.getProject(id);
  }

  static deleteProject(id: string): boolean {
    const res = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return res.changes > 0;
  }
}
