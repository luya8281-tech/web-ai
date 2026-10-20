import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  listEmailAccounts,
  saveEmailAccount,
  deleteEmailAccount,
  listWebCredentials,
  saveWebCredential,
  deleteWebCredential,
  getVaultStats,
  getEmailAccount,
} from '@/lib/vault/vault-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = getCurrentUser(req);
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Akses brankas sandi (Vault) hanya diizinkan untuk Admin.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const reveal = searchParams.get('reveal') === 'true';

    const emails = listEmailAccounts(!reveal);
    const credentials = listWebCredentials(!reveal);
    const stats = getVaultStats();

    return NextResponse.json({
      ok: true,
      emails,
      credentials,
      stats,
    });
  } catch (err: any) {
    if (err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Sesi tidak valid / belum login.' }, { status: 401 });
    }
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getCurrentUser(req);
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Akses brankas sandi (Vault) hanya diizinkan untuk Admin.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const type = body.type || 'email'; // 'email' | 'web'

    if (type === 'email') {
      const { label, email, password, provider, host, port, ssl, mailbox, senders, description } = body;
      if (!label || !email) {
        return NextResponse.json(
          { error: 'Label dan alamat email wajib diisi.' },
          { status: 400 }
        );
      }

      const res = saveEmailAccount({
        label,
        email,
        password,
        provider: provider || 'gmail',
        host: host || 'imap.gmail.com',
        port: Number(port) || 993,
        ssl: ssl !== false,
        mailbox: mailbox || 'INBOX',
        senders: Array.isArray(senders) ? senders : (typeof senders === 'string' ? senders.split(',').map(s => s.trim()).filter(Boolean) : []),
        description: description || '',
      });

      return NextResponse.json({
        ok: true,
        message: `Akun email "${res.label}" berhasil disimpan ke Vault terenkripsi.`,
        label: res.label,
        stats: getVaultStats(),
      });
    }

    if (type === 'web') {
      const { name, url, username, password, email, userSelector, passSelector, submitSelector } = body;
      if (!name) {
        return NextResponse.json(
          { error: 'Nama kredensial web wajib diisi.' },
          { status: 400 }
        );
      }

      const res = saveWebCredential({
        name,
        url: url || '',
        username: username || '',
        password: password || '',
        email: email || '',
        userSelector: userSelector || '',
        passSelector: passSelector || '',
        submitSelector: submitSelector || '',
      });

      return NextResponse.json({
        ok: true,
        message: `Kredensial web "${res.name}" berhasil disimpan ke Vault terenkripsi.`,
        name: res.name,
        stats: getVaultStats(),
      });
    }

    return NextResponse.json({ error: 'Tipe entri vault tidak dikenal.' }, { status: 400 });
  } catch (err: any) {
    if (err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Sesi tidak valid / belum login.' }, { status: 401 });
    }
    return NextResponse.json({ error: err.message || 'Gagal menyimpan ke Vault' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = getCurrentUser(req);
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Akses brankas sandi (Vault) hanya diizinkan untuk Admin.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') || 'email';
    const id = searchParams.get('id') || searchParams.get('label') || searchParams.get('name');

    if (!id) {
      return NextResponse.json({ error: 'ID/Label entri wajib disertakan.' }, { status: 400 });
    }

    if (type === 'email') {
      const ok = deleteEmailAccount(id);
      return NextResponse.json({
        ok,
        message: ok ? `Akun email "${id}" berhasil dihapus dari Vault.` : `Akun email "${id}" tidak ditemukan.`,
        stats: getVaultStats(),
      });
    }

    if (type === 'web') {
      const ok = deleteWebCredential(id);
      return NextResponse.json({
        ok,
        message: ok ? `Kredensial web "${id}" berhasil dihapus dari Vault.` : `Kredensial web "${id}" tidak ditemukan.`,
        stats: getVaultStats(),
      });
    }

    return NextResponse.json({ error: 'Tipe entri vault tidak valid.' }, { status: 400 });
  } catch (err: any) {
    if (err.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Sesi tidak valid / belum login.' }, { status: 401 });
    }
    return NextResponse.json({ error: err.message || 'Gagal menghapus entri' }, { status: 500 });
  }
}
