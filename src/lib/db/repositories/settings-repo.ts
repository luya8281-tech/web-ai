import db from '../index';
import { UserSettings } from '@/types/chat';

export class SettingsRepository {
  static getUserSettings(userId: string): UserSettings {
    const existing = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as any;
    if (existing) {
      return {
        id: existing.id,
        userId: existing.user_id,
        theme: existing.theme || 'dark',
        fontSize: existing.font_size || 'normal',
        compactMode: Boolean(existing.compact_mode),
        sendOnEnter: Boolean(existing.send_on_enter),
        autoTitle: Boolean(existing.auto_title),
        showTimestamps: Boolean(existing.show_timestamps),
        streamResponses: Boolean(existing.stream_responses),
        codeLineNumbers: Boolean(existing.code_line_numbers),
        systemPrompt: existing.system_prompt || '',
        defaultProviderId: existing.default_provider_id || undefined,
        defaultModelId: existing.default_model_id || undefined,
        updatedAt: existing.updated_at,
      };
    }

    // Default settings
    const now = new Date().toISOString();
    const id = `settings_${userId}`;
    db.prepare(`
      INSERT INTO user_settings (
        id, user_id, theme, font_size, compact_mode, send_on_enter,
        auto_title, show_timestamps, stream_responses, code_line_numbers, system_prompt, updated_at
      ) VALUES (?, ?, 'dark', 'normal', 0, 1, 1, 1, 1, 1, '', ?)
    `).run(id, userId, now);

    return this.getUserSettings(userId);
  }

  static updateUserSettings(userId: string, data: Partial<UserSettings>): UserSettings {
    this.getUserSettings(userId); // ensure exists
    const now = new Date().toISOString();
    const updates: string[] = ['updated_at = ?'];
    const params: any[] = [now];

    if (data.theme !== undefined) { updates.push('theme = ?'); params.push(data.theme); }
    if (data.fontSize !== undefined) { updates.push('font_size = ?'); params.push(data.fontSize); }
    if (data.compactMode !== undefined) { updates.push('compact_mode = ?'); params.push(data.compactMode ? 1 : 0); }
    if (data.sendOnEnter !== undefined) { updates.push('send_on_enter = ?'); params.push(data.sendOnEnter ? 1 : 0); }
    if (data.autoTitle !== undefined) { updates.push('auto_title = ?'); params.push(data.autoTitle ? 1 : 0); }
    if (data.showTimestamps !== undefined) { updates.push('show_timestamps = ?'); params.push(data.showTimestamps ? 1 : 0); }
    if (data.streamResponses !== undefined) { updates.push('stream_responses = ?'); params.push(data.streamResponses ? 1 : 0); }
    if (data.codeLineNumbers !== undefined) { updates.push('code_line_numbers = ?'); params.push(data.codeLineNumbers ? 1 : 0); }
    if (data.systemPrompt !== undefined) { updates.push('system_prompt = ?'); params.push(data.systemPrompt); }
    if (data.defaultProviderId !== undefined) { updates.push('default_provider_id = ?'); params.push(data.defaultProviderId); }
    if (data.defaultModelId !== undefined) { updates.push('default_model_id = ?'); params.push(data.defaultModelId); }

    params.push(userId);
    db.prepare(`UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?`).run(...params);

    return this.getUserSettings(userId);
  }
}
