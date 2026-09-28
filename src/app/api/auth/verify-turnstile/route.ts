import { NextRequest, NextResponse } from 'next/server';
import { verifyTurnstileToken } from '@/lib/turnstile';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token } = body;

    const clientIp = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || null;
    const result = await verifyTurnstileToken(token, clientIp);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    const res = NextResponse.json({ success: true });
    // Cookie valid for 10 minutes
    res.cookies.set('cf_turnstile_ok', '1', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });

    return res;
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
