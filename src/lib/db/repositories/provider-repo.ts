import db from '../index';
import { Provider, Model, ModelCapabilities, ModelPricing } from '@/types/chat';

export class ProviderRepository {
  static listProviders(): Provider[] {
    const stmt = db.prepare(`
      SELECT 
        p.*, 
        (SELECT COUNT(*) FROM models m WHERE m.provider_id = p.id) as models_count,
        (SELECT CASE WHEN api_key IS NOT NULL AND length(api_key) > 0 THEN 1 ELSE 0 END FROM provider_credentials c WHERE c.provider_id = p.id) as has_api_key
      FROM providers p
      ORDER BY p.is_default DESC, p.created_at ASC
    `);
    const rows = stmt.all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      baseUrl: r.base_url,
      protocol: r.protocol,
      isDefault: Boolean(r.is_default),
      isEnabled: Boolean(r.is_enabled),
      isSystem: Boolean(r.is_system),
      modelsCount: r.models_count || 0,
      hasApiKey: Boolean(r.has_api_key),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  static getProvider(id: string): Provider | null {
    const stmt = db.prepare(`
      SELECT 
        p.*, 
        (SELECT COUNT(*) FROM models m WHERE m.provider_id = p.id) as models_count,
        (SELECT CASE WHEN api_key IS NOT NULL AND length(api_key) > 0 THEN 1 ELSE 0 END FROM provider_credentials c WHERE c.provider_id = p.id) as has_api_key
      FROM providers p
      WHERE p.id = ?
    `);
    const r = stmt.get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      baseUrl: r.base_url,
      protocol: r.protocol,
      isDefault: Boolean(r.is_default),
      isEnabled: Boolean(r.is_enabled),
      isSystem: Boolean(r.is_system),
      modelsCount: r.models_count || 0,
      hasApiKey: Boolean(r.has_api_key),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  static getProviderApiKey(id: string): string | null {
    const stmt = db.prepare(`SELECT api_key FROM provider_credentials WHERE provider_id = ?`);
    const row = stmt.get(id) as { api_key: string } | undefined;
    return row?.api_key || null;
  }

  static createProvider(data: {
    id: string;
    name: string;
    baseUrl: string;
    protocol?: string;
    isDefault?: boolean;
    apiKey?: string;
  }): Provider {
    const now = new Date().toISOString();
    const insertProvider = db.prepare(`
      INSERT INTO providers (id, name, base_url, protocol, is_default, is_enabled, is_system, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
    `);

    db.transaction(() => {
      if (data.isDefault) {
        db.prepare('UPDATE providers SET is_default = 0').run();
      }
      insertProvider.run(
        data.id,
        data.name,
        data.baseUrl,
        data.protocol || 'openai-compatible',
        data.isDefault ? 1 : 0,
        now,
        now
      );

      if (data.apiKey) {
        db.prepare(`
          INSERT INTO provider_credentials (id, provider_id, api_key, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(data.id, data.id, data.apiKey, now, now);
      }
    })();

    return this.getProvider(data.id)!;
  }

  static updateProvider(id: string, data: {
    name?: string;
    baseUrl?: string;
    protocol?: string;
    isDefault?: boolean;
    isEnabled?: boolean;
    apiKey?: string;
  }): Provider | null {
    const now = new Date().toISOString();
    const existing = this.getProvider(id);
    if (!existing) return null;

    db.transaction(() => {
      if (data.isDefault) {
        db.prepare('UPDATE providers SET is_default = 0').run();
      }

      const updates: string[] = ['updated_at = ?'];
      const params: any[] = [now];

      if (data.name !== undefined) { updates.push('name = ?'); params.push(data.name); }
      if (data.baseUrl !== undefined) { updates.push('base_url = ?'); params.push(data.baseUrl); }
      if (data.protocol !== undefined) { updates.push('protocol = ?'); params.push(data.protocol); }
      if (data.isDefault !== undefined) { updates.push('is_default = ?'); params.push(data.isDefault ? 1 : 0); }
      if (data.isEnabled !== undefined) { updates.push('is_enabled = ?'); params.push(data.isEnabled ? 1 : 0); }

      params.push(id);
      db.prepare(`UPDATE providers SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      if (data.apiKey !== undefined) {
        const credStmt = db.prepare(`
          INSERT INTO provider_credentials (id, provider_id, api_key, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(provider_id) DO UPDATE SET api_key = excluded.api_key, updated_at = excluded.updated_at
        `);
        credStmt.run(id, id, data.apiKey, now, now);
      }
    })();

    return this.getProvider(id);
  }

  static deleteProvider(id: string): boolean {
    const result = db.prepare('DELETE FROM providers WHERE id = ? AND is_system = 0').run(id);
    return result.changes > 0;
  }

  // Model Operations
  static listModels(providerId?: string): Model[] {
    let query = `
      SELECT m.*, p.name as provider_name 
      FROM models m 
      JOIN providers p ON m.provider_id = p.id
      WHERE m.is_enabled = 1 AND p.is_enabled = 1
    `;
    const params: any[] = [];
    if (providerId) {
      query += ` AND m.provider_id = ?`;
      params.push(providerId);
    }
    query += ` ORDER BY m.is_default DESC, p.name ASC, m.display_name ASC`;

    const rows = db.prepare(query).all(...params) as any[];
    return rows.map(r => {
      let capabilities: ModelCapabilities = { text: true, vision: false, tools: false, images: false, reasoning: false };
      try {
        capabilities = JSON.parse(r.capabilities || '{}');
      } catch (e) {}

      let pricing: ModelPricing | undefined;
      try {
        if (r.pricing) pricing = JSON.parse(r.pricing);
      } catch (e) {}

      return {
        id: r.id,
        providerId: r.provider_id,
        modelId: r.model_id,
        name: r.name,
        displayName: r.display_name,
        description: r.description,
        contextWindow: r.context_window,
        maxOutputTokens: r.max_output_tokens,
        capabilities,
        pricing,
        isDefault: Boolean(r.is_default),
        isEnabled: Boolean(r.is_enabled),
      };
    });
  }

  static getModel(id: string): Model | null {
    const row = db.prepare(`
      SELECT m.*, p.name as provider_name 
      FROM models m 
      JOIN providers p ON m.provider_id = p.id
      WHERE m.id = ? OR m.model_id = ?
      LIMIT 1
    `).get(id, id) as any;

    if (!row) return null;
    let capabilities: ModelCapabilities = { text: true, vision: false, tools: false, images: false, reasoning: false };
    try {
      capabilities = JSON.parse(row.capabilities || '{}');
    } catch (e) {}

    let pricing: ModelPricing | undefined;
    try {
      if (row.pricing) pricing = JSON.parse(row.pricing);
    } catch (e) {}

    return {
      id: row.id,
      providerId: row.provider_id,
      modelId: row.model_id,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      contextWindow: row.context_window,
      maxOutputTokens: row.max_output_tokens,
      capabilities,
      pricing,
      isDefault: Boolean(row.is_default),
      isEnabled: Boolean(row.is_enabled),
    };
  }

  static upsertModels(providerId: string, modelsList: Partial<Model>[]): void {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO models (
        id, provider_id, model_id, name, display_name, description, 
        context_window, max_output_tokens, capabilities, pricing, is_default, is_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(provider_id, model_id) DO UPDATE SET
        display_name = excluded.display_name,
        description = excluded.description,
        context_window = excluded.context_window,
        max_output_tokens = excluded.max_output_tokens,
        capabilities = excluded.capabilities,
        pricing = excluded.pricing,
        updated_at = excluded.updated_at
    `);

    const insertMany = db.transaction((models: Partial<Model>[]) => {
      for (const m of models) {
        if (!m.modelId) continue;
        const id = `${providerId}:${m.modelId}`;
        const caps = JSON.stringify(m.capabilities || { text: true, vision: false, tools: false, reasoning: false, images: false });
        const price = m.pricing ? JSON.stringify(m.pricing) : null;
        stmt.run(
          id,
          providerId,
          m.modelId,
          m.name || m.modelId,
          m.displayName || m.name || m.modelId,
          m.description || null,
          m.contextWindow || 128000,
          m.maxOutputTokens || 4096,
          caps,
          price,
          m.isDefault ? 1 : 0,
          now,
          now
        );
      }
    });

    insertMany(modelsList);
  }
}
