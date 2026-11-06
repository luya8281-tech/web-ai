import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  listEmailAccounts,
  saveEmailAccount,
  deleteEmailAccount,
  listWebCredentials,
  saveWebCredential,
  deleteWebCredential,
  listCookies,
  saveCookie,
  deleteCookie,
  applyCookie,
  getVaultStats,
  getEmailAccount,
  COOKIE_PLATFORMS,
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
    const cookies = listCookies(!reveal);
    const stats = getVaultStats();

    return NextResponse.json({
      ok: true,
      emails,
      credentials,
      cookies,
      platforms: COOKIE_PLATFORMS,
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

    if (type === 'cookie') {
      const { platform, value, note, apply, action } = body;

      if (action === 'apply' || (apply && !value)) {
        if (!platform) return NextResponse.json({ error: 'Platform wajib diisi.' }, { status: 400 });
        const applied = applyCookie(String(platform));
        return NextResponse.json(
          { ok: applied.ok, ...(applied.ok ? {} : { error: applied.error }), applied, stats: getVaultStats() },
          { status: applied.ok ? 200 : 400 }
        );
      }

      if (!platform || !value) {
        return NextResponse.json(
          { error: 'Platform dan string cookie wajib diisi.' },
          { status: 400 }
        );
      }
      const res = saveCookie(String(platform), String(value), note ? String(note) : '');
      let applied = null;
      if (apply) applied = applyCookie(res.platform);
      return NextResponse.json({
        ok: true,
        message: `Cookie ${COOKIE_PLATFORMS[res.platform]?.label || res.platform} disimpan (${res.keyCount} key).` +
          (applied?.ok ? ` Berkas diterapkan ke ${applied.file}${applied.sessionSynced ? ' + .env disinkronkan' : ''}.` : ''),
        platform: res.platform,
        applied,
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

    if (type === 'cookie') {
      const ok = deleteCookie(id);
      return NextResponse.json({
        ok,
        message: ok ? `Cookie "${id}" berhasil dihapus dari Vault.` : `Cookie "${id}" tidak ditemukan.`,
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
