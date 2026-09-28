import db from './db';
import crypto from 'crypto';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  avatar?: string | null;
  githubUsername?: string | null;
}

export function parseCookies(cookieHeader?: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((acc, cookie) => {
    const [name, ...val] = cookie.trim().split('=');
    if (name) acc[name] = decodeURIComponent(val.join('='));
    return acc;
  }, {} as Record<string, string>);
}

export function getUserBySessionToken(token: string): AuthUser | null {
  if (!token) return null;
  try {
    const row = db.prepare(`
      SELECT s.token, u.id, u.name, u.email, u.role, u.avatar
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ? AND s.expires_at > datetime('now')
    `).get(token) as any;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name || 'User',
      email: row.email || '',
      role: (row.role as 'admin' | 'user') || 'user',
      avatar: row.avatar || null,
    };
  } catch (err: any) {
    console.error('[Auth] Error getting user by session token:', err.message);
    return null;
  }
}

export function createSession(userId: string): { token: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('hex');
  const sessionId = 'sess_' + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  db.prepare(`
    INSERT INTO sessions (id, user_id, token, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, userId, token, expiresAt.toISOString(), new Date().toISOString());

  return { token, expiresAt };
}

export function deleteSession(token: string): void {
  try {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  } catch (err: any) {
    console.error('[Auth] Error deleting session:', err.message);
  }
}

export function upsertGitHubUser(profile: {
  id: number | string;
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}): AuthUser {
  const userId = `gh_${profile.id}`;
  const now = new Date().toISOString();
  const adminUsername = (process.env.GITHUB_ADMIN_USERNAME || 'vee').toLowerCase().trim();
  const isOwner = profile.login.toLowerCase().trim() === adminUsername;
  const role: 'admin' | 'user' = isOwner ? 'admin' : 'user';
  const displayName = profile.name || profile.login;
  const email = profile.email || `${profile.login}@users.noreply.github.com`;
  const avatar = profile.avatar_url || null;

  try {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;

    if (existing) {
      db.prepare(`
        UPDATE users
        SET name = ?, email = ?, avatar = ?, role = ?, updated_at = ?
        WHERE id = ?
      `).run(displayName, email, avatar, isOwner ? 'admin' : existing.role, now, userId);
    } else {
      db.prepare(`
        INSERT INTO users (id, name, email, role, avatar, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, displayName, email, role, avatar, now, now);

      // If this is the owner logging in, migrate legacy conversations from user_vee
      if (isOwner) {
        db.prepare('UPDATE conversations SET user_id = ? WHERE user_id = ?').run(userId, 'user_vee');
        db.prepare('UPDATE projects SET user_id = ? WHERE user_id = ?').run(userId, 'user_vee');
      }
    }

    return {
      id: userId,
      name: displayName,
      email,
      role: isOwner ? 'admin' : (existing?.role || role),
      avatar,
      githubUsername: profile.login,
    };
  } catch (err: any) {
    console.error('[Auth] Error upserting GitHub user:', err.message);
    throw err;
  }
}

export function getCurrentUser(request?: Request): AuthUser {
  // 1. Try to read session token from cookie
  if (request) {
    const cookieHeader = request.headers.get('cookie');
    const cookies = parseCookies(cookieHeader);
    const token = cookies['session_token'];

    if (token) {
      const user = getUserBySessionToken(token);
      if (user) return user;
    }
  }

  // 2. If GitHub OAuth is not yet configured, provide default user for initial setup
  const githubConfigured = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  if (!githubConfigured) {
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
    } catch {}

    return {
      id: defaultUserId,
      name: 'Vee',
      email: 'vee@vps.local',
      role: 'admin',
      avatar: null,
    };
  }

  // If GitHub OAuth is active and no valid session token exists, throw or return guest
  throw new Error('UNAUTHORIZED');
}
