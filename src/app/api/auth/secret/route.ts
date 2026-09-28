import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/auth';
import { verifyTurnstileToken } from '@/lib/turnstile';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { secret, turnstileToken } = body;

    const clientIp = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || null;
    const turnstileResult = await verifyTurnstileToken(turnstileToken, clientIp);
    if (!turnstileResult.success) {
      return NextResponse.json({ error: turnstileResult.error }, { status: 400 });
    }

    const serverSecret = process.env.AUTH_SECRET || 'chat_vps_secret_key_889214710';

    if (!secret || secret.trim() !== serverSecret.trim()) {
      return NextResponse.json({ error: 'Kunci rahasia / password salah.' }, { status: 401 });
    }

    // Find primary admin/owner user so conversations are preserved across GitHub and Secret logins
    const adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY (id LIKE 'gh_%') DESC, created_at ASC LIMIT 1").get() as any;
    const ownerUserId = adminUser?.id || 'gh_255669711';
    const now = new Date().toISOString();

    // Ensure owner user exists in database
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(ownerUserId);
    if (!existing) {
      db.prepare(`
        INSERT INTO users (id, email, name, role, created_at, updated_at)
        VALUES (?, ?, ?, 'admin', ?, ?)
      `).run(ownerUserId, 'vee@vps.local', 'Vee', now, now);
    }

    // Migrate any orphan conversations to owner
    db.prepare("UPDATE conversations SET user_id = ? WHERE user_id = 'user_vee'").run(ownerUserId);

    const { token, expiresAt } = createSession(ownerUserId);

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
