import db from './db';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  avatar?: string | null;
}

export function getCurrentUser(request?: Request): AuthUser {
  const defaultUserId = 'user_vee';

  try {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(defaultUserId) as any;
    if (existing) {
      return {
        id: existing.id,
        name: existing.name || 'Vee',
        email: existing.email || 'vee@vps.local',
        role: (existing.role as 'admin' | 'user') || 'admin',
        avatar: existing.avatar || null,
      };
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (id, email, name, role, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', ?, ?)
    `).run(defaultUserId, 'vee@vps.local', 'Vee', now, now);
  } catch (err: any) {
    console.error('[Auth] Error getting default user:', err.message);
  }

  return {
    id: defaultUserId,
    name: 'Vee',
    email: 'vee@vps.local',
    role: 'admin',
    avatar: null,
  };
}
