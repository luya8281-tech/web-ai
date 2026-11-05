/**
 * Klien browser-agent untuk ai-chat.
 *
 * ai-chat mengirim perintah ke daemon `browser-agent` (Playwright + Chrome asli)
 * lewat HTTP lokal. Daemon inilah yang menjaga sesi browser tetap hidup antar
 * pesan chat, sehingga login/cookie tidak hilang di tengah alur multi-langkah.
 *
 * Modul ini sengaja memakai `fs` + `fetch` saja (tanpa impor Playwright) agar
 * tidak membebani bundler Next.js.
 */

import * as fs from 'fs';

const CONFIG_PATH = '/root/browser-agent/config.json';

interface AgentConfig {
  port: number;
  token: string;
}

let cachedConfig: AgentConfig | null = null;

function readConfig(): AgentConfig | null {
  if (cachedConfig) return cachedConfig;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!raw.port || !raw.token) return null;
    cachedConfig = { port: raw.port, token: raw.token };
    return cachedConfig;
  } catch {
    return null;
  }
}

export function isBrowserAgentConfigured(): boolean {
  return readConfig() !== null;
}

export interface BrowserAgentResult {
  ok: boolean;
  action?: string;
  error?: string;
  note?: string;
  needsApproval?: boolean;
  url?: string;
  title?: string;
  text?: string;
  elements?: Array<{ ref: string; tag: string; type?: string; label: string; value?: string; checked?: boolean; inFrame?: boolean }>;
  captcha?: { turnstilePresent?: boolean; turnstileSolved?: boolean; cloudframe?: boolean; cloudflareFrame?: boolean };
  blocked?: boolean;
  liveViewUrl?: string | null;
  screenshotPath?: string | null;
  screenshotUrl?: string | null;
  accounts?: Array<{ name: string; url: string; username: string; hasPassword: boolean; email: string }>;
  tabs?: Array<{ index: number; url: string }>;
  // --- Profil browser persisten ---
  profile?: string;
  dir?: string;
  switched?: boolean;
  current?: string;
  profiles?: Array<{ name: string; mtime?: string | null }>;
  chromeSignin?: {
    account?: string;
    profile?: string;
    signedIn?: boolean;
    url?: string;
    userFilled?: boolean;
    passFilled?: boolean;
    submitted?: boolean;
    recoveryDismissed?: boolean;
  };
  ms?: number;
  // --- ZenRows ---
  enabled?: boolean;
  mode?: string;
  activeSession?: boolean;
  summary?: ZenRowsSummary;
  cycle?: string;
  okCount?: number;
  total?: number;
  results?: Array<{ key: string; ok: boolean; status: number | string; credits?: number; error?: string }>;
  zenrows?: {
    mode?: string;
    key?: string;
    cookies?: number | string[];
    sessionCookie?: boolean;
    blocked?: boolean;
    remoteBlocked?: boolean;
    turnstile?: { ok?: boolean; tokenLen?: number; clicks?: number; ms?: number };
    login?: { ok?: boolean; url?: string; error?: string | null } | null;
    cookiesNames?: string[];
  };
  // --- Cookie metadata (nilai cookie tidak pernah dikirim) ---
  count?: number;
  cookies?: Array<{
    name: string;
    domain: string;
    path: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
    expires?: number;
    valueLength?: number;
  }>;
}

export interface ZenRowsKeyStatus {
  index: number;
  masked: string;
  active: boolean;
  usedCredits: number;
  remainingCreditsEst: number;
  cdPSessions?: number;
  cdpSessions?: number;
  cdpMinutesEst?: number;
  apiCalls?: number;
  bandwidthMBEst?: number;
  nearQuota?: boolean;
  exhausted?: boolean;
  invalid?: boolean;
  lastAuditStatus?: number | string | null;
  lastError?: string | null;
}

export interface ZenRowsSummary {
  currentCycle?: string;
  cycleStart?: string;
  cycleEnd?: string;
  monthlyLimitPerKey?: number;
  softRotateThreshold?: number;
  totalKeys?: number;
  activeKeyMasked?: string | null;
  activeKeyIndex?: number;
  lastAuditCycle?: string | null;
  lastAuditAt?: string | null;
  totalEstimatedUsedCredits?: number;
  quotaApiAvailable?: boolean;
  quotaNote?: string;
  keys?: ZenRowsKeyStatus[];
}

