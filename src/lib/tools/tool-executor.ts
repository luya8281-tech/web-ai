/**
 * Universal Tool Executor for AI Chat Platform
 * Supports: [CARI_WEB: query], [RUN_BASH: cmd], [BUKA_WEB: url], [BACA_SKILL: name], [CEK_CUACA: lat,lon | kota], [AMBIL_SUBTITEL: url], [AMBIL_HALAMAN: url]
 */

import { exec, execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { parseToolTags } from '@/lib/utils/clean-content';
import {
  callBrowserAgent,
  formatBrowserResult,
  parseBrowserCommand,
  isBrowserAgentConfigured,
} from '@/lib/tools/browser-agent';
import {
  extractTikTokMedia,
  getSmartEmbedUrl,
  isTikTokUrl,
} from '@/lib/tools/social-media';
import { createFileFromContent, stageExistingFile } from '@/lib/tools/file-generator';
import { MEDIA_TAG_NAMES } from '@/lib/utils/clean-content';
import { MemoryRepository } from '@/lib/db/repositories/memory-repo';
import { WorkSessionRepository } from '@/lib/db/repositories/work-session-repo';
import { callMcpTool } from '@/lib/mcp/manager';
import { runCli } from '@/lib/cli-bridge';
import { scheduleDetachedJob } from '@/lib/ai/detached-jobs';

import { SearchSource } from '@/types/chat';

export interface ToolStep {
  /** Param persis seperti yang ditulis model — dipakai untuk mencocokkan kartu aksi. */
  param: string;
  ok: boolean;
  durationMs: number;
  output: string;
  sources?: SearchSource[];
}

export interface ToolResult {
  hasAction: boolean;
  observation: string;
  sources?: SearchSource[];
  command?: string;
  output?: string;
  /** Hasil terpisah per panggilan tool (multi-query / multi-perintah) untuk UI live. */
  steps?: ToolStep[];
  url?: string;
  screenshotUrl?: string;
  videoUrl?: string;
  embedUrl?: string;
  stagedPaths?: string[];
}

function truncateOutput(text: string, maxLen: number): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + `\n...[truncated, ${text.length - maxLen} chars omitted]`;
}

// --- Cuaca via Open-Meteo (tanpa API key) ---

function wmoToId(code: number): string {
  const m: Record<number, string> = {
    0: 'Cerah', 1: 'Cerah berawan', 2: 'Berawan sebagian', 3: 'Mendung',
    45: 'Berkabut', 48: 'Berkabut es',
    51: 'Gerimis ringan', 53: 'Gerimis', 55: 'Gerimis lebat',
    56: 'Gerimis beku ringan', 57: 'Gerimis beku lebat',
    61: 'Hujan ringan', 63: 'Hujan sedang', 65: 'Hujan lebat',
    66: 'Hujan beku ringan', 67: 'Hujan beku lebat',
    71: 'Salju ringan', 73: 'Salju sedang', 75: 'Salju lebat', 77: 'Butiran salju',
    80: 'Hujan singkat ringan', 81: 'Hujan singkat sedang', 82: 'Hujan singkat lebat',
    85: 'Hujan salju ringan', 86: 'Hujan salju lebat',
    95: 'Badai petir', 96: 'Badai petir + hujan es ringan', 99: 'Badai petir + hujan es lebat',
  };
  return m[code] ?? `Kode cuaca ${code}`;
}

async function fetchJson(url: string, timeoutMs = 15000): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ai-chat-weather/1.0', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} untuk ${url}`);
  return res.json();
}

async function checkWeather(rawParam: string): Promise<string> {
  const param = (rawParam || '').trim();
  if (!param) return 'Parameter [CEK_CUACA] kosong. Gunakan format [CEK_CUACA: -6.2, 106.8] atau [CEK_CUACA: Jakarta].';
  console.log(`[ToolExecutor] Cek cuaca: ${param}`);

  try {
    let lat: number | null = null;
    let lon: number | null = null;
    let placeLabel = param;

    const coordMatch = param.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (coordMatch) {
      lat = parseFloat(coordMatch[1]);
      lon = parseFloat(coordMatch[2]);
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return `Koordinat tidak valid: "${param}".`;
      }
      try {
        const rev = await fetchJson(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=id`
        );
        const city = rev.city || rev.locality || rev.principalSubdivision || '';
        const country = rev.countryName || '';
        if (city || country) placeLabel = [city, country].filter(Boolean).join(', ');
        else placeLabel = `${lat}, ${lon}`;
      } catch { placeLabel = `${lat}, ${lon}`; }
    } else {
      const geo = await fetchJson(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(param)}&count=1&language=id&format=json`
      );
      if (!geo.results || geo.results.length === 0) {
        return `Lokasi "${param}" tidak ditemukan. Coba nama kota yang lebih spesifik (contoh: Jakarta, Surabaya, Bandung).`;
      }
      const r = geo.results[0];
      lat = r.latitude; lon = r.longitude;
      placeLabel = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
    }

    const wx = await fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3`
    );
    const cur = wx.current;
    const daily = wx.daily;
    const nowDesc = wmoToId(cur.weather_code);

    let out = `Cuaca ${placeLabel} (${lat?.toFixed(3)}, ${lon?.toFixed(3)}) — ${wx.timezone || ''}:\n`;
    out += `Saat ini: ${nowDesc}, ${cur.temperature_2m}°C (terasa ${cur.apparent_temperature}°C), kelembapan ${cur.relative_humidity_2m}%, angin ${cur.wind_speed_10m} km/jam.\n`;
    if (daily?.time) {
      out += `Prakiraan 3 hari:\n`;
      for (let i = 0; i < Math.min(3, daily.time.length); i++) {
        out += `- ${daily.time[i]}: ${wmoToId(daily.weather_code[i])}, ${daily.temperature_2m_min[i]}–${daily.temperature_2m_max[i]}°C, peluang hujan ${daily.precipitation_probability_max?.[i] ?? '-'}%\n`;
      }
    }
    out += `Sumber: Open-Meteo.`;
    return out;
  } catch (e: any) {
    return `Gagal mengecek cuaca untuk "${param}": ${e.message}`;
  }
}

function searchWeb(query: string, maxResults = 30): Promise<{ text: string; sources: SearchSource[] }> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'web_search.js');
    const queryWithQuota = query.includes('|') ? query : `${query} | ${maxResults}`;
    console.log(`[ToolExecutor] Web search (up to ${maxResults} sources): ${queryWithQuota}`);

    execFile('node', [scriptPath, queryWithQuota], {
      timeout: 28000,
      maxBuffer: 15 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (!err && stdout) {
        try {
          const json = JSON.parse(stdout.trim());
          if (json.text) {
            return resolve({
              text: json.text,
              sources: Array.isArray(json.sources) ? json.sources : [],
            });
          }
        } catch (e) {}
      }
      console.warn(`[ToolExecutor] web_search runner failed for "${query}":`, err?.message || stderr);
      resolve({
        text: `Tidak ada hasil relevan dari internet untuk "${query}".`,
        sources: [],
      });
    });
  });
}

/**
 * [steering 23 Okt 2026] Deteksi otomasi browser rakitan: agen DILARANG menulis
 * skrip Playwright/Puppeteer/Selenium/solver Turnstile sendiri. Interaksi web
 * wajib lewat tag [BROWSER] (browser resmi aplikasi); membaca halaman lewat
 * [BUKA_WEB]/[AMBIL_HALAMAN]. Deteksi berbasis teks perintah/kode.
 */
function isHandRolledBrowserCode(text: string): boolean {
  if (!text) return false;
  const lib = /(playwright|puppeteer|selenium|webdriver|patchright)/i.test(text);
  const act = /(launch|chromium|new_page|page\.goto|driver\.|turnstile|captcha)/i.test(text);
  return lib && act;
}

function runBashCommand(
  command: string,
  jobCtx?: { conversationId?: string; userId?: string; temporary?: boolean }
): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    if (!command || typeof command !== 'string') {
      return resolve({ success: false, output: '', error: 'Empty bash command.' });
    }
    // [steering 23 Okt 2026] Tolak otomasi browser rakitan (skrip Playwright/
    // Selenium/solver Turnstile buatan agen sendiri, termasuk file bernama
    // *turnstile*/*captcha*). Kemudikan ke alat resmi: [BROWSER] / [AMBIL_HALAMAN].
    if (
      isHandRolledBrowserCode(command) ||
      /(turnstile|captcha)[\w\-]*\.(py|js|sh)\b/i.test(command)
    ) {
      return resolve({
        success: false,
        output: '',
        error: 'DITOLAK: perintah ini membuat/menjalankan otomasi browser rakitan (Playwright/Selenium/skrip solver Turnstile). Untuk interaksi web (login, klik, formulir, Turnstile) gunakan tag [BROWSER: buka <url>] — browser resmi aplikasi yang menyelesaikan Turnstile otomatis dan punya jalur bypass proxy. Untuk sekadar membaca isi halaman gunakan [BUKA_WEB] atau [AMBIL_HALAMAN]. Token Turnstile TIDAK bisa diambil dari HTML/DOM; jangan menulis skrip solver sendiri.',
      });
    }

    // [bashfix 23 Okt 2026] Guard perintah yang me-restart/men-deploy ai-chat:
    // proses ini SENDIRI yang melayani stream chat, jadi eksekusi langsung akan
    // membunuh stream di tengah jalan ("terputus"). Perintah semacam itu
    // dijalankan terpisah (setsid + jeda 3 detik) supaya respons sempat terkirim.
    const isDirectBuild = /npm\s+run\s+build\b/i.test(command) && /ai-chat/i.test(command) && !/deploy/i.test(command);
    if (isDirectBuild) {
      return resolve({
        success: false,
        output: '',
        error: 'DITOLAK: "npm run build" langsung merusak folder .next yang sedang dipakai server ai-chat. Gunakan "npm run deploy" — perintah itu otomatis dijalankan terpisah (detached) oleh sistem.',
      });
    }
    const isSelfRestart =
      /pm2\s+(restart|reload|startOrReload)\b[^;&|]*\b(ai-chat|all)\b/i.test(command) ||
      /npm\s+run\s+deploy\b/i.test(command) ||
      /scripts\/deploy\.sh\b/i.test(command);

    // Restart provider LLM (9router/antigravity) SAMA-SAMA memutus stream:
    // koneksi SSE sedang memakai soket ke provider itu.
    const isProviderRestart =
      /\b(pm2|systemctl)\s+(restart|reload|stop|start|startOrReload|try-restart)\b[^;&|]*\b(9router|antigravity-proxy|20128)\b/i.test(
        command
      );

    if (isSelfRestart || isProviderRestart) {
      const kind = isSelfRestart ? 'self-restart-deploy' : 'provider-restart';
      const what = isSelfRestart ? 'ai-chat/deploy' : 'provider model (9router/antigravity)';

      // Jalur utama: jadwal via detached-jobs supaya HASIL deploy dilaporkan
      // kembali ke percakapan setelah restart (fallback di bawah = perilaku lama).
      const scheduled = scheduleDetachedJob(command, jobCtx || {}, kind);
      if (scheduled.scheduled) {
        return resolve({
          success: true,
          output:
            `[DIJADWALKAN +${scheduled.deferSec}s | job ${scheduled.jobId}] Perintah ini me-restart ${what}, yang melayani stream ini. ` +
            `Perintah sudah dijadwalkan berjalan ${scheduled.deferSec} detik lagi agar jawaban sempat terkirim. ` +
            `JANGAN menunggu dan JANGAN mengulang perintah. Tulis jawaban akhir sekarang dan beri tahu pengguna ` +
            `bahwa layanan akan restart otomatis dalam ±${scheduled.deferSec} detik. Hasil deploy akan dilaporkan ` +
            `otomatis ke percakapan ini setelah server hidup lagi.`,
        });
      }

      try {
        const deferSec = Math.min(
          Math.max(Number(process.env.DEFER_RESTART_SEC || 30) || 30, 10),
          180
        );
        const logPath = '/root/ai-chat/detached-restart.log';
        const scriptPath = `/tmp/aichat-detached-${Date.now()}.sh`;
        fs.writeFileSync(scriptPath, `#!/bin/bash\nsleep ${deferSec}\n${command}\n`);
        exec(`setsid bash ${scriptPath} >> ${logPath} 2>&1 < /dev/null &`, { shell: '/bin/bash' }, () => {});
        return resolve({
          success: true,
          output:
            `[DIJADWALKAN +${deferSec}s] Perintah ini me-restart ${what}, yang melayani stream ini. ` +
            `Perintah sudah dijadwalkan berjalan ${deferSec} detik lagi agar jawaban sempat terkirim. ` +
            `JANGAN menunggu dan JANGAN mengulang perintah. Tulis jawaban akhir sekarang dan beri tahu pengguna ` +
            `bahwa layanan akan restart otomatis dalam ±${deferSec} detik (boleh dilanjutkan dengan pesan baru setelah itu).`,
        });
      } catch (e: any) {
        return resolve({ success: false, output: '', error: `Gagal menjadwalkan perintah detached: ${e?.message || e}` });
      }
    }

    exec(command, {
      cwd: '/root',
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
      shell: '/bin/bash',
      env: { ...process.env, PAGER: 'cat', TERM: 'dumb' },
    }, (err, stdout, stderr) => {
      const outStr = (stdout || '').trim();
      const errStr = (stderr || '').trim();
      if (err) {
        return resolve({ success: false, output: outStr, error: errStr || err.message });
      }
      return resolve({ success: true, output: outStr || '(command completed without output)', error: errStr });
    });
  });
}

