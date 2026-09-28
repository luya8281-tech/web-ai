import { NextRequest, NextResponse } from 'next/server';
import { upsertGitHubUser, createSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vee2.my.id';

  if (error || !code) {
    console.error('[GitHub Auth] OAuth error:', error || 'No code provided');
    return NextResponse.redirect(`${appUrl}/login?error=${encodeURIComponent(error || 'cancelled')}`);
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_not_configured`);
  }

  try {
    // 1. Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('[GitHub Auth] Token exchange failed:', tokenData);
      return NextResponse.redirect(`${appUrl}/login?error=token_exchange_failed`);
    }

    const accessToken = tokenData.access_token;

    // 2. Fetch user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'Vee2-AI-Chat',
      },
    });

    if (!userRes.ok) {
      throw new Error(`Failed to fetch GitHub profile: ${userRes.statusText}`);
    }

    const ghUser = await userRes.json();

    // 3. If email is not public, fetch primary email
    let email = ghUser.email;
    if (!email) {
      try {
        const emailsRes = await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': 'Vee2-AI-Chat',
          },
        });
        if (emailsRes.ok) {
          const emails = await emailsRes.json();
          const primary = emails.find((e: any) => e.primary) || emails[0];
          if (primary) email = primary.email;
        }
      } catch (e: any) {
        console.warn('[GitHub Auth] Could not fetch private emails:', e.message);
      }
    }

    // 4. Save/update user in database
    const user = upsertGitHubUser({
      id: ghUser.id,
      login: ghUser.login,
      name: ghUser.name || ghUser.login,
      email: email || `${ghUser.login}@users.noreply.github.com`,
      avatar_url: ghUser.avatar_url,
    });

    // 5. Create secure session
    const { token, expiresAt } = createSession(user.id);

    // 6. Redirect to main app with session cookie
    const response = NextResponse.redirect(appUrl);
    response.cookies.set('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || appUrl.startsWith('https'),
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });

    // Clear state cookie
    response.cookies.delete('oauth_state');

    return response;
  } catch (err: any) {
    console.error('[GitHub Auth] Callback processing error:', err);
    return NextResponse.redirect(`${appUrl}/login?error=${encodeURIComponent(err.message || 'internal_error')}`);
  }
}