/** Panggil daemon browser-agent. Mengembalikan objek hasil (selalu ada nilai). */
export async function callBrowserAgent(
  sessionId: string,
  payload: Record<string, unknown>,
  timeoutMs = 120000
): Promise<BrowserAgentResult> {
  const cfg = readConfig();
  if (!cfg) {
    return { ok: false, error: `browser-agent belum dikonfigurasi (${CONFIG_PATH} tidak terbaca).` };
  }
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.port}/act`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ba-token': cfg.token,
      },
      body: JSON.stringify({ session: sessionId, ...payload }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json()) as BrowserAgentResult;
    return data;
  } catch (e: any) {
    const msg = e?.name === 'TimeoutError' ? `browser-agent tidak merespons dalam ${Math.round(timeoutMs / 1000)}s` : e?.message || String(e);
    return { ok: false, error: `Gagal menghubungi browser-agent: ${msg}` };
  }
}

// --------------------------- Pengurai tag ---------------------------

export interface BrowserCommand {
  action: string;
  payload: Record<string, unknown>;
  describe: string;
  /** Perintah ini membaca OTP dan wajib disetujui pengguna lebih dulu. */
  needsApproval?: boolean;
  /** Perintah ini menulis/mengubah kredensial (dilarang dari chat). */
  forbidden?: string;
}

const text = (v: string) => v.trim();

/**
 * Terjemahkan isi tag `[BROWSER: ...]` menjadi perintah daemon.
 * Sintaks: `[BROWSER: <aksi> <argumen>]`
 */
export function parseBrowserCommand(param: string): BrowserCommand {
  let raw = text(param || '');

  // Penanda opsional di akhir perintah:
  //   +layar    -> minta tangkapan layar pada aksi tersebut
  //   +penuh    -> tangkapan layar seluruh tinggi halaman (fullPage)
  //   +zenrows  -> paksa lewat ZenRows (mode hybrid, hemat kredit)
  //   +cdp      -> paksa ZenRows mode CDP penuh (cookie terikat IP remote)
  let screenshot = false;
  let fullPage = false;
  let viaZenRows = false;
  let zenrowsMode: 'hybrid' | 'cdp' | undefined;
  for (;;) {
    const fm = raw.match(/\s\+([a-zA-Z_]+)$/);
    if (!fm) break;
    const flag = fm[1].toLowerCase();
    if (flag === 'layar' || flag === 'screenshot') screenshot = true;
    else if (flag === 'penuh' || flag === 'full') { screenshot = true; fullPage = true; }
    else if (flag === 'zenrows') viaZenRows = true;
    else if (flag === 'cdp') {
      viaZenRows = true;
      zenrowsMode = 'cdp';
    } else if (flag === 'hybrid') zenrowsMode = 'hybrid';
    else break;
    raw = raw.slice(0, fm.index).trim();
  }

  const m = raw.match(/^([a-zA-Z_]+)\s*([\s\S]*)$/);
  const cmd = (m?.[1] || '').toLowerCase();
  const rest = text(m?.[2] || '');
  const pipe = () => rest.split('|').map((s) => s.trim());
  const shot = <T extends Record<string, unknown>>(payload: T): T & { screenshot?: boolean; fullPage?: boolean } =>
    screenshot ? { ...payload, screenshot: true, ...(fullPage ? { fullPage: true } : {}) } : payload;
  const zr = <T extends Record<string, unknown>>(payload: T): T & { zenrows?: boolean; zenrowsMode?: string } => {
    const out: Record<string, unknown> = { ...payload };
    if (viaZenRows) out.zenrows = true;
    if (zenrowsMode) out.zenrowsMode = zenrowsMode;
    return out as T & { zenrows?: boolean; zenrowsMode?: string };
  };
  const zrLabel = viaZenRows ? ` via ZenRows${zenrowsMode === 'cdp' ? ' CDP' : ''}` : '';

  switch (cmd) {
    case 'buka':
    case 'open':
    case 'nav':
      return {
        action: 'nav',
        payload: zr(shot({ url: rest })),
        describe: `buka ${rest}${zrLabel}${screenshot ? ' (+layar)' : ''}`,
      };

    case 'snapshot':
    case 'snap':
    case 'status':
      return { action: 'snap', payload: shot({}), describe: 'ambil status halaman' };

    case 'klik':
    case 'click': {
      const target = rest;
      return { action: 'click', payload: shot({ ref: target }), describe: `klik "${target}"${screenshot ? ' (+layar)' : ''}` };
    }

    case 'isi':
    case 'fill': {
      const [first, ...others] = pipe();
      const value = others.join('|');
      const low = first.toLowerCase();
      if (!first || low === 'teks' || low === 'text' || low === 'kolom') {
        return { action: 'fill', payload: { kind: 'text', value }, describe: 'isi kolom teks pertama' };
      }
      if (low === 'password' || low === 'sandi') {
        return { action: 'fill', payload: { kind: 'password', value }, describe: 'isi kolom sandi' };
      }
      return { action: 'fill', payload: { ref: first, value }, describe: `isi "${first}"` };
    }

    case 'tekan':
    case 'press':
      return { action: 'press', payload: { key: rest || 'Enter' }, describe: `tekan ${rest || 'Enter'}` };

    case 'scroll':
    case 'gulir':
      return { action: 'scroll', payload: { dir: rest || 'bawah' }, describe: `gulir ${rest || 'bawah'}` };

    case 'kembali':
    case 'back':
      return { action: 'back', payload: {}, describe: 'kembali ke halaman sebelumnya' };

    case 'screenshot':
    case 'layar':
    case 'shot':
      return { action: 'shot', payload: fullPage ? { fullPage: true } : {}, describe: `ambil tangkapan layar${fullPage ? ' (penuh)' : ''}` };

    case 'tunggu':
    case 'wait':
      return { action: 'wait', payload: { ms: Number(rest) || 2000 }, describe: `tunggu ${rest || 2000}ms` };

    case 'tab':
      return { action: 'switch_tab', payload: { index: Number(rest) || 0 }, describe: `pindah ke tab ${rest}` };

    case 'tab_baru':
      return { action: 'open_tab', payload: { url: rest }, describe: `buka tab baru ${rest}` };

    case 'login':
      return {
        action: 'login',
        payload: zr({ account: rest }),
        describe: `login dengan akun tersimpan "${rest}"${zrLabel}`,
      };

    case 'otp':
      return { action: 'otp', payload: { account: rest }, describe: `ambil kode OTP dari email "${rest}"`, needsApproval: true };

    case 'vault':
    case 'akun':
      return { action: 'vault_list', payload: {}, describe: 'daftar akun tersimpan' };

    case 'profil':
    case 'profile': {
      const arg = rest.replace(/^(pakai|use|ganti|switch)\s+/i, '').trim();
      if (!arg || /^(daftar|list|semua|all)$/i.test(arg)) {
        return { action: 'profile_list', payload: {}, describe: 'daftar profil browser persisten' };
      }
      return {
        action: 'profile_use',
        payload: { profile: arg },
        describe: `pakai profil browser "${arg}"`,
      };
    }

    case 'chrome': {
      const parts = rest.split(/\s+/).filter(Boolean);
      const sub = (parts[0] || '').toLowerCase();
      const arg = (['signin', 'login', 'masuk', 'sync'].includes(sub) ? parts.slice(1) : parts).join(' ');
      return {
        action: 'chrome_signin',
        payload: { account: arg || 'google_aionly' },
        describe: `login Chrome (sinkronisasi) dengan akun "${arg || 'google_aionly'}"`,
      };
    }

    case 'zenrows':
    case 'zr': {
      const parts = rest.split(/\s+/).filter(Boolean);
      const sub = (parts[0] || 'status').toLowerCase();
      const arg = parts.slice(1).join(' ');

      if (sub === 'audit' || sub === 'riset' || sub === 'cek' || sub === 'quota' || sub === 'kuota') {
        return {
          action: 'zenrows_audit',
          payload: {},
          describe: 'audit kuota ZenRows (1 request murah per API key)',
          needsApproval: true,
        };
      }
      if (sub === 'tutup' || sub === 'close' || sub === 'stop' || sub === 'matikan') {
        return { action: 'zenrows_close', payload: {}, describe: 'tutup sesi CDP ZenRows' };
      }
      if (sub === 'login' || sub === 'masuk') {
        return {
          action: 'login',
          payload: { account: arg, via: 'zenrows' },
          describe: `login akun tersimpan "${arg}" via ZenRows`,
        };
      }
      if (sub === 'buka' || sub === 'open') {
        return {
          action: 'nav',
          payload: { url: arg, zenrows: true },
          describe: `buka ${arg} via ZenRows`,
        };
      }
      return {
        action: 'zenrows_status',
        payload: {},
        describe: 'status kuota & rotasi API key ZenRows',
      };
    }

    case 'cookie':
    case 'kuki':
    case 'kukis':
      return {
        action: 'cookies',
        payload: {},
        describe: 'daftar nama cookie sesi (tanpa nilai)',
      };

    case 'reset':
      return { action: 'reset', payload: {}, describe: 'tutup sesi browser' };

    case 'simpan':
    case 'tambah_akun':
      return {
        action: 'vault_add',
        payload: {},
        describe: 'menambah akun ke vault',
        forbidden:
          'Menambah akun vault TIDAK boleh lewat chat (agar kata sandi tidak tercatat di riwayat percakapan publik). ' +
          'Buka menu Vault (ikon kunci di bilah atas aplikasi) untuk mengisi dan menyimpan sandi secara aman terenkripsi.',
      };

    default:
      return {
        action: 'unknown',
        payload: {},
        describe: `perintah tidak dikenal "${cmd}"`,
        forbidden:
          'Perintah [BROWSER] yang dikenal: buka, snapshot, klik, isi, tekan, scroll, kembali, screenshot, tunggu, tab, tab_baru, login, otp, vault, profil, chrome, cookie, zenrows, reset. ' +
          'Tambahkan +zenrows atau +cdp di akhir perintah buka/login untuk memakai ZenRows.',
      };
  }
}

/** Ubah hasil daemon menjadi catatan ringkas untuk model. */
export function formatBrowserResult(cmd: BrowserCommand, res: BrowserAgentResult): string {
  const label = cmd.forbidden ? 'DITOLAK' : res.needsApproval ? 'MENUNGGU PERSETUJUAN' : res.ok ? 'OK' : 'GAGAL';
  const head = `[BROWSER ${label}: ${cmd.describe}${res.ms ? ` | ${res.ms}ms` : ''}]`;

  if (cmd.forbidden) return `${head}\nDITOLAK: ${cmd.forbidden}`;

  if (res.needsApproval) {
    if (cmd.action === 'otp') {
      return `${head}\nPERLU PERSETUJUAN PENGGUNA: ambil OTP tidak dijalankan. Tanyakan lebih dulu kepada pengguna apakah boleh membaca email untuk mengambil kode; jalankan [BROWSER: otp ${cmd.payload.account}] lagi setelah pengguna menyetujui.`;
    }
    return `${head}\nPERLU PERSETUJUAN PENGGUNA: ${res.error || 'aksi ini memakai kredit API.'} Tanyakan izin kepada pengguna; setelah ia menyetujui, jalankan perintah yang sama sekali lagi.`;
  }

  if (!res.ok) {
    let out = `${head}\nError: ${res.error || 'tidak diketahui'}`;
    if (/tidak dikenal|tidak ditemukan/i.test(res.error || '')) {
      out += '\nSaran: panggil [BROWSER: snapshot] untuk melihat daftar rujukan elemen yang tersedia.';
    }
    return out;
  }

  const lines: string[] = [head];
  if (res.note) lines.push(`Catatan: ${res.note}`);
  if (res.title) lines.push(`Judul: ${res.title}`);
  if (res.url) lines.push(`URL: ${res.url}`);

  if (res.captcha?.turnstilePresent) {
    lines.push(
      res.captcha.turnstileSolved
        ? 'CAPTCHA: Turnstile terdeteksi dan sudah terpecahkan.'
        : 'CAPTCHA: Turnstile terdeteksi dan BELUM terpecahkan (kotak centang belum lolos). Coba klik ulang lewat snapshot, atau beri tahu pengguna bahwa situs menolak verifikasi otomatis.'
    );
  }

  if (res.summary) {
    const s = res.summary;
    lines.push(
      `ZenRows: ${res.enabled === false ? 'NONAKTIF' : 'aktif'} | mode ${res.mode || 'hybrid'} | siklus ${s.currentCycle || '-'}`
    );
    if (s.totalKeys !== undefined) {
      lines.push(
        `Key: ${s.totalKeys} (dipakai ${s.activeKeyMasked || '-'}) | batas ${s.monthlyLimitPerKey ?? '?'} kredit/key | rotasi otomatis pada ${s.softRotateThreshold ?? '?'}`
      );
    }
    if (s.lastAuditAt) {
      lines.push(`Audit terakhir: ${s.lastAuditAt}${s.lastAuditCycle ? ` (siklus ${s.lastAuditCycle})` : ''}`);
    }
    for (const k of s.keys || []) {
      const flags = [
        k.active ? 'aktif' : null,
        k.exhausted ? 'HABIS' : null,
        k.invalid ? 'INVALID' : null,
        k.nearQuota ? 'mendekati batas' : null,
      ].filter(Boolean);
      lines.push(
        `  #${k.index + 1} ${k.masked} — ${k.usedCredits ?? 0}/${s.monthlyLimitPerKey ?? '?'} kredit, sisa ~${k.remainingCreditsEst ?? '?'}` +
          (flags.length ? ` [${flags.join(', ')}]` : '')
      );
    }
    if (res.activeSession !== undefined) lines.push(`Sesi CDP aktif: ${res.activeSession ? 'ya' : 'tidak'}`);
    if (s.quotaNote) lines.push(`Catatan: ${s.quotaNote}`);
  }

  if (typeof res.okCount === 'number' && typeof res.total === 'number') {
    lines.push(`Hasil audit: ${res.okCount}/${res.total} key valid${res.cycle ? ` (siklus ${res.cycle})` : ''}`);
    for (const r of res.results || []) {
      lines.push(
        `  - ${r.key}: ${r.ok ? 'valid' : 'GAGAL'} (status ${r.status}${r.credits ? `, ${r.credits} kredit` : ''})` +
          (r.error ? ` — ${r.error.slice(0, 120)}` : '')
      );
    }
  }

  if (res.zenrows) {
    const z = res.zenrows;
    const bits = [`mode ${z.mode || '-'}`];
    if (z.key) bits.push(`key ${z.key}`);
    if (typeof z.cookies === 'number') bits.push(`${z.cookies} cookie ditransfer`);
    else if (Array.isArray(z.cookies) && z.cookies.length) bits.push(`cookie: ${z.cookies.join(', ')}`);
    if (z.sessionCookie !== undefined) bits.push(z.sessionCookie ? 'cookie sesi ada' : 'cookie sesi belum ada');
    if (z.turnstile) bits.push(`Turnstile ${z.turnstile.ok ? 'lolos' : 'belum lolos'}`);
    if (z.blocked || z.remoteBlocked) bits.push('halaman masih terblokir');
    if (z.login && z.login.ok === false) bits.push(`login gagal: ${z.login.error || 'tidak diketahui'}`);
    lines.push(`ZenRows: ${bits.join(' | ')}`);
  }

  if (res.cookies && res.cookies.length) {
    lines.push(`Cookie (${res.count ?? res.cookies.length}) — nilai tidak ditampilkan:`);
    for (const c of res.cookies.slice(0, 20)) {
      const meta = [c.domain, c.path, c.httpOnly ? 'httpOnly' : null, c.secure ? 'secure' : null]
        .filter(Boolean)
        .join(' | ');
      lines.push(`  - ${c.name} | ${meta} | ${c.valueLength ?? 0} char`);
    }
    if (res.cookies.length > 20) lines.push(`  ... dan ${res.cookies.length - 20} cookie lain.`);
  }

  if (res.accounts) {
    lines.push('Akun tersimpan di vault:');
    if (!res.accounts.length) lines.push('  (kosong — tambahkan lewat CLI di server)');
    for (const a of res.accounts) {
      lines.push(`  - ${a.name}${a.url ? ` | ${a.url}` : ''}${a.username ? ` | ${a.username}` : ''}${a.email ? ` | email OTP: ${a.email}` : ''}`);
    }
    return lines.join('\n');
  }

  if (res.profiles) {
    lines.push(`Profil browser (aktif: ${res.current || '-'}):`);
    if (!res.profiles.length) lines.push('  (belum ada profil)');
    for (const p of res.profiles) {
      const akt = p.name === res.current ? ' ← aktif' : '';
      lines.push(`  - ${p.name}${p.mtime ? ` | ${p.mtime}` : ''}${akt}`);
    }
    return lines.join('\n');
  }

  if (res.action === 'profile_use' && res.profile) {
    lines.push(`Profil browser aktif: ${res.profile}${res.note ? ` — ${res.note}` : ''}`);
  }

  if (res.chromeSignin) {
    const c = res.chromeSignin;
    lines.push(
      `Chrome sign-in: akun ${c.account || '-'} | profil ${c.profile || '-'} | ` +
        `${c.signedIn ? 'BERHASIL' : 'BELUM SELESAI'}${c.submitted ? ' | form terkirim' : ''}`
    );
  }

  if (res.tabs) {
    lines.push(`Tab terbuka (${res.tabs.length}):`);
    res.tabs.forEach((t) => lines.push(`  [${t.index}] ${t.url}`));
    return lines.join('\n');
  }

  if (res.elements && res.elements.length) {
    lines.push('Elemen interaktif (pakai rujukan ini untuk klik/isi):');
    for (const el of res.elements.slice(0, 45)) {
      const kind = el.tag + (el.type ? `:${el.type}` : '');
      const val = el.value ? ` | nilai: "${el.value}"` : '';
      const chk = el.checked === undefined ? '' : el.checked ? ' | tercentang' : ' | tidak tercentang';
      lines.push(`  [${el.ref}] ${kind} "${el.label}"${val}${chk}`);
    }
  }

  if (res.text) lines.push(`Isi halaman:\n${res.text}`);
  if (res.screenshotUrl) lines.push(`Tangkapan layar: ${res.screenshotUrl}`);

  return lines.join('\n');
}
