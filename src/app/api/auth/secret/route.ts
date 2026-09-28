import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/auth';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { secret } = body;

    const serverSecret = process.env.AUTH_SECRET || 'chat_vps_secret_key_889214710';

    if (!secret || secret.trim() !== serverSecret.trim()) {
      return NextResponse.json({ error: 'Kunci rahasia / password salah.' }, { status: 401 });
    }

    const defaultUserId = 'user_vee';
    const now = new Date().toISOString();

    // Ensure Vee user exists
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(defaultUserId);
    if (!existing) {
      db.prepare(`
        INSERT INTO users (id, email, name, role, created_at, updated_at)
        VALUES (?, ?, ?, 'admin', ?, ?)
      `).run(defaultUserId, 'vee@vps.local', 'Vee', now, now);
    }

    const { token, expiresAt } = createSession(defaultUserId);

    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'vee2.my.id';
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    const cleanHost = host.includes('localhost') || host.includes('127.0.0.1') ? 'vee2.my.id' : host.replace(/:\d+$/, '');
    const baseUrl = `${proto}://${cleanHost}`;

    const response = NextResponse.json({ success: true, redirect: baseUrl });
    response.cookies.set('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || baseUrl.startsWith('https'),
      sameSite: 'lax',
      expires: expiresAt,
      path: '/',
    });

    return response;
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Terjadi kesalahan sistem' }, { status: 500 });
  }
}
