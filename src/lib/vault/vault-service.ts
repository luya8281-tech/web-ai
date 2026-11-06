import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

const DIR = '/root/browser-agent';
const VAULT_FILE = path.join(DIR, 'vault.json');
const KEY_FILE = path.join(DIR, 'vault.key');
const EMAIL_CONFIG_FILE = path.join(DIR, 'email.json');
const AGENT_CONFIG_FILE = path.join(DIR, 'config.json');

export interface EmailAccount {
  label: string;
  email: string;
  password?: string;
  provider: 'gmail' | 'outlook' | 'yahoo' | 'custom';
  host: string;
  port: number;
  ssl: boolean;
  mailbox?: string;
  senders?: string[];
  description?: string;
  updatedAt?: string;
}

export interface WebCredential {
  name: string;
  url: string;
  username: string;
  password?: string;
  email?: string;
  userSelector?: string;
  passSelector?: string;
  submitSelector?: string;
  updatedAt?: string;
}

export interface RawVaultBlob {
  v: number;
  iv: string;
  tag: string;
  data: string;
}

export interface VaultInternalData {
  entries: Record<string, any>;
  emails?: Record<string, EmailAccount>;
  cookies?: Record<string, SocialCookie>;
}

export interface SocialCookie {
  platform: string;
  value: string;
  note?: string;
  updatedAt: number;
}

export const COOKIE_PLATFORMS: Record<string, { label: string; domains: string[]; cookieFile: string; syncEnv?: boolean }> = {
  instagram: { label: 'Instagram', domains: ['.instagram.com'], cookieFile: 'ig_cookies.txt', syncEnv: true },
  tiktok:    { label: 'TikTok',   domains: ['.tiktok.com'],  cookieFile: 'tiktok_cookies.txt' },
  youtube:   { label: 'YouTube',  domains: ['.youtube.com', '.google.com'], cookieFile: 'youtube_cookies.txt' },
  twitter:   { label: 'X / Twitter', domains: ['.twitter.com', '.x.com'], cookieFile: 'twitter_cookies.txt' },
  facebook:  { label: 'Facebook', domains: ['.facebook.com'], cookieFile: 'facebook_cookies.txt' },
  threads:   { label: 'Threads',  domains: ['.threads.net', '.threads.com'], cookieFile: 'threads_cookies.txt' },
};

function loadKey(): Buffer {
  if (!fs.existsSync(KEY_FILE)) {
    const key = crypto.randomBytes(32);
    fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
    return key;
  }
  const key = fs.readFileSync(KEY_FILE);
  if (key.length !== 32) {
    throw new Error(`Kunci vault harus 32 byte, terbaca ${key.length} byte.`);
  }
  return key;
}