function runSubtitleTool(url: string): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    execFile('/root/getsub/getsub.sh', [url], {
      cwd: '/root/getsub',
      timeout: 600000,
      maxBuffer: 15 * 1024 * 1024,
      env: { ...process.env, PAGER: 'cat', TERM: 'dumb' },
    }, (err, stdout, stderr) => {
      const outStr = (stdout || '').trim();
      const errStr = (stderr || '').trim();
      if (err) {
        return resolve({ success: false, output: outStr, error: errStr || err.message });
      }
      return resolve({ success: true, output: outStr, error: errStr });
    });
  });
}

async function fallbackFetch(url: string): Promise<{ text: string; title?: string; url?: string }> {
  try {
    console.log(`[ToolExecutor] Browsing via HTTP fetch fallback: ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const html = await res.text();
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : url;
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 30) {
        return { text: truncateOutput(text, 22000), title, url };
      }
    }
  } catch (e: any) {
    console.warn(`[ToolExecutor] Direct fetch failed for ${url}: ${e.message}`);
  }

  // Coba lewat WireGuard SOCKS5 proxy lokal (127.0.0.1:40001) bila aktif
  try {
    const wgHtml = await new Promise<string>((resolveWg) => {
      execFile('curl', ['-s', '--max-time', '20', '-x', 'socks5h://127.0.0.1:40001',
        '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-L', url], { timeout: 25000, maxBuffer: 15 * 1024 * 1024 }, (e, out) => resolveWg(out || ''));
    });
    if (wgHtml && wgHtml.length > 200 && !/melakukan verifikasi keamanan|just a moment|attention required|checking your browser/i.test(wgHtml.slice(0, 2000))) {
      const wTitleMatch = wgHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const wTitle = wTitleMatch ? wTitleMatch[1].replace(/\s+/g, ' ').trim() : url;
      const wText = wgHtml
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (wText.length > 30) {
        console.log(`[ToolExecutor] WireGuard fetch berhasil untuk ${url}`);
        return { text: truncateOutput(wText, 22000), title: wTitle, url };
      }
    }
  } catch (e: any) {}

  // Coba lewat WARP proxy lokal (egress Cloudflare 127.0.0.1:40000) via curl
  try {
    console.log(`[ToolExecutor] Mencoba fetch via WARP proxy untuk ${url}...`);
    const warpHtml = await new Promise<string>((resolveWarp) => {
      execFile('curl', ['-s', '--max-time', '30', '-x', 'socks5h://127.0.0.1:40000',
        '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-L', url], { timeout: 40000, maxBuffer: 15 * 1024 * 1024 }, (e, out) => resolveWarp(out || ''));
    });
    if (warpHtml && warpHtml.length > 200 && !/melakukan verifikasi keamanan|just a moment|attention required|checking your browser/i.test(warpHtml.slice(0, 2000))) {
      const wTitleMatch = warpHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const wTitle = wTitleMatch ? wTitleMatch[1].replace(/\s+/g, ' ').trim() : url;
      const wText = warpHtml
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (wText.length > 30) {
        console.log(`[ToolExecutor] WARP fetch berhasil untuk ${url}`);
        return { text: truncateOutput(wText, 22000), title: wTitle, url };
      }
    }
  } catch (e: any) {
    console.warn(`[ToolExecutor] WARP fetch gagal untuk ${url}: ${e.message}`);
  }

  // Coba lewat Webshare Rotating Proxy bila Cloudflare memblokir IP Datacenter/WARP
  try {
    const wsHtml = await new Promise<string>((resolveWs) => {
      execFile('curl', ['-s', '--max-time', '25', '-x', 'http://hqltotas-rotate:pn71iletntbv@p.webshare.io:80',
        '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-L', url], { timeout: 30000, maxBuffer: 15 * 1024 * 1024 }, (e, out) => resolveWs(out || ''));
    });
    if (wsHtml && wsHtml.length > 200 && !/melakukan verifikasi keamanan|just a moment|attention required|checking your browser/i.test(wsHtml.slice(0, 2000))) {
      const wsTitleMatch = wsHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const wsTitle = wsTitleMatch ? wsTitleMatch[1].replace(/\s+/g, ' ').trim() : url;
      const wsText = wsHtml
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (wsText.length > 30) {
        console.log(`[ToolExecutor] Webshare fetch berhasil untuk ${url}`);
        return { text: truncateOutput(wsText, 22000), title: wsTitle, url };
      }
    }
  } catch (e: any) {}

  // Coba Jina Reader jika direct fetch diblokir Cloudflare / 403
  try {
    console.log(`[ToolExecutor] Mencoba Jina Reader untuk ${url}...`);
    const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
      headers: { 'Accept': 'text/plain' },
      signal: AbortSignal.timeout(45000),
    });
    if (jinaRes.ok) {
      const jinaText = await jinaRes.text();
      if (jinaText.length > 50 && !jinaText.includes('AbuseAlleviationError')) {
        const titleMatch = jinaText.match(/^Title:\s*(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : url;
        return { text: truncateOutput(jinaText, 25000), title, url };
      }
    }
  } catch (err: any) {
    console.warn(`[ToolExecutor] Jina Reader fallback error: ${err.message}`);
  }

  return { text: `Gagal membaca URL ${url}: akses diblokir atau halaman tidak merespons.`, url };
}

async function browseUrl(
  url: string,
  takeScreenshot = false
): Promise<{
  text: string;
  title?: string;
  url?: string;
  screenshotPath?: string | null;
  screenshotUrl?: string | null;
  videoUrl?: string | null;
  embedUrl?: string | null;
}> {
  if (isTikTokUrl(url)) {
    const tt = await extractTikTokMedia(url);
    if (tt && tt.success) {
      return {
        text: tt.text,
        title: tt.title,
        url: tt.url,
        screenshotPath: tt.screenshotPath || null,
        screenshotUrl: tt.screenshotUrl || null,
        videoUrl: tt.videoUrl || null,
        embedUrl: tt.embedUrl || null,
      };
    }
  }

  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'chrome_browser.js');
    console.log(`[ToolExecutor] Membuka URL via Google Chrome Headless (/usr/bin/google-chrome): ${url}`);

    execFile('node', [scriptPath, url, String(takeScreenshot)], {
      timeout: 30000,
      maxBuffer: 15 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (!err && stdout) {
        try {
          const json = JSON.parse(stdout.trim());
          if (json.success && json.text) {
            // Halaman challenge Cloudflare punya teks tapi BUKAN konten asli —
            // jangan dianggap sukses; lempar ke rantai ekstraksi (direct -> WARP -> Jina).
            const probe = `${json.title || ''}\n${json.text.slice(0, 600)}`;
            if (/melakukan verifikasi keamanan|verifikasi bahwa anda adalah manusia|just a moment|tunggu sebentar|attention required|are you a robot|challenge-platform|sedang memeriksa browser/i.test(probe)) {
              console.warn(`[ToolExecutor] Halaman challenge terdeteksi untuk ${url}, fallback ke ekstraksi.`);
              return fallbackFetch(url).then((r) => resolve({ ...r, embedUrl: getSmartEmbedUrl(url) }));
            }
            const titleStr = json.title ? `[JUDUL HALAMAN: ${json.title}]\n` : '';
            const urlStr = json.url ? `[URL AKTIF: ${json.url}]\n` : '';
            return resolve({
              text: `${titleStr}${urlStr}\n${truncateOutput(json.text, 25000)}`,
              title: json.title || url,
              url: json.url || url,
              screenshotPath: json.screenshotPath || null,
              embedUrl: getSmartEmbedUrl(json.url || url),
            });
          }
        } catch (e) {}
      }
      console.warn(`[ToolExecutor] Chrome runner failed or empty, fallback to fetch for ${url}:`, err?.message || stderr);
      fallbackFetch(url).then((r) => resolve({ ...r, embedUrl: getSmartEmbedUrl(url) }));
    });
  });
}

export function getAvailableSkillsCatalog(): string[] {
  const dirs = [
    '/root/ai-chat/skills',
  ];
  const skills: string[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        let skillName = '';
        let skillFile = '';

        if (entry.isFile() && entry.name.endsWith('.md')) {
          skillName = entry.name.replace('.md', '');
          skillFile = path.join(dir, entry.name);
        } else if (entry.isDirectory()) {
          const nested = path.join(dir, entry.name, 'SKILL.md');
          if (fs.existsSync(nested)) {
            skillName = entry.name;
            skillFile = nested;
          }
        }

        if (skillName && skillFile && !seen.has(skillName)) {
          seen.add(skillName);
          try {
            const content = fs.readFileSync(skillFile, 'utf8');
            let desc = '';
            const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (fmMatch) {
              const descMatch = fmMatch[1].match(/description:\s*(?:["']?)([\s\S]*?)(?:["']?)(?:\r?\n[a-zA-Z0-9_-]+:|$)/);
              if (descMatch) {
                desc = descMatch[1].replace(/\n/g, ' ').replace(/^[>|\s"']+|["'\s]+$/g, '').trim();
              }
            }
            if (!desc) {
              const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
              const title = (lines[0] || '').replace(/^#+\s*/, '');
              const sub = (lines[1] || '').replace(/^[>#\s*]+/, '');
              desc = (title + (sub ? ' — ' + sub : '')).trim();
            }
            skills.push(`  - [${skillName}]: ${desc.substring(0, 130)}`);
          } catch (e) {}
        }
      }
    } catch (e) {}
  }
  return skills;
}

export function installSkill(skillName: string, markdownContent: string): { success: boolean; message: string; path?: string } {
  try {
    const cleanName = skillName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!cleanName) return { success: false, message: 'Nama skill tidak valid.' };

    const targetDir = path.join('/root/ai-chat/skills', cleanName);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let finalContent = markdownContent.trim();
    if (!finalContent.startsWith('---')) {
      finalContent = `---\nname: ${cleanName}\ndescription: Custom skill diinstal via Web AI chat\n---\n\n${finalContent}`;
    }

    const targetFile = path.join(targetDir, 'SKILL.md');
    fs.writeFileSync(targetFile, finalContent, 'utf8');
    console.log(`[ToolExecutor] Skill ${cleanName} berhasil diinstal di ${targetFile}`);
    return { success: true, message: `Skill "${cleanName}" berhasil diinstal ke ${targetFile}.`, path: targetFile };
  } catch (err: any) {
    return { success: false, message: `Gagal instal skill: ${err.message}` };
  }
}

const SKILL_CHUNK_SIZE = 6500;

// Pecah isi skill menjadi halaman yang berakhir rapi di batas baris (tidak membelah kata/kode).
function paginateSkill(content: string, size: number): string[] {
  const pages: string[] = [];
  let buf: string[] = [];
  let len = 0;
  for (const line of content.split('\n')) {
    const add = line.length + 1;
    if (len > 0 && len + add > size) {
      pages.push(buf.join('\n'));
      buf = [];
      len = 0;
    }
    buf.push(line);
    len += add;
  }
  if (buf.length > 0) pages.push(buf.join('\n'));
  return pages.length > 0 ? pages : [''];
}

function readSkill(skillName: string, part = 1): string {
  const searchPaths = [
    path.join('/root/ai-chat/skills', `${skillName}.md`),
    path.join('/root/ai-chat/skills', skillName, 'SKILL.md'),
    path.join('/root/.codex/skills', skillName, 'SKILL.md'),
    path.join('/root/.claude/skills', skillName, 'SKILL.md'),
  ];
  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      const pages = paginateSkill(content, SKILL_CHUNK_SIZE);
      const total = pages.length;
      const current = Math.min(Math.max(1, Math.trunc(part) || 1), total);
      const header = `[SKILL: ${skillName} | bagian ${current}/${total} | total ${content.length} karakter | file: ${p}]`;
      const footer = current < total
        ? `\n\n---\n[Masih ada ${total - current} bagian lagi. Untuk lanjut membaca, panggil: [BACA_SKILL: ${skillName} ${current + 1}]]`
        : `\n\n---\n[SKILL SELESAI: seluruh isi skill "${skillName}" sudah dibaca.]`;
      return `${header}\n${pages[current - 1]}${footer}`;
    }
  }
  return `Skill "${skillName}" tidak ditemukan dalam katalog skills. Gunakan nama skill yang tertera pada katalog sistem.`;
}

function stripCodeBlocks(text: string): string {
  if (!text) return '';
  // Strip multi-line code blocks ``` ... ```
  let clean = text.replace(/```[\s\S]*?```/g, '');
  // Strip inline code ` ... `
  clean = clean.replace(/`[^`\n]+`/g, '');
  return clean;
}

/**
 * Stage any local server files referenced in [KIRIM_FILE], [KIRIM_DOKUMEN], [KIRIM_VIDEO], [KIRIM_AUDIO], [KIRIM_GAMBAR]
 * into /root/ai-chat/uploads/shared/ so they can be downloaded via /api/browser-shots/<filename>.
 * Also rewrites the tag paths to their canonical staged path so fuzzy-matched or sanitized filenames render without 404.
 */
export function stageMediaTagsInReply(text: string): { stagedPaths: string[]; rewrittenText: string } {
  if (!text) return { stagedPaths: [], rewrittenText: '' };
  const tags = parseToolTags(text, MEDIA_TAG_NAMES);
  if (tags.length === 0) return { stagedPaths: [], rewrittenText: text };

  const stagedPaths: string[] = [];
  let out = '';
  let last = 0;

  for (const tag of tags) {
    out += text.substring(last, tag.start);
    const parts = tag.param.split('|');
    const rawTarget = (parts[0] || '').trim();
    const captionPart = parts.slice(1).join('|').trim();

    if (rawTarget && !/^https?:\/\//i.test(rawTarget)) {
      const staged = stageExistingFile(rawTarget);
      if (staged.success && staged.localPath) {
        if (!stagedPaths.includes(staged.localPath)) {
          stagedPaths.push(staged.localPath);
        }
        const replacementCaption = captionPart ? ` | ${captionPart}` : '';
        out += `[${tag.type}: ${staged.localPath}${replacementCaption}]`;
        last = tag.end;
        continue;
      }
    }
    out += text.substring(tag.start, tag.end);
    last = tag.end;
  }
  out += text.substring(last);
  return { stagedPaths, rewrittenText: out };
}

/**
 * Detect if the AI response contains any actionable tool tags outside code blocks.
 */
export function hasToolTags(text: string, isAdmin = false): boolean {
  const clean = stripCodeBlocks(text);
  // Tag tanpa parameter boleh ditulis tanpa titik dua, mis. [BACA_SESI_KERJA].
  if (/\[BACA_SESI_KERJA\s*\]/i.test(clean)) return true;
  if (isAdmin) {
    return /\[(?:CARI_WEB|RUN_BASH|BUKA_WEB|SCREENSHOT_WEB|CEK_CUACA|BACA_SKILL|INSTALL_SKILL|RUN_PYTHON|RINGKAS_YOUTUBE|BUAT_PDF|BUAT_FILE|BACA_OCR|AMBIL_SUBTITEL|AMBIL_HALAMAN|BROWSER|CATAT_PELAJARAN|CEK_KESEHATAN_PROYEK|BACA_SESI_KERJA|BACA_FILE|EDIT_FILE|MCP|CLI):/i.test(clean);
  }
  return /\[(?:CARI_WEB|BUKA_WEB|SCREENSHOT_WEB|CEK_CUACA|BUAT_FILE|BUAT_PDF|CATAT_PELAJARAN|BACA_SESI_KERJA):/i.test(clean);
}

export interface ExecuteToolOptions {
  isAdmin?: boolean;
  userId?: string;
  /** ID percakapan — dipakai sebagai nama sesi browser agar sesi tidak tercampur. */
  browserSession?: string;
  /** ID percakapan untuk memori kerja lintas sesi. */
  conversationId?: string;
  /** Percakapan sementara: hasil job detached tidak bisa dilaporkan, jatuh ke perilaku lama. */
  temporary?: boolean;
  /** True hanya bila pesan pengguna terakhir memang menyetujui pengambilan OTP. */
  otpApproved?: boolean;
  /** True hanya bila pengguna terakhir menyetujui pengambilan transkrip/audio video (hak/izin). */
  mediaApproved?: boolean;
  /** Kuota sumber pencarian web (10-50, default 30) */
  searchQuota?: number;
  /** Cache perintah bash yang sudah dijalankan pada request ini (anti loop). */
  executedCommands?: Map<string, string>;
  /** Cache pencarian per request: mencegah query duplikat/parafrase antar giliran. */
  executedSearches?: Map<string, { query: string; output: string; sources?: SearchSource[] }>;
  /** Skill yang sudah dibaca pada request ini (anti baca ulang). */
  loadedSkills?: Set<string>;
}

function extractDomainFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, '');
  } catch {
    return 'web';
  }
}

const SEARCH_STOP = new Set([
  'the','a','an','of','in','on','for','and','to','with','about','dan','di','ke','dari','untuk',
  'yang','ini','itu','pada','dengan','tentang','adalah','apa','bagaimana',
  'hari','terbaru','terkini','update','latest','today','news','kabar','berita',
]);

/** Stemming ringan agar 'hacked'/'hack' dan 'investigation'/'investigate' dianggap sama. */
function stemWord(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function searchTokens(q: string): string[] {
  return (q || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !SEARCH_STOP.has(w))
    .map(stemWord);
}

function searchKeyOf(tokens: string[]): string {
  return [...tokens].sort().join(' ');
}

/** Anggap duplikat bila himpunan kata identik atau salah satu himpunan bagian dari yang lain. */
export function findDuplicateSearch(
  cache: Map<string, { query: string; output: string; sources?: SearchSource[] }> | undefined,
  tokens: string[]
): { query: string; output: string; sources?: SearchSource[] } | null {
  if (!cache || cache.size === 0 || tokens.length === 0) return null;
  const key = searchKeyOf(tokens);
  const exact = cache.get(key);
  if (exact) return exact;
  const set = new Set(tokens);
  for (const entry of Array.from(cache.values())) {
    const other = new Set(searchTokens(entry.query));
    if (other.size === 0) continue;
    const small = set.size <= other.size ? set : other;
    const big = set.size <= other.size ? other : set;
    let subset = true;
    small.forEach((w) => {
      if (!big.has(w)) subset = false;
    });
    if (subset) {
      // Beda hanya tahun (mis. "... konflik" vs "... konflik 2026") = penyempitan
      // yang sah, bukan duplikat; biarkan dijalankan.
      const diff = Array.from(big).filter((w) => !small.has(w));
      if (diff.length > 0 && diff.every((w) => /^20\d\d$/.test(w))) continue;
      return entry;
    }
    // Kemiripan topik: irisan kata / himpunan terkecil >= 0.6 dianggap duplikat.
    let shared = 0;
    small.forEach((w) => {
      if (big.has(w)) shared++;
    });
    if (shared / small.size >= 0.5) return entry;
  }
  return null;
}

export async function executeTools(aiReply: string, options?: ExecuteToolOptions): Promise<ToolResult> {
  const isAdmin = Boolean(options?.isAdmin);
  const searchQuota = Math.min(Math.max(10, options?.searchQuota || 30), 50);
  const cleanReply = stripCodeBlocks(aiReply);
  const observationParts: string[] = [];
  const collectedSources: SearchSource[] = [];
  let lastCommand: string | undefined;
  let lastOutput: string | undefined;
  let lastUrl: string | undefined;
  let lastScreenshotUrl: string | undefined;
  let lastVideoUrl: string | undefined;
  let lastEmbedUrl: string | undefined;
  let hasAction = false;
  const collectedStagedPaths: string[] = [];
  const collectedSteps: ToolStep[] = [];

  // 1. [BACA_SKILL: name] - Admin Only
  if (isAdmin) {
    const skillRegex = /\[BACA_SKILL:\s*([a-zA-Z0-9_-]+)(?:\s+(\d+))?\]/gi;
    const skillMatches = Array.from(cleanReply.matchAll(skillRegex));
    for (const m of skillMatches) {
      const skillName = m[1].trim();
      const part = m[2] ? parseInt(m[2], 10) : 1;
      if (skillName) {
        hasAction = true;
        const skillKey = `${skillName}:${part}`;
        if (options?.loadedSkills?.has(skillKey)) {
          console.log(`[ToolExecutor] Skip re-reading skill: ${skillName}${part > 1 ? ` (bagian ${part})` : ''}`);
          observationParts.push(
            `[SKILL SUDAH DIBACA: ${skillName}${part > 1 ? ` (bagian ${part})` : ''}] Isi skill ini sudah tersedia di konteks percakapan sebelumnya. JANGAN baca ulang. Gunakan isi yang sudah ada.`
          );
          continue;
        }
        console.log(`[ToolExecutor] Reading skill: ${skillName}${part > 1 ? ` (bagian ${part})` : ''}`);
        const content = readSkill(skillName, part);
        lastOutput = content;
        options?.loadedSkills?.add(skillKey);
        observationParts.push(`[SKILL CONTENT: ${skillName}]:\n${content}`);
      }
    }
  }

  // 1b. [BACA_SESI_KERJA] — memori kerja lintas sesi (read-only, per pengguna)
  const workSessionMatches = parseToolTags(cleanReply, 'BACA_SESI_KERJA').slice(0, 3);
  const bareWorkSession = /\[BACA_SESI_KERJA\s*\]/i.test(cleanReply);
  const workRequests = bareWorkSession
    ? [{ param: '' }, ...workSessionMatches].slice(0, 3)
    : workSessionMatches;
  for (const match of workRequests) {
    hasAction = true;
    if (!options?.userId) {
      observationParts.push('[SESI KERJA] Tidak ada pengguna aktif; memori kerja tidak dapat dibaca.');
      continue;
    }
    try {
      const report = WorkSessionRepository.buildReport(
        options.userId,
        options.conversationId || options.browserSession,
        match.param
      );
      lastOutput = report;
      observationParts.push(`[SESI KERJA LINTAS SESI]:\n${report}`);
    } catch (err) {
      console.warn('[ToolExecutor] BACA_SESI_KERJA gagal:', err);
      observationParts.push('[SESI KERJA] Gagal membaca memori kerja.');
    }
  }

  // 2. [CARI_WEB: query] (Supports up to 10 queries per hop, each up to 50 sources)
  const searchRegex = /\[CARI_WEB:\s*([^\]\n\r]+)\]/gi;
  const searchMatches = Array.from(cleanReply.matchAll(searchRegex)).slice(0, 6);
  const searchQueries: string[] = [];
  for (const m of searchMatches) {
    const q = m[1].trim();
    if (q && !/kata kunci|your query|example|contoh|placeholder/i.test(q) && !searchQueries.includes(q)) {
      searchQueries.push(q);
    }
  }
  const maxSearchPerTurn = Math.max(1, Math.min(Number(process.env.MAX_SEARCH_PER_TURN || 2) || 2, 5));
  if (searchQueries.length > maxSearchPerTurn) {
    console.log(`[ToolExecutor] Batasi ${searchQueries.length} query -> ${maxSearchPerTurn} (MAX_SEARCH_PER_TURN)`);
    searchQueries.length = maxSearchPerTurn;
  }
  if (searchQueries.length > 0) {
    hasAction = true;
    console.log(`[ToolExecutor] Running web searches (quota ${searchQuota}): ${searchQueries.join(' | ')}`);
    for (const q of searchQueries) {
      const qStartMs = Date.now();
      const querySources: SearchSource[] = [];

      const dupSearch = findDuplicateSearch(options?.executedSearches, searchTokens(q));
      if (dupSearch) {
        console.log(`[ToolExecutor] Lewati pencarian duplikat: ${q} (sudah: ${dupSearch.query})`);
        observationParts.push(
          `[WEB SEARCH DIPAKAI ULANG: "${q}"] Query ini duplikat dari "${dupSearch.query}" yang sudah dijalankan pada giliran sebelumnya. JANGAN mengulang; gunakan hasil berikut.\n${truncateOutput(dupSearch.output || '', 6000)}`
        );
        collectedSteps.push({
          param: q,
          ok: true,
          durationMs: 0,
          output: dupSearch.output || '(hasil dipakai ulang)',
          sources: dupSearch.sources,
        });
        continue;
      }

      try {
        const res = await searchWeb(q, searchQuota);
        if (res.sources && res.sources.length > 0) {
          for (const s of res.sources) {
            if (!collectedSources.some((existing) => existing.url === s.url)) {
              const stamped = { ...s, index: collectedSources.length + 1 };
              collectedSources.push(stamped);
              querySources.push(stamped);
            } else {
              const existing = collectedSources.find((e) => e.url === s.url);
              if (existing && !querySources.some((e) => e.url === s.url)) querySources.push(existing);
            }
          }
        }
        if (res.text && !res.text.includes('No relevant results')) {
          observationParts.push(`### [WEB SEARCH RESULTS (${res.sources.length} sumber): "${q}"]:\n${truncateOutput(res.text, 28000)}`);
        } else {
          observationParts.push(`[WEB SEARCH: "${q}"]: No relevant results found.`);
        }
        collectedSteps.push({
          param: q,
          ok: querySources.length > 0,
          durationMs: Date.now() - qStartMs,
          output: res.text || 'Tidak ada hasil relevan.',
          sources: querySources.length > 0 ? querySources : undefined,
        });
        options?.executedSearches?.set(searchKeyOf(searchTokens(q)), {
          query: q,
          output: res.text || '',
          sources: querySources.length > 0 ? querySources : undefined,
        });
      } catch (err: any) {
        observationParts.push(`[WEB SEARCH FAILED: "${q}"]: ${err.message}`);
        collectedSteps.push({
          param: q,
          ok: false,
          durationMs: Date.now() - qStartMs,
          output: `Error: ${err.message}`,
        });
      }
    }
  }

  // 3. [BUKA_WEB: url]
  const browseRegex = /\[BUKA_WEB:\s*(https?:\/\/[^\]\n\r]+)\]/gi;
  const browseMatches = Array.from(cleanReply.matchAll(browseRegex)).slice(0, 5);
  const visitedUrls = new Set<string>();
  for (const m of browseMatches) {
    const url = m[1].trim();
    if (url && !visitedUrls.has(url)) {
      visitedUrls.add(url);
      hasAction = true;
      lastUrl = url;
      console.log(`[ToolExecutor] Browsing URL via Google Chrome: ${url}`);
      const res = await browseUrl(url, true);
      if (res.screenshotUrl) {
        lastScreenshotUrl = res.screenshotUrl;
      } else if (res.screenshotPath) {
        lastScreenshotUrl = `/api/browser-shots/${encodeURIComponent(path.basename(res.screenshotPath))}`;
      }
      if (res.videoUrl) lastVideoUrl = res.videoUrl;
      if (res.embedUrl) lastEmbedUrl = res.embedUrl;
      const dom = extractDomainFromUrl(url);
      if (!collectedSources.some((s) => s.url === url)) {
        collectedSources.push({
          index: collectedSources.length + 1,
          title: res.title || url,
          url,
          sourceUrl: url,
          domain: dom,
          siteName: dom,
          favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(dom)}&sz=64`,
          snippet: res.text.substring(0, 240).replace(/\s+/g, ' '),
        });
      }
      lastOutput = res.text;
      observationParts.push(`[KONTEN BROWSER GOOGLE CHROME: ${url}]:\n${res.text}`);
    }
  }

  // 3b. [SCREENSHOT_WEB: url]
  const screenshotRegex = /\[SCREENSHOT_WEB:\s*(https?:\/\/[^\]\n\r]+)\]/gi;
  const screenshotMatches = Array.from(cleanReply.matchAll(screenshotRegex)).slice(0, 3);
  for (const m of screenshotMatches) {
    const url = m[1].trim();
    if (url && !visitedUrls.has(url)) {
      visitedUrls.add(url);
      hasAction = true;
      lastUrl = url;
      console.log(`[ToolExecutor] Capturing web screenshot: ${url}`);
      const res = await browseUrl(url, true);
      if (res.screenshotUrl) {
        lastScreenshotUrl = res.screenshotUrl;
      } else if (res.screenshotPath) {
        const fname = path.basename(res.screenshotPath);
        lastScreenshotUrl = `/api/browser-shots/${encodeURIComponent(fname)}`;
      }
      if (res.videoUrl) lastVideoUrl = res.videoUrl;
      if (res.embedUrl) lastEmbedUrl = res.embedUrl;
      const dom = extractDomainFromUrl(url);
      if (!collectedSources.some((s) => s.url === url)) {
        collectedSources.push({
          index: collectedSources.length + 1,
          title: res.title || url,
          url,
          sourceUrl: url,
          domain: dom,
          siteName: dom,
          favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(dom)}&sz=64`,
          snippet: res.text.substring(0, 240).replace(/\s+/g, ' '),
        });
      }
      const ssInfo = res.screenshotPath ? `Tangkapan layar tersimpan di: ${res.screenshotPath}\n` : '';
      lastOutput = `${ssInfo}${res.text}`;
      observationParts.push(`[SCREENSHOT & KONTEN CHROME: ${url}]:\n${ssInfo}${res.text}`);
    }
  }

  // 3c. [CEK_CUACA: lat,lon | nama kota]
  const weatherRegex = /\[CEK_CUACA:\s*([^\]\n\r]+)\]/gi;
  const weatherMatches = Array.from(cleanReply.matchAll(weatherRegex)).slice(0, 2);
  for (const m of weatherMatches) {
    const wParam = m[1].trim();
    if (wParam && !/contoh|example|placeholder/i.test(wParam)) {
      hasAction = true;
      console.log(`[ToolExecutor] Cek cuaca: ${wParam}`);
      try {
        const res = await checkWeather(wParam);
        lastOutput = res;
        observationParts.push(`[HASIL CUACA: "${wParam}"]:\n${truncateOutput(res, 5000)}`);
      } catch (err: any) {
        observationParts.push(`[CEK CUACA GAGAL: "${wParam}"]: ${err.message}`);
      }
    }
  }

  // 3d. [INSTALL_SKILL: nama_skill | isi_markdown_sop] - Admin Only
  if (isAdmin) {
    const installMatches = parseToolTags(aiReply).filter(t => t.type === 'INSTALL_SKILL').slice(0, 1);
    for (const m of installMatches) {
      const pipeIdx = m.param.indexOf('|');
      if (pipeIdx !== -1) {
        const name = m.param.substring(0, pipeIdx).trim();
        const sop = m.param.substring(pipeIdx + 1).trim();
        if (name && sop) {
          hasAction = true;
          const res = installSkill(name, sop);
          lastOutput = res.message;
          observationParts.push(`[INSTALASI SKILL]: ${res.message}`);
        }
      }
    }
  }

  // 4. [RUN_BASH: command] - Admin Only
  if (isAdmin) {
    const bashMatches = parseToolTags(aiReply).filter(t => t.type === 'RUN_BASH').slice(0, 5);
    for (const m of bashMatches) {
      const cmd = m.param;
      if (cmd) {
        hasAction = true;
        const cmdKey = cmd.replace(/\s+/g, ' ').trim();
        const cached = options?.executedCommands?.get(cmdKey);
        if (cached !== undefined) {
          console.log(`[ToolExecutor] Skip duplicate bash (admin): ${cmd.split('\n')[0]}`);
          observationParts.push(
            `[DUPLIKAT - TIDAK DIULANG]: Perintah yang sama persis sudah dijalankan pada langkah sebelumnya.\n${cached}\n\n\u{1F4A1} JANGAN mengulang perintah ini lagi. Gunakan hasil di atas atau lanjutkan ke langkah berikutnya.`
          );
          collectedSteps.push({ param: cmd, ok: true, durationMs: 0, output: cached });
          continue;
        }
        lastCommand = cmd;
        console.log(`[ToolExecutor] Running bash (admin): ${cmd.split('\n')[0]}`);
        const cmdStartMs = Date.now();
        const result = await runBashCommand(cmd, {
          conversationId: options?.conversationId,
          userId: options?.userId,
          temporary: options?.temporary,
        });
        lastOutput = result.success ? result.output : `Error: ${result.error}\n${result.output}`;
        let observation: string;
        if (result.success) {
          observation = `[BASH OUTPUT: ${cmd.substring(0, 140)}]:\n${truncateOutput(result.output, 12000)}`;

          // Auto-detect media hasil unduhan / pemrosesan bash (JSON ok atau file path media)
          try {
            let bashMediaInfo: { path?: string; paths?: string[]; type?: string } | null = null;
            const lines = (result.output || '').trim().split('\n');
            for (let i = lines.length - 1; i >= 0; i--) {
              const line = lines[i].trim();
              if (line.startsWith('{') && line.endsWith('}')) {
                try {
                  const parsed = JSON.parse(line);
                  if (parsed && (parsed.path || parsed.paths)) {
                    bashMediaInfo = parsed;
                    break;
                  }
                } catch {}
              }
            }

            const isCreatorCmd = /(yt-dlp|ffmpeg|download_instagram|download_tiktok|instagram_engine|tiktok_engine|\bcp\b|\bmv\b|\bcurl\b|\bwget\b|python3)/i.test(cmd);
            const isPassiveListCmd = /^\s*(ls|find|grep|cat|sed|head|tail|sqlite3|stat|file|df|free|ps|pm2)\b/i.test(cmd.trim()) && !isCreatorCmd;

            if (!bashMediaInfo && !isPassiveListCmd) {
              const candidateFiles: { path: string; mtimeMs: number }[] = [];
              const seenCandidate = new Set<string>();

              // 1. Cek berkas yang baru dibuat/diubah di /root/ai-chat/uploads/shared selama perintah berjalan
              const sharedDir = '/root/ai-chat/uploads/shared';
              if (fs.existsSync(sharedDir)) {
                try {
                  for (const name of fs.readdirSync(sharedDir)) {
                    const full = path.join(sharedDir, name);
                    const st = fs.statSync(full);
                    if (st.isFile() && Math.max(st.mtimeMs, st.ctimeMs) >= cmdStartMs - 3000) {
                      seenCandidate.add(full);
                      candidateFiles.push({ path: full, mtimeMs: st.mtimeMs });
                    }
                  }
                } catch {}
              }

              // 2. Pindai SEMUA path media di output bash (global regex, urutkan dari mtime terbaru)
              const pathRe = /((?:\/root|\/tmp)\/[^\s"'<>|`]+?\.(?:mp4|webm|mov|mkv|jpg|jpeg|png|webp|mp3|m4a|wav|ogg|flac|pdf|xlsx|docx))/gi;
              let pm: RegExpExecArray | null;
              while ((pm = pathRe.exec(result.output || '')) !== null) {
                const candidatePath = pm[1].replace(/[.,;)]+$/, '');
                if (seenCandidate.has(candidatePath)) continue;
                if (fs.existsSync(candidatePath)) {
                  try {
                    const st = fs.statSync(candidatePath);
                    if (st.isFile()) {
                      const ageMs = Date.now() - Math.max(st.mtimeMs, st.ctimeMs);
                      if (isCreatorCmd || ageMs < 2 * 60 * 1000) {
                        seenCandidate.add(candidatePath);
                        candidateFiles.push({ path: candidatePath, mtimeMs: st.mtimeMs });
                      }
                    }
                  } catch {}
                }
              }

              if (candidateFiles.length > 0) {
                candidateFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
                bashMediaInfo = { path: candidateFiles[0].path };
              }
            }

            if (bashMediaInfo) {
              const allPaths: string[] = [];
              if (bashMediaInfo.path) allPaths.push(bashMediaInfo.path);
              if (Array.isArray(bashMediaInfo.paths)) {
                for (const p of bashMediaInfo.paths) {
                  if (p && !allPaths.includes(p)) allPaths.push(p);
                }
              }

              let mainStagedUrl: string | undefined;
              let mainStagedPath: string | undefined;
              const stagedLocalPaths: string[] = [];
              for (const p of allPaths) {
                const staged = stageExistingFile(p);
                if (staged.success && staged.downloadUrl) {
                  if (staged.localPath) {
                    if (!collectedStagedPaths.includes(staged.localPath)) {
                      collectedStagedPaths.push(staged.localPath);
                    }
                    if (!stagedLocalPaths.includes(staged.localPath)) {
                      stagedLocalPaths.push(staged.localPath);
                    }
                  }
                  if (!mainStagedUrl) {
                    mainStagedUrl = staged.downloadUrl;
                    mainStagedPath = staged.localPath;
                  }
                  const ext = path.extname(staged.filename).toLowerCase();
                  if (['.mp4', '.webm', '.mov', '.mkv'].includes(ext) && !lastVideoUrl) {
                    lastVideoUrl = staged.downloadUrl;
                  } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext) && !lastScreenshotUrl) {
                    lastScreenshotUrl = staged.downloadUrl;
                  }
                }
              }

              if (mainStagedPath) {
                const promptTags = stagedLocalPaths.slice(0, 5).map(p => `[KIRIM_FILE: ${p} | ${path.basename(p)}]`).join(' ');
                observation += `\n\n💡 [SISTEM]: Berkas media tervalidasi siap disajikan (${path.basename(mainStagedPath)}). PENTING: Pada balasan akhir, sertakan tag ${promptTags} agar pemutar media / kartu unduhan langsung muncul di antarmuka web pengguna.`;
              }
            }
          } catch (autoErr) {
            console.error('[ToolExecutor] Gagal auto-detect media dari bash:', autoErr);
          }
        } else {
          observation = `[BASH FAILED: ${cmd.substring(0, 140)}]:\nError: ${result.error}\nOutput: ${truncateOutput(result.output, 8000)}\n\n\u{1F4A1} TIPS BELAJAR DARI KESALAHAN: Jangan mengulang perintah yang sama persis jika gagal. Jika kamu menemukan akar masalah dan solusinya, panggil [CATAT_PELAJARAN: masalah | solusi] agar tidak terulang pada otomasi berikutnya.`;
        }
        options?.executedCommands?.set(cmdKey, observation);
        observationParts.push(observation);
        collectedSteps.push({
          param: cmd,
          ok: result.success,
          durationMs: Date.now() - cmdStartMs,
          output: lastOutput || '',
        });
      }
    }
  }

  // 4b. [CEK_KESEHATAN_PROYEK: target] - Pre-flight Health Audit & Port Guard (Admin Only)
  if (isAdmin) {
    const healthMatches = parseToolTags(aiReply).filter((t) => t.type === 'CEK_KESEHATAN_PROYEK').slice(0, 2);
    for (const m of healthMatches) {
      hasAction = true;
      const targetDir = m.param.trim() || '/root/ai-chat';
      console.log(`[ToolExecutor] Cek kesehatan proyek: ${targetDir}`);
      const checkScript = `
TARGET="${targetDir}"
echo "=== TARGET: $TARGET ==="
if [ ! -d "$TARGET" ]; then
  echo "Direktori $TARGET tidak ditemukan!"
  exit 1
fi
cd "$TARGET" 2>/dev/null || exit 1

echo "[GIT STATUS]"
git status --short 2>/dev/null | head -15 || echo "Bukan git repository atau bersih"

echo "[PROSES BUILD/DEPLOY AKTIF]"
BUILD_PIDS=$(pgrep -f "deploy.sh|next build|npm run build" | tr '\\n' ' ')
if [ -n "$BUILD_PIDS" ]; then
  echo "⚠️ PERINGATAN: Ada proses build aktif (PID: $BUILD_PIDS). JANGAN jalankan build baru bersamaan!"
else
  echo "Tidak ada build/deploy berjalan (AMAN)"
fi

echo "[PORT LISTENER AKTIF]"
ss -tlpn 2>/dev/null | grep -E "3010|20128|18789|5005" | head -10 || echo "Port bersih"

echo "[RESOURCE SISTEM]"
free -m | awk 'NR==2{printf "RAM: %s/%sMB (%.1f%%) | ", $3, $2, $3*100/$2 }'
df -h / | awk 'NR==2{printf "Disk: %s/%s (%s bebas)\\n", $3, $2, $4}'
`;
      const result = await runBashCommand(checkScript);
      observationParts.push(
        `[HASIL DIAGNOSTIK KESEHATAN PROYEK - ${targetDir}]:\n${truncateOutput(result.output, 6000)}\n\n💡 EVALUASI OTOMASI: Pastikan tidak ada proses build aktif atau port bentrok sebelum menjalankan tugas berat.`
      );
    }
  }

  // 4c. [CATAT_PELAJARAN: masalah | solusi] - Belajar dari Kesalahan Otomasi
  const learnMatches = parseToolTags(aiReply).filter((t) => t.type === 'CATAT_PELAJARAN').slice(0, 3);
  for (const m of learnMatches) {
    hasAction = true;
    const parts = m.param.split('|');
    const problem = (parts[0] || '').trim();
    const solution = (parts.slice(1).join('|') || '').trim();
    if (problem && solution) {
      const formatted = `Masalah: ${problem} -> Solusi: ${solution}`;
      if (options?.userId) {
        MemoryRepository.add(options.userId, formatted, 'solusi_masalah', 'auto');
      }
      observationParts.push(
        `[PEMBELAJARAN TERSIMPAN]: Catatan kegagalan & solusi otomasi berhasil disimpan secara permanen:\n- Masalah: ${problem}\n- Solusi Terbukti: ${solution}\nSistem telah menyimpannya agar tidak mengulangi kesalahan ini pada tugas berikutnya.`
      );
    }
  }

  // 5. [RUN_PYTHON: code] - Admin Only
  if (isAdmin) {
    const pyMatches = parseToolTags(aiReply).filter(t => t.type === 'RUN_PYTHON').slice(0, 2);
    // [steering 23 Okt 2026] Saring kode Python rakitan browser/solver sebelum jalan.
    for (let i = pyMatches.length - 1; i >= 0; i--) {
      if (isHandRolledBrowserCode(pyMatches[i].param || '')) {
        hasAction = true;
        observationParts.push(
          '[PYTHON DITOLAK]: Kode Python ini adalah otomasi browser rakitan (Playwright/Selenium/solver Turnstile). Gunakan tag [BROWSER: buka <url>] untuk interaksi web, atau [AMBIL_HALAMAN] untuk membaca isi halaman. Jangan menulis skrip solver sendiri.'
        );
        pyMatches.splice(i, 1);
      }
    }
    for (const m of pyMatches) {
      const code = m.param;
      if (code) {
        hasAction = true;
        lastCommand = `python3 << 'EOF'\n${code}\nEOF`;
        console.log(`[ToolExecutor] Running Python script (admin)...`);
        const scriptPath = path.join('/root/ai-chat/data', `temp_${Date.now()}.py`);
        fs.writeFileSync(scriptPath, code);
        const pyStartMs = Date.now();
        const result = await runBashCommand(`python3 ${scriptPath}`);
        try { fs.unlinkSync(scriptPath); } catch (e) {}
        lastOutput = result.success ? result.output : `Error: ${result.error}\n${result.output}`;
        collectedSteps.push({
          param: code,
          ok: result.success,
          durationMs: Date.now() - pyStartMs,
          output: lastOutput || '',
        });
        if (result.success) {
          observationParts.push(`[PYTHON OUTPUT]:\n${truncateOutput(result.output, 12000)}`);
        } else {
          observationParts.push(`[PYTHON FAILED]:\nError: ${result.error}\nOutput: ${truncateOutput(result.output, 10000)}\n\n💡 TIPS BELAJAR: Jika kamu menemukan penyebab kegagalan Python ini, panggil [CATAT_PELAJARAN: masalah | solusi].`);
        }
      }
    }
  }

  // 5b. [BACA_FILE: /path/file | baris_awal-baris_akhir] & [EDIT_FILE: /path/file | kode_lama ||| kode_baru] - Admin Only
  if (isAdmin) {
    const readMatches = parseToolTags(aiReply).filter((t) => t.type === 'BACA_FILE').slice(0, 5);
    for (const m of readMatches) {
      hasAction = true;
      const parts = m.param.split('|').map((s) => s.trim());
      const filePath = parts[0] || '';
      const rangeStr = parts[1] || '';

      if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        observationParts.push(`[BACA_FILE GAGAL]: Berkas "${filePath}" tidak ditemukan.`);
        continue;
      }

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const allLines = content.split('\n');
        let startLine = 1;
        let endLine = Math.min(allLines.length, 300);

        const rangeMatch = rangeStr.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (rangeMatch) {
          startLine = Math.max(1, parseInt(rangeMatch[1], 10));
          endLine = rangeMatch[2]
            ? Math.min(allLines.length, parseInt(rangeMatch[2], 10))
            : Math.min(allLines.length, startLine + 250);
        }

        const numbered = allLines
          .slice(startLine - 1, endLine)
          .map((ln, idx) => `${startLine + idx}: ${ln}`)
          .join('\n');

        lastOutput = numbered;
        observationParts.push(
          `[ISI BERKAS: ${filePath} (baris ${startLine}-${endLine} dari ${allLines.length})]:\n${truncateOutput(numbered, 24000)}`
        );
      } catch (err: any) {
        observationParts.push(`[BACA_FILE GAGAL: ${filePath}]: ${err.message}`);
      }
    }

    const editMatches = parseToolTags(aiReply).filter((t) => t.type === 'EDIT_FILE').slice(0, 5);
    for (const m of editMatches) {
      hasAction = true;
      const firstPipe = m.param.indexOf('|');
      const delimIdx = m.param.indexOf('|||');
      if (firstPipe === -1 || delimIdx === -1 || delimIdx <= firstPipe) {
        observationParts.push(
          `[EDIT_FILE GAGAL]: Format salah. Gunakan: [EDIT_FILE: /path/file | teks_target_lama ||| teks_pengganti_baru]`
        );
        continue;
      }

      const filePath = m.param.substring(0, firstPipe).trim();
      const targetBlock = m.param.substring(firstPipe + 1, delimIdx).replace(/^\r?\n|\r?\n$/g, '');
      const replacementBlock = m.param.substring(delimIdx + 3).replace(/^\r?\n|\r?\n$/g, '');

      if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        observationParts.push(`[EDIT_FILE GAGAL]: Berkas "${filePath}" tidak ditemukan.`);
        continue;
      }

      if (!targetBlock) {
        observationParts.push(`[EDIT_FILE GAGAL: ${filePath}]: Blok teks target kosong.`);
        continue;
      }

      try {
        const original = fs.readFileSync(filePath, 'utf-8');
        if (!original.includes(targetBlock)) {
          observationParts.push(
            `[EDIT_FILE GAGAL: ${filePath}]: Teks target tidak cocok persis di dalam berkas. Panggil [BACA_FILE: ${filePath} | baris_awal-baris_akhir] terlebih dahulu untuk menyalin teks asli secara presisi.`
          );
          continue;
        }

        const updated = original.replace(targetBlock, () => replacementBlock);
        fs.writeFileSync(filePath, updated, 'utf-8');
        const msg = `[EDIT_FILE BERHASIL: ${filePath}]: Blok kode berhasil diperbarui tanpa masalah escaping shell.`;
        lastOutput = msg;
        observationParts.push(msg);
      } catch (err: any) {
        observationParts.push(`[EDIT_FILE GAGAL: ${filePath}]: ${err.message}`);
      }
    }
  }

  // Catatan: [SIMPAN_MEMORI] sengaja TIDAK dieksekusi di sini. Memori
  // pengguna disimpan oleh API chat (MemoryRepository) agar per-akun, aman,
  // dan tidak memicu putaran tool tambahan.

  // 7. [RINGKAS_YOUTUBE: url] - Admin Only
  if (isAdmin) {
    const ytRegex = /\[RINGKAS_YOUTUBE:\s*(https?:\/\/[^\s\]]+)\]/gi;
    const ytMatches = Array.from(cleanReply.matchAll(ytRegex)).slice(0, 1);
    for (const m of ytMatches) {
      const ytUrl = m[1].trim();
      if (ytUrl) {
        hasAction = true;
        lastUrl = ytUrl;
        console.log(`[ToolExecutor] YouTube Script: ${ytUrl}`);
        const result = await runBashCommand(`yt-dlp --dump-json "${ytUrl}" | jq -r '{title: .title, duration: .duration, uploader: .uploader, description: .description}'`);
        lastOutput = result.output;
        if (result.success) {
          observationParts.push(`[INFO YOUTUBE]:\n${truncateOutput(result.output, 12000)}\n\nSilakan rangkum metadata di atas.`);
        } else {
          observationParts.push(`[ERROR YOUTUBE]: ${truncateOutput(result.error || result.output, 2000)}`);
        }
      }
    }
  }

  // 7b. [AMBIL_SUBTITEL: url] - Admin Only
  // GERBANG IZIN: mengunduh/menranskrip audio video pihak lain butuh persetujuan
  // pengguna (kepemilikan/hak) lebih dulu — sama seperti gerbang OTP. Tanpa
  // persetujuan pada giliran terakhir, tag TIDAK dijalankan.
  if (isAdmin) {
    const subRegex = /\[AMBIL_SUBTITEL:\s*(https?:\/\/[^\s\]]+)\]/gi;
    const subMatches = Array.from(cleanReply.matchAll(subRegex)).slice(0, 1);
    for (const m of subMatches) {
      const subUrl = m[1].trim();
      if (subUrl) {
        hasAction = true;
        lastUrl = subUrl;
        if (!options?.mediaApproved) {
          observationParts.push(
            `[IZIN DIPERLUKAN - AMBIL_SUBTITEL]: Jangan unduh/transkrip dulu. Konfirmasi singkat ke pengguna bahwa video itu miliknya atau ia berhak/berizin (bukan konten pihak lain tanpa izin), misalnya: "Boleh saya unduh & transkrip video ini? Pastikan Anda pemiliknya atau punya izin." Setelah pengguna menjawab setuju pada giliran berikutnya, panggil ulang \`[AMBIL_SUBTITEL: ${subUrl}]\`.`
          );
        } else {
          console.log(`[ToolExecutor] Ambil subtitel: ${subUrl}`);
          const result = await runSubtitleTool(subUrl);
          lastOutput = result.output;
          if (result.success) {
            observationParts.push(`[HASIL SUBTITEL]:\n${truncateOutput(result.output, 35000)}\n\n(File .srt dan .txt tersimpan di folder /root/getsub/output/ di server. Sajikan teks transkrip di atas kepada pengguna; perbaiki seperlunya salah dengar yang jelas tanpa mengubah isi.)`);
          } else {
            observationParts.push(`[ERROR SUBTITEL]: ${truncateOutput(result.error || result.output, 2000)}`);
          }
        }
      }
    }
  }

  // 7c. [AMBIL_HALAMAN: url] - Admin Only
  // Baca halaman yang dilindungi Cloudflare/anti-bot TANPA browser, langsung
  // lewat rantai ekstraksi fallbackFetch (direct -> WARP proxy -> Jina Reader).
  if (isAdmin) {
    const pageRegex = /\[AMBIL_HALAMAN:\s*(https?:\/\/[^\s\]]+)\]/gi;
    const pageMatches = Array.from(cleanReply.matchAll(pageRegex)).slice(0, 2);
    for (const m of pageMatches) {
      const pageUrl = m[1].trim();
      if (pageUrl) {
        hasAction = true;
        lastUrl = pageUrl;
        console.log(`[ToolExecutor] Ambil halaman (anti-bot): ${pageUrl}`);
        const r = await fallbackFetch(pageUrl);
        lastOutput = r.text;
        if (r.text && !r.text.startsWith('Gagal membaca URL')) {
          observationParts.push(`[HASIL AMBIL HALAMAN: ${pageUrl}]:\n${truncateOutput(r.text, 30000)}\n\n(Sajikan isi halaman di atas kepada pengguna. Ini teks hasil ekstraksi server; tampilan asli halaman mungkin berbeda.)`);
        } else {
          observationParts.push(`[ERROR AMBIL HALAMAN]: ${truncateOutput(r.text || 'Ekstraksi gagal.', 2000)}`);
        }
      }
    }
  }

  // 8. [BUAT_FILE: nama_file.ext | isi_file] - Universal File Generator (.xlsx, .docx, .lua, .txt, .csv, .py, .pdf, dll)
  const fileMatches = parseToolTags(aiReply, 'BUAT_FILE').slice(0, 3);
  for (const m of fileMatches) {
    const pipeIdx = m.param.indexOf('|');
    if (pipeIdx !== -1) {
      const rawName = m.param.substring(0, pipeIdx).trim();
      const fileBody = m.param.substring(pipeIdx + 1).trim();
      if (rawName && fileBody) {
        hasAction = true;
        console.log(`[ToolExecutor] Generating file: ${rawName}`);
        const res = createFileFromContent(rawName, fileBody);
        lastOutput = res.message;
        if (res.success) {
          lastUrl = res.downloadUrl;
          if (res.localPath && !collectedStagedPaths.includes(res.localPath)) {
            collectedStagedPaths.push(res.localPath);
          }
          observationParts.push(
            `[BERKAS DISIAPKAN]: ${res.message}\nPath lokal: ${res.localPath}\nTautan unduhan: ${res.downloadUrl}\n(Berkas ini otomatis dapat diunduh oleh pengguna di antarmuka chat via kartu unduhan. Sertakan tag [KIRIM_FILE: ${res.localPath} | Berkas ${res.filename}] dalam balasan akhir Anda.)`
          );
        } else {
          observationParts.push(`[GAGAL MEMBUAT BERKAS]: ${res.message}`);
        }
      }
    }
  }

  // 8b. [BUAT_PDF: isi_atau_html | nama_file.pdf]
  const pdfMatches = parseToolTags(aiReply, 'BUAT_PDF').slice(0, 1);
  for (const m of pdfMatches) {
    const pipeIdx = m.param.lastIndexOf('|');
    const pdfBody = pipeIdx !== -1 ? m.param.substring(0, pipeIdx).trim() : m.param.trim();
    const rawName = pipeIdx !== -1 ? m.param.substring(pipeIdx + 1).trim() : 'dokumen.pdf';
    if (pdfBody) {
      hasAction = true;
      const pdfFilename = rawName.toLowerCase().endsWith('.pdf') ? rawName : `${rawName}.pdf`;
      console.log(`[ToolExecutor] Generating PDF: ${pdfFilename}`);
      const res = createFileFromContent(pdfFilename, pdfBody);
      lastOutput = res.message;
      if (res.success) {
        lastUrl = res.downloadUrl;
        if (res.localPath && !collectedStagedPaths.includes(res.localPath)) {
          collectedStagedPaths.push(res.localPath);
        }
        observationParts.push(
          `[DOKUMEN PDF DISIAPKAN]: ${res.message}\nPath lokal: ${res.localPath}\nTautan unduhan: ${res.downloadUrl}\n(Sertakan tag [KIRIM_FILE: ${res.localPath} | Dokumen PDF (${res.filename})] dalam balasan akhir Anda.)`
        );
      } else {
        observationParts.push(`[GAGAL MEMBUAT PDF]: ${res.message}`);
      }
    }
  }

  // Stage any files referenced in [KIRIM_FILE], [KIRIM_DOKUMEN], [KIRIM_VIDEO], [KIRIM_AUDIO], [KIRIM_GAMBAR]
  const stagedInHop = stageMediaTagsInReply(aiReply);
  for (const sp of stagedInHop.stagedPaths) {
    if (!collectedStagedPaths.includes(sp)) {
      collectedStagedPaths.push(sp);
    }
  }

  // 9. [BACA_OCR: path] - Admin Only
  if (isAdmin) {
    const ocrRegex = /\[BACA_OCR:\s*([^\]]+)\]/gi;
    const ocrMatches = Array.from(cleanReply.matchAll(ocrRegex)).slice(0, 1);
    for (const m of ocrMatches) {
      const imgPath = m[1].trim();
      hasAction = true;
      const result = await runBashCommand(`tesseract "${imgPath}" stdout`);
      lastOutput = result.output;
      if (result.success) {
        observationParts.push(`[HASIL OCR]:\n${truncateOutput(result.output, 15000)}`);
      } else {
        observationParts.push(`[ERROR OCR]: ${truncateOutput(result.error || '', 2000)}`);
      }
    }
  }

  // 10. [BROWSER: aksi argumen] - Admin Only
  if (isAdmin) {
    const browserTags = parseToolTags(cleanReply).filter((t) => t.type === 'BROWSER');
    if (browserTags.length > 0) {
      hasAction = true;
      const sessionId = options?.browserSession || 'default';
      const cmd = parseBrowserCommand(browserTags[0].param);

      if (!isBrowserAgentConfigured()) {
        observationParts.push(
          '[BROWSER GAGAL]: daemon browser-agent tidak dikonfigurasi di server (config.json tidak terbaca). Hubungi admin.'
        );
      } else {
        const payload: Record<string, unknown> = { ...cmd.payload };
        if (cmd.needsApproval) payload.approval = Boolean(options?.otpApproved);
        console.log(`[ToolExecutor] Browser (sesi ${sessionId}): ${cmd.describe}`);

        // IP VPS sering diblokir: jalankan lewat tahap proxy (default 1=WARP) dan
        // naikkan tahap otomatis bila halaman masih terblokir (khusus navigasi).
        const baseStage = Math.min(
          Math.max(Number(process.env.BROWSER_PROXY_STAGE ?? 1) || 0, 0),
          6
        );
        const isNav = cmd.action === 'nav';
        let stage = baseStage;
        let res = await callBrowserAgent(sessionId, {
          action: cmd.action,
          ...payload,
          useProxy: stage > 0,
          proxyStage: stage,
        });

        if (isNav && (res.blocked || !res.ok)) {
          // Turnstile macet -> ZenRows CDP (5) lalu Browserbase (6).
          // Blokir jaringan biasa -> proxy residensial lalu cloud.
          const turnstileStuck = Boolean(
            res.captcha?.turnstilePresent && !res.captcha?.turnstileSolved
          );
          const ladder = (turnstileStuck ? [5, 6] : [2, 3, 4, 6]).filter((s) => s > stage);
          for (const next of ladder) {
            console.log(`[ToolExecutor] Halaman terblokir, naik ke proxyStage=${next}`);
            const retry = await callBrowserAgent(sessionId, {
              action: cmd.action,
              ...payload,
              useProxy: true,
              proxyStage: next,
            });
            if (retry.ok && !retry.blocked) {
              res = retry;
              stage = next;
              break;
            }
            res = retry;
          }
          if (stage > baseStage) {
            observationParts.push(
              `[PROXY] Akses berhasil setelah naik ke tahap proxy ${stage} (IP VPS langsung diblokir).`
            );
          }
          if (res.liveViewUrl) {
            observationParts.push(
              `[LIVE VIEW] Pantau/takeover browser cloud: ${res.liveViewUrl}`
            );
          }
        }

        const formatted = formatBrowserResult(cmd, res);
        lastOutput = formatted;
        if (res.url) lastUrl = String(res.url);
        if (res.screenshotUrl) {
          lastScreenshotUrl = String(res.screenshotUrl);
        } else if (res.screenshotPath) {
          const fname = path.basename(String(res.screenshotPath));
          lastScreenshotUrl = `/api/browser-shots/${encodeURIComponent(fname)}`;
        }
        observationParts.push(formatted);
      }

      if (browserTags.length > 1) {
        observationParts.push(
          `[CATATAN BROWSER]: ada ${browserTags.length - 1} perintah [BROWSER] lain di balasan ini yang belum dijalankan. ` +
            'Perintah browser dijalankan satu per satu karena rujukan elemen dapat berubah. Baca status terbaru di atas, lalu kirim perintah berikutnya.'
        );
      }
    }
  }

  // 7. [MCP: server.tool | {"arg":"nilai"}] - Admin Only
  if (isAdmin) {
    const mcpTags = parseToolTags(aiReply, 'MCP').slice(0, 4);
    for (const m of mcpTags) {
      hasAction = true;
      const raw = (m.param || '').trim();
      const separator = raw.indexOf('|');
      const fullName = (separator === -1 ? raw : raw.slice(0, separator)).trim();
      const argsRaw = separator === -1 ? '' : raw.slice(separator + 1).trim();
      if (!fullName) {
        observationParts.push(
          '[MCP GAGAL]: format wajib [MCP: server.tool | {"arg":"nilai"}]. Contoh: [MCP: time.get_current_time | {}]'
        );
        collectedSteps.push({
          param: raw,
          ok: false,
          durationMs: 0,
          output: 'Error: server.tool tidak ditulis',
        });
        continue;
      }
      const mcpStartMs = Date.now();
      try {
        const mcpResult = await callMcpTool(fullName, argsRaw);
        lastOutput = mcpResult;
        observationParts.push(`[MCP RESULT ${fullName}]:\n${truncateOutput(mcpResult, 12000)}`);
        collectedSteps.push({
          param: raw,
          ok: true,
          durationMs: Date.now() - mcpStartMs,
          output: mcpResult,
        });
      } catch (err: any) {
        const message = `Error: ${err?.message || err}`;
        lastOutput = message;
        observationParts.push(`[MCP FAILED ${fullName}]: ${err?.message || err}`);
        collectedSteps.push({
          param: raw,
          ok: false,
          durationMs: Date.now() - mcpStartMs,
          output: message,
        });
      }
    }
  }

  // 8. [CLI: nama | instruksi] - Admin Only (meminjam CLI agent lain)
  if (isAdmin) {
    const cliTags = parseToolTags(aiReply, 'CLI').slice(0, 2);
    for (const m of cliTags) {
      hasAction = true;
      const raw = (m.param || '').trim();
      const sep = raw.indexOf('|');
      const cliName = (sep === -1 ? raw : raw.slice(0, sep)).trim();
      const instruction = sep === -1 ? '' : raw.slice(sep + 1).trim();
      const cliStartMs = Date.now();
      try {
        const res = await runCli(cliName, instruction, { timeoutMs: 180_000 });
        lastOutput = res.output;
        observationParts.push(
          `[CLI ${cliName} ${res.ok ? 'OK' : 'GAGAL'} | ${Math.round(res.durationMs / 1000)}s]:\n${truncateOutput(res.output, 14000)}`
        );
        collectedSteps.push({
          param: raw,
          ok: res.ok,
          durationMs: res.durationMs,
          output: res.output,
        });
      } catch (err: any) {
        const message = `Error: ${err?.message || err}`;
        lastOutput = message;
        observationParts.push(`[CLI ${cliName || '?'} GAGAL]: ${err?.message || err}`);
        collectedSteps.push({
          param: raw,
          ok: false,
          durationMs: Date.now() - cliStartMs,
          output: message,
        });
      }
    }
  }

  return {
    hasAction,
    observation: observationParts.join('\n\n'),
    sources: collectedSources.length > 0 ? collectedSources : undefined,
    command: lastCommand,
    output: lastOutput,
    steps: collectedSteps.length > 0 ? collectedSteps : undefined,
    url: lastUrl,
    screenshotUrl: lastScreenshotUrl,
    videoUrl: lastVideoUrl,
    embedUrl: lastEmbedUrl,
    stagedPaths: collectedStagedPaths.length > 0 ? collectedStagedPaths : undefined,
  };
}
