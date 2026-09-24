import db from './db';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function getCurrentUser(request?: Request): AuthUser {
  const authMode = process.env.AUTH_MODE || 'single-user';
  const defaultUserId = 'user_vee';

  // Ensure default user exists in SQLite
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(defaultUserId) as any;
  if (!existing) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (id, email, name, role, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', ?, ?)
    `).run(defaultUserId, 'vee@vps.local', 'Vee', now, now);
  }

  // If password protection is enabled in single-user mode
  if (authMode === 'single-user' && process.env.APP_PASSWORD) {
    // Check cookie or header if required
  }

  return {
    id: defaultUserId,
    name: 'Vee',
    email: 'vee@vps.local',
    role: 'admin',
  };
}