function encrypt(obj: unknown): RawVaultBlob {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(obj), 'utf8'),
    cipher.final(),
  ]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decrypt(blob: RawVaultBlob): VaultInternalData {
  const key = loadKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(blob.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const out = Buffer.concat([
    decipher.update(Buffer.from(blob.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(out.toString('utf8'));
}

export function loadRawVault(): VaultInternalData {
  if (!fs.existsSync(VAULT_FILE)) {
    return { entries: {}, emails: {}, cookies: {} };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
    const obj = decrypt(raw);
    if (!obj.entries) obj.entries = {};
    if (!obj.emails) obj.emails = {};
    if (!obj.cookies) obj.cookies = {};
    return obj;
  } catch (err: any) {
    console.error('[VaultService] Gagal mendekripsi berkas vault:', err);
    return { entries: {}, emails: {}, cookies: {} };
  }
}

export function saveRawVault(obj: VaultInternalData): boolean {
  const blob = encrypt(obj);
  const tmp = VAULT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(blob, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, VAULT_FILE);

  // Synchronize emails to /root/browser-agent/email.json for otp.py
  syncEmailConfig(obj.emails || {});

  return true;
}

/**
 * Sinkronkan akun email terenkripsi ke email.json untuk pembaca OTP Python (otp.py)
 */
function syncEmailConfig(emails: Record<string, EmailAccount>) {
  const accounts: Record<string, any> = {};

  for (const [key, acc] of Object.entries(emails)) {
    if (!acc.email || !acc.password) continue;
    accounts[key] = {
      host: acc.host || 'imap.gmail.com',
      port: Number(acc.port) || 993,
      ssl: acc.ssl !== false,
      user: acc.email,
      password: acc.password,
      mailbox: acc.mailbox || 'INBOX',
      senders: Array.isArray(acc.senders) ? acc.senders : [],
      subjectHints: ['kode', 'verifikasi', 'code', 'otp', 'verification', 'security'],
      codeRegex: '',
    };
  }

  const payload = { accounts };
  const tmpEmail = EMAIL_CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmpEmail, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.renameSync(tmpEmail, EMAIL_CONFIG_FILE);

  // Pastikan otp.enabled = true di config.json
  try {
    if (fs.existsSync(AGENT_CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(AGENT_CONFIG_FILE, 'utf8'));
      cfg.otp = cfg.otp || {};
      cfg.otp.enabled = Object.keys(accounts).length > 0;
      cfg.otp.file = EMAIL_CONFIG_FILE;
      fs.writeFileSync(AGENT_CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    }
  } catch (e) {
    console.warn('[VaultService] Gagal memperbarui config.json agent:', e);
  }
}

// ----------------- CRUD EMAIL ACCOUNTS -----------------

export function listEmailAccounts(maskPasswords = true): EmailAccount[] {
  const vault = loadRawVault();
  const list: EmailAccount[] = [];

  for (const [key, item] of Object.entries(vault.emails || {})) {
    list.push({
      label: key,
      email: item.email || '',
      password: maskPasswords ? (item.password ? '••••••••' : '') : item.password,
      provider: item.provider || 'gmail',
      host: item.host || 'imap.gmail.com',
      port: item.port || 993,
      ssl: item.ssl !== false,
      mailbox: item.mailbox || 'INBOX',
      senders: item.senders || [],
      description: item.description || '',
      updatedAt: item.updatedAt || '',
    });
  }

  return list.sort((a, b) => a.label.localeCompare(b.label));
}

export function getEmailAccount(label: string, revealPassword = false): EmailAccount | null {
  const vault = loadRawVault();
  const clean = String(label).trim().toLowerCase();
  for (const [key, item] of Object.entries(vault.emails || {})) {
    if (key.toLowerCase() === clean) {
      return {
        label: key,
        email: item.email || '',
        password: revealPassword ? item.password : (item.password ? '••••••••' : ''),
        provider: item.provider || 'gmail',
        host: item.host || 'imap.gmail.com',
        port: item.port || 993,
        ssl: item.ssl !== false,
        mailbox: item.mailbox || 'INBOX',
        senders: item.senders || [],
        description: item.description || '',
        updatedAt: item.updatedAt || '',
      };
    }
  }
  return null;
}

export function saveEmailAccount(acc: EmailAccount): { ok: boolean; label: string } {
  const cleanLabel = String(acc.label).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  if (!cleanLabel) throw new Error('Label akun email wajib diisi (hanya huruf, angka, garis bawah).');
  if (!acc.email || !acc.email.includes('@')) throw new Error('Alamat email tidak valid.');

  const vault = loadRawVault();
  if (!vault.emails) vault.emails = {};

  // Jika password tidak diisi atau masked pada update, gunakan password lama
  const existing = vault.emails[cleanLabel];
  let finalPassword = acc.password?.trim();
  if (!finalPassword || finalPassword === '••••••••') {
    if (existing?.password) {
      finalPassword = existing.password;
    } else {
      throw new Error('Sandi / App Password email wajib diisi.');
    }
  }

  vault.emails[cleanLabel] = {
    label: cleanLabel,
    email: acc.email.trim(),
    password: finalPassword,
    provider: acc.provider || 'gmail',
    host: acc.host?.trim() || 'imap.gmail.com',
    port: Number(acc.port) || 993,
    ssl: acc.ssl !== false,
    mailbox: acc.mailbox?.trim() || 'INBOX',
    senders: Array.isArray(acc.senders) ? acc.senders : [],
    description: acc.description?.trim() || '',
    updatedAt: new Date().toISOString(),
  };

  saveRawVault(vault);
  return { ok: true, label: cleanLabel };
}

export function deleteEmailAccount(label: string): boolean {
  const vault = loadRawVault();
  if (!vault.emails) return false;
  const clean = String(label).trim().toLowerCase();
  const hit = Object.keys(vault.emails).find((k) => k.toLowerCase() === clean);
  if (!hit) return false;

  delete vault.emails[hit];
  saveRawVault(vault);
  return true;
}

// ----------------- CRUD WEB CREDENTIALS -----------------

export function listWebCredentials(maskPasswords = true): WebCredential[] {
  const vault = loadRawVault();
  const list: WebCredential[] = [];

  for (const [key, item] of Object.entries(vault.entries || {})) {
    list.push({
      name: key,
      url: item.url || '',
      username: item.username || '',
      password: maskPasswords ? (item.password ? '••••••••' : '') : item.password,
      email: item.email || '',
      userSelector: item.userSelector || '',
      passSelector: item.passSelector || '',
      submitSelector: item.submitSelector || '',
      updatedAt: item.updatedAt || '',
    });
  }

  return list.sort((a, b) => a.name.localeCompare(b.name));
}

export function saveWebCredential(cred: WebCredential): { ok: boolean; name: string } {
  const cleanName = String(cred.name).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  if (!cleanName) throw new Error('Nama akun login web wajib diisi.');

  const vault = loadRawVault();
  if (!vault.entries) vault.entries = {};

  const existing = vault.entries[cleanName];
  let finalPassword = cred.password?.trim();
  if (!finalPassword || finalPassword === '••••••••') {
    if (existing?.password) {
      finalPassword = existing.password;
    } else {
      finalPassword = '';
    }
  }

  vault.entries[cleanName] = {
    name: cleanName,
    url: cred.url?.trim() || '',
    username: cred.username?.trim() || '',
    password: finalPassword,
    email: cred.email?.trim() || '',
    userSelector: cred.userSelector?.trim() || '',
    passSelector: cred.passSelector?.trim() || '',
    submitSelector: cred.submitSelector?.trim() || '',
    updatedAt: new Date().toISOString(),
  };

  saveRawVault(vault);
  return { ok: true, name: cleanName };
}

export function deleteWebCredential(name: string): boolean {
  const vault = loadRawVault();
  if (!vault.entries) return false;
  const clean = String(name).trim().toLowerCase();
  const hit = Object.keys(vault.entries).find((k) => k.toLowerCase() === clean);
  if (!hit) return false;

  delete vault.entries[hit];
  saveRawVault(vault);
  return true;
}

// ----------------- COOKIES MEDIA SOSIAL -----------------

export function listCookies(mask = true): Array<SocialCookie & { masked?: string; keyCount: number; appliedFile?: string }> {
  const vault = loadRawVault();
  return Object.entries(vault.cookies || {}).map(([platform, c]) => {
    const pairs = parseCookiePairs(c.value);
    const cfg = COOKIE_PLATFORMS[platform];
    return {
      ...c,
      value: mask ? '' : c.value,
      masked: mask ? pairs.map(p => p.name).join('; ') : undefined,
      keyCount: pairs.length,
      appliedFile: cfg ? path.join(YTDLP_COOKIE_DIR, cfg.cookieFile) : undefined,
    };
  }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getCookie(platform: string, reveal = false): SocialCookie | null {
  const vault = loadRawVault();
  const c = (vault.cookies || {})[platform.toLowerCase()];
  if (!c) return null;
  return reveal ? c : { ...c, value: '' };
}

function parseCookiePairs(raw: string): Array<{ name: string; value: string }> {
  return String(raw || '')
    .split(/;\s*/)
    .map(seg => {
      const idx = seg.indexOf('=');
      if (idx <= 0) return null;
      return { name: seg.slice(0, idx).trim(), value: seg.slice(idx + 1).trim() };
    })
    .filter((p): p is { name: string; value: string } => Boolean(p && p.name));
}

const YTDLP_COOKIE_DIR = '/root/.config/yt-dlp';

export function saveCookie(platform: string, value: string, note?: string): { ok: boolean; platform: string; keyCount: number } {
  const key = String(platform || '').toLowerCase().trim();
  if (!COOKIE_PLATFORMS[key]) {
    throw new Error(`Platform tidak dikenal: ${platform}. Pilihan: ${Object.keys(COOKIE_PLATFORMS).join(', ')}`);
  }
  const pairs = parseCookiePairs(value);
  if (pairs.length === 0) {
    throw new Error('String cookie kosong atau tidak valid (format: nama=nilai;nama2=nilai2).');
  }
  const vault = loadRawVault();
  if (!vault.cookies) vault.cookies = {};
  vault.cookies[key] = { platform: key, value: pairs.map(p => `${p.name}=${p.value}`).join(';'), note: note || '', updatedAt: Date.now() };
  saveRawVault(vault);
  return { ok: true, platform: key, keyCount: pairs.length };
}

export function deleteCookie(platform: string): boolean {
  const key = String(platform || '').toLowerCase().trim();
  const vault = loadRawVault();
  if (!vault.cookies || !vault.cookies[key]) return false;
  delete vault.cookies[key];
  saveRawVault(vault);
  return true;
}

/**
 * Tulis cookie tersimpan ke berkas Netscape untuk yt-dlp/engine.
 * Instagram juga menyinkron INSTAGRAM_SESSION_ID/USER_ID ke .env.local
 * (engine memprioritaskan env di atas file cookie — tanpa sinkron, sesi
 * basi di .env diam-diam menang).
 */
export function applyCookie(platform: string): { ok: boolean; file: string; sessionSynced: boolean; keyCount: number; error?: string } {
  const key = String(platform || '').toLowerCase().trim();
  const cfg = COOKIE_PLATFORMS[key];
  if (!cfg) return { ok: false, file: '', sessionSynced: false, keyCount: 0, error: 'Platform tidak dikenal.' };

  const cookie = getCookie(key, true);
  if (!cookie) return { ok: false, file: '', sessionSynced: false, keyCount: 0, error: `Belum ada cookie tersimpan untuk ${cfg.label}.` };

  const pairs = parseCookiePairs(cookie.value);
  const expiry = String(Math.floor(Date.now() / 1000) + 3600 * 24 * 365);
  const lines = ['# Netscape HTTP Cookie File', `# ${cfg.label} — diterapkan dari Vault ${new Date().toISOString()}`];
  for (const domain of cfg.domains) {
    for (const p of pairs) {
      lines.push([domain, 'TRUE', '/', 'TRUE', expiry, p.name, p.value].join('\t'));
    }
  }
  fs.mkdirSync(YTDLP_COOKIE_DIR, { recursive: true });
  const file = path.join(YTDLP_COOKIE_DIR, cfg.cookieFile);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, lines.join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);

  let sessionSynced = false;
  if (cfg.syncEnv) {
    const sid = pairs.find(p => p.name === 'sessionid')?.value;
    const uid = pairs.find(p => p.name === 'ds_user_id')?.value;
    const envPath = '/root/ai-chat/.env.local';
    try {
      if (fs.existsSync(envPath) && sid) {
        let text = fs.readFileSync(envPath, 'utf8');
        let changed = false;
        if (/^INSTAGRAM_SESSION_ID=/m.test(text)) {
          const next = text.replace(/^INSTAGRAM_SESSION_ID=.*$/m, `INSTAGRAM_SESSION_ID="${sid}"`);
          changed = changed || next !== text; text = next;
        }
        if (uid && /^INSTAGRAM_USER_ID=/m.test(text)) {
          const next = text.replace(/^INSTAGRAM_USER_ID=.*$/m, `INSTAGRAM_USER_ID="${uid}"`);
          changed = changed || next !== text; text = next;
        }
        if (changed) {
          fs.writeFileSync(envPath, text);
          sessionSynced = true;
        }
      }
    } catch (err: any) {
      console.warn('[VaultService] Sinkron .env.local gagal:', err?.message || err);
    }
  }

  return { ok: true, file, sessionSynced, keyCount: pairs.length };
}

// ----------------- TEST KONEKSI IMAP -----------------

export async function testImapConnection(params: {
  host: string;
  port: number;
  ssl: boolean;
  user: string;
  password: string;
}): Promise<{ ok: boolean; message?: string; error?: string }> {
  const { host, port, ssl, user, password } = params;
  if (!host || !user || !password) {
    return { ok: false, error: 'Host, user/email, dan password wajib diisi.' };
  }

  const script = `
import sys, imaplib, ssl, json

host = sys.argv[1]
port = int(sys.argv[2])
use_ssl = sys.argv[3].lower() == 'true'
user = sys.argv[4]
password = sys.argv[5]

try:
    if use_ssl:
        c = imaplib.IMAP4_SSL(host, port, timeout=12)
    else:
        c = imaplib.IMAP4(host, port, timeout=12)
    
    c.login(user, password)
    typ, mboxes = c.list()
    c.logout()
    print(json.dumps({"ok": True, "message": f"Koneksi IMAP Sukses! Terverifikasi pada {host}:{port} ({user})"}))
except imaplib.IMAP4.error as e:
    err_str = str(e)
    if "AUTHENTICATIONFAILED" in err_str or "Invalid credentials" in err_str:
        print(json.dumps({"ok": False, "error": "Autentikasi Gagal: Sandi atau email salah. Jika menggunakan Gmail/Yahoo dengan 2FA, WAJIB gunakan Sandi Aplikasi (App Password 16 karakter)."}))
    else:
        print(json.dumps({"ok": False, "error": f"Error IMAP: {err_str}"}))
except Exception as e:
    print(json.dumps({"ok": False, "error": f"Gagal menghubungi server IMAP {host}:{port}: {str(e)}"}))
`;

  return new Promise((resolve) => {
    execFile(
      'python3',
      ['-c', script, host, String(port), String(ssl), user, password],
      { timeout: 15000 },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          return resolve({
            ok: false,
            error: stderr || err.message || 'Koneksi timeout atau gagal dijalankan.',
          });
        }
        try {
          const res = JSON.parse(stdout.trim());
          resolve(res);
        } catch (parseErr) {
          resolve({
            ok: false,
            error: stdout.trim() || stderr.trim() || 'Respon pengujian tidak valid.',
          });
        }
      }
    );
  });
}

// ----------------- AMBIL OTP LANGSUNG -----------------

export async function fetchRecentOtp(
  label: string,
  minutes = 15
): Promise<{ ok: boolean; code?: string; from?: string; subject?: string; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      'python3',
      [path.join(DIR, 'otp.py'), String(label), '--json', `--minutes=${minutes}`],
      { timeout: 30000 },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          return resolve({ ok: false, error: stderr || err.message });
        }
        try {
          const data = JSON.parse(stdout.trim());
          resolve(data);
        } catch {
          resolve({ ok: false, error: stdout.trim() || 'Keluaran otp.py tidak valid.' });
        }
      }
    );
  });
}

// ----------------- VAULT SUMMARY STATS -----------------

export function getVaultStats() {
  const vault = loadRawVault();
  const totalEmails = Object.keys(vault.emails || {}).length;
  const totalCredentials = Object.keys(vault.entries || {}).length;
  const totalCookies = Object.keys(vault.cookies || {}).length;

  let otpActive = false;
  try {
    if (fs.existsSync(AGENT_CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(AGENT_CONFIG_FILE, 'utf8'));
      otpActive = Boolean(cfg?.otp?.enabled && totalEmails > 0);
    }
  } catch {}

  return {
    totalEmails,
    totalCredentials,
    totalCookies,
    encryption: 'AES-256-GCM',
    keyFile: KEY_FILE,
    vaultFile: VAULT_FILE,
    otpActive,
    lastUpdated: new Date().toISOString(),
  };
}
