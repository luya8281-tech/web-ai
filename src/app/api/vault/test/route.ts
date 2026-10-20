import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { testImapConnection, getEmailAccount } from '@/lib/vault/vault-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = getCurrentUser(req);
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Akses uji koneksi IMAP hanya diizinkan untuk Admin.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    let { host, port, ssl, user: imapUser, email, password, label } = body;

    // Jika parameter label dikirim tanpa password, ambil dari vault tersimpan
    if (label && (!password || password === '••••••••')) {
      const existing = getEmailAccount(label, true);
      if (!existing || !existing.password) {
        return NextResponse.json(
          { ok: false, error: `Akun "${label}" tidak ditemukan di Vault.` },
          { status: 404 }
        );
      }
      host = host || existing.host;
      port = port || existing.port;
      ssl = ssl !== undefined ? ssl : existing.ssl;
      imapUser = imapUser || email || existing.email;
      password = existing.password;
    }

    const finalEmail = imapUser || email;
    if (!host || !finalEmail || !password) {
      return NextResponse.json(
        { ok: false, error: 'Host IMAP, email, dan sandi wajib diisi untuk pengetesan.' },
        { status: 400 }
      );
    }

    const res = await testImapConnection({
      host,
      port: Number(port) || 993,
      ssl: ssl !== false,
      user: finalEmail,
      password,
    });

    return NextResponse.json(res);
  } catch (err: any) {
    if (err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Sesi tidak valid / belum login.' }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: err.message || 'Gagal mengetes koneksi IMAP' }, { status: 500 });
  }
}
