import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function getTargetUrl(req: NextRequest, targetPath: string): URL {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'vee2.my.id';
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const cleanHost = host.includes('localhost') || host.includes('127.0.0.1') ? 'vee2.my.id' : host.replace(/:\d+$/, '');
  return new URL(`${proto}://${cleanHost}${targetPath}`);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static files, api auth, public images, icons
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/icon') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/og-image') ||
    pathname.startsWith('/manifest.json') ||
    pathname.startsWith('/apple-touch-icon') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico')
  ) {
    return NextResponse.next();
  }

  const githubConfigured = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  const token = request.cookies.get('session_token')?.value;

  // If user is on /login
  if (pathname === '/login') {
    // If user already has a session token, OR if OAuth is not configured, redirect straight to chat!
    if (token || !githubConfigured) {
      return NextResponse.redirect(getTargetUrl(request, '/'));
    }
    return NextResponse.next();
  }

  // Protect main chat app ONLY if GitHub OAuth is configured and user has no token
  if (githubConfigured && !token && !pathname.startsWith('/api/')) {
    return NextResponse.redirect(getTargetUrl(request, '/login'));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
