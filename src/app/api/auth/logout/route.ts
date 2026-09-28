import { NextRequest, NextResponse } from 'next/server';
import { deleteSession, parseCookies } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const cookieHeader = req.headers.get('cookie');
  const cookies = parseCookies(cookieHeader);
  const token = cookies['session_token'];

  if (token) {
    deleteSession(token);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://vee2.my.id';
  const response = NextResponse.redirect(`${appUrl}/login`);
  response.cookies.delete('session_token');

  return response;
}

export async function GET(req: NextRequest) {
  return POST(req);
}
