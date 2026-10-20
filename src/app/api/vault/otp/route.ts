import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { fetchRecentOtp } from '@/lib/vault/vault-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = getCurrentUser(req);
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Akses pembacaan OTP hanya diizinkan untuk Admin.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { label, minutes } = body;

    if (!label) {
      return NextResponse.json({ ok: false, error: 'Label akun email wajib disertakan.' }, { status: 400 });
    }

    const res = await fetchRecentOtp(label, Number(minutes) || 15);
    return NextResponse.json(res);
  } catch (err: any) {
    if (err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Sesi tidak valid / belum login.' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: err.message || 'Gagal mengambil OTP' }, { status: 500 });
  }
}
