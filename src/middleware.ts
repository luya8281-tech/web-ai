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

  const token = request.cookies.get('session_token')?.value;

  // If user is on /login
  if (pathname === '/login') {
    // If user already has a valid session token, redirect to chat
    if (token) {
      return NextResponse.redirect(getTargetUrl(request, '/'));
    }
    return NextResponse.next();
  }

  // If user has NO session token, ALWAYS redirect to /login
  if (!token && !pathname.startsWith('/api/')) {
    return NextResponse.redirect(getTargetUrl(request, '/login'));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
