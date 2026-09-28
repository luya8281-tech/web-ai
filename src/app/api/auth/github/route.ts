import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'vee2.my.id';
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const cleanHost = host.includes('localhost') || host.includes('127.0.0.1') ? 'vee2.my.id' : host.replace(/:\d+$/, '');
  const baseUrl = `${proto}://${cleanHost}`;

  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_not_configured`);
  }

  if (process.env.TURNSTILE_SECRET_KEY) {
    const turnstileOk = req.cookies.get('cf_turnstile_ok')?.value === '1';
    const turnstileToken = req.nextUrl.searchParams.get('turnstile_token');
    if (!turnstileOk) {
      if (turnstileToken) {
        const { verifyTurnstileToken } = await import('@/lib/turnstile');
        const clientIp = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || null;
        const verified = await verifyTurnstileToken(turnstileToken, clientIp);
        if (!verified.success) {
          return NextResponse.redirect(`${baseUrl}/login?error=turnstile_failed`);
        }
      } else {
        return NextResponse.redirect(`${baseUrl}/login?error=turnstile_required`);
      }
    }
  }

  const redirectUri = `${baseUrl}/api/auth/callback/github`;
  const state = Math.random().toString(36).substring(2, 15);

  const authUrl = new URL('https://github.com/login/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'read:user user:email');
  authUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || baseUrl.startsWith('https'),
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  return response;
}
