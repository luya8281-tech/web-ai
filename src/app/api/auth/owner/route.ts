import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/auth';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const defaultUserId = 'user_vee';
  const now = new Date().toISOString();

  // Ensure default user exists
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(defaultUserId);
  if (!existing) {
    db.prepare(`
      INSERT INTO users (id, email, name, role, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', ?, ?)
    `).run(defaultUserId, 'vee@vps.local', 'Vee', now, now);
  }

  // Create session
  const { token, expiresAt } = createSession(defaultUserId);

  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'vee2.my.id';
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const cleanHost = host.includes('localhost') || host.includes('127.0.0.1') ? 'vee2.my.id' : host.replace(/:\d+$/, '');
  const response = NextResponse.redirect(new URL(`${proto}://${cleanHost}/`));
  response.cookies.set('session_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: expiresAt,
    path: '/',
  });

  return response;
}
