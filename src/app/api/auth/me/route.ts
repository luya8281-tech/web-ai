import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = getCurrentUser(req);
    return NextResponse.json({ user });
  } catch (err: any) {
    return NextResponse.json({ user: null, error: err.message }, { status: 200 });
  }
}
