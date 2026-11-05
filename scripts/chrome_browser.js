#!/usr/bin/env node
/**
 * Standalone Headless Chrome Browser Runner for Web AI Chat
 * Multi-layer Anti-Bot Auto-Fallback:
 * 1. Playwright Chromium + Cloudflare WARP SOCKS5 Proxy (127.0.0.1:40000)
 * 2. Decodo Universal Scraper API (Residential Proxy Pool)
 * 3. Jina Reader AI Markdown Engine (r.jina.ai)
 * 4. ZenRows Premium Proxy & Stealth
 * 5. ScrapingBee Fallback
 */
const fs = require('fs');
const path = require('path');
const { browseWeb } = require('./browser_helper.js');

const SHOTS_DIR = '/root/browser-agent/shots';

function getDecodoKey() {
  if (process.env.DECODO_API_KEY) return process.env.DECODO_API_KEY.trim();
  const envPath = '/root/ai-chat/.env.local';
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const l of lines) {
      if (l.startsWith('DECODO_API_KEY=')) {
        return l.split('=', 2)[1].replace(/['"]/g, '').trim();
      }
    }
  }
  return 'ef4e72d0a2e22c08f839945b13f91553bd8307f3a2aaac26f567660944f36c61';
}

function isValidScrapedText(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length < 15) return false;
  const lower = t.toLowerCase();
  if (lower.includes('monthly api calls limit reached')) return false;
  if (lower.includes('abusealleviationerror')) return false;
  if (lower.includes('could not get content')) return false;
  if (lower.includes('just a moment...') || lower.includes('checking your browser before accessing')) return false;
  return true;
}

async function fetchDecodoFallback(targetUrl) {
  const apiKey = getDecodoKey();
  try {
    process.stderr.write(`Mencoba scraping via Decodo API untuk ${targetUrl}...\n`);
    const res = await fetch('https://data.decodo.com/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: targetUrl,
        target: 'universal',
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rawContent = data.results && data.results[0] ? data.results[0].content : null;
    if (!rawContent) return null;

    let cleanText = String(rawContent);
    const titleMatch = cleanText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : targetUrl;
    if (cleanText.includes('<html') || cleanText.includes('<body') || cleanText.includes('</div>')) {
      cleanText = cleanText
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    if (isValidScrapedText(cleanText)) {
      return { success: true, title, text: cleanText, url: targetUrl };
    }
  } catch (e) {
    process.stderr.write(`Decodo fallback error: ${e.message}\n`);
  }
  return null;
}

async function fetchJinaReaderFallback(targetUrl) {
  try {
    process.stderr.write(`Mencoba membaca via Jina Reader (r.jina.ai) untuk ${targetUrl}...\n`);
    const res = await fetch(`https://r.jina.ai/${targetUrl}`, {
      headers: {
        'Accept': 'text/plain',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!isValidScrapedText(text)) return null;

    const titleMatch = text.match(/^Title:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : targetUrl;
    return { success: true, title, text: text.trim(), url: targetUrl };
  } catch (e) {
    process.stderr.write(`Jina Reader fallback error: ${e.message}\n`);
  }
  return null;
}

async function fetchScrapingBeeFallback(targetUrl) {
  const apiKey = process.env.SCRAPINGBEE_API_KEY || 'LOSEG1YDYLVZ4QEABI3Q6J1UTFQLGG5MHMWD4GLN1H0B1KQMEV9TCL4PXBH6FWG29FNGQFZM2SSNB0J2';
  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      url: targetUrl,
      render_js: 'true',
      premium_proxy: 'true',
      block_resources: 'false'
    });
    const res = await fetch('https://app.scrapingbee.com/api/v1/?' + params.toString(), {
      signal: AbortSignal.timeout(25000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : targetUrl;
    const cleanText = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (isValidScrapedText(cleanText)) {
      return { success: true, title, text: cleanText, url: targetUrl };
    }
  } catch (e) {
    process.stderr.write(`ScrapingBee fallback error: ${e.message}\n`);
  }
  return null;
}

async function fetchZenRowsFallback(targetUrl) {
  const rawPool = (process.env.ZENROWS_API_KEYS || process.env.ZENROWS_API_KEY || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
  if (!rawPool.length) return null;

  for (const apiKey of rawPool) {
    try {
      const params = new URLSearchParams({
        apikey: apiKey,
        url: targetUrl,
        js_render: 'true',
        premium_proxy: 'true'
      });
      const res = await fetch('https://api.zenrows.com/v1/?' + params.toString(), {
        signal: AbortSignal.timeout(25000)
      });
      if (res.status === 401 || res.status === 402 || res.status === 429) {
        process.stderr.write(`ZenRows key ${apiKey.slice(0, 6)}... quota/auth failed (${res.status}), trying next key...\n`);
        continue;
      }
      if (!res.ok) continue;
      const html = await res.text();
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : targetUrl;
      const cleanText = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (isValidScrapedText(cleanText)) {
        return { success: true, title, text: cleanText, url: targetUrl };
      }
    } catch (e) {
      process.stderr.write(`ZenRows fallback error on key ${apiKey.slice(0, 6)}...: ${e.message}\n`);
    }
  }
  return null;
}

async function main() {
  const url = process.argv[2];
  const takeScreenshot = process.argv[3] === 'true';

  if (!url) {
    console.log(JSON.stringify({ success: false, error: 'No URL provided' }));
    process.exit(1);
  }

  // Jaga stdout tetap JSON murni
  const origLog = console.log;
  console.log = console.warn = console.info = function () {
    process.stderr.write(Array.from(arguments).join(' ') + '\n');
  };

  let result = null;
  try {
    result = await browseWeb(url, takeScreenshot);
  } catch (err) {
    process.stderr.write(`browseWeb error: ${err.message}\n`);
  }

  const text = result?.text || '';
  const title = result?.title || '';
  const isChallenge =
    title.includes('Cloudflare') ||
    title.includes('Just a moment') ||
    title.includes('Tunggu sebentar') ||
    title.includes('Attention Required') ||
    title.includes('Perhatian Diperlukan') ||
    text.includes('Please verify you are a human') ||
    text.includes('Verifikasi bahwa Anda adalah manusia') ||
    text.includes('Checking your browser before accessing') ||
    text.includes('Memeriksa browser Anda');

  const isBlocked = !result || !result.success || !isValidScrapedText(text) || isChallenge;

  if (isBlocked) {
    process.stderr.write(`Local browser blocked or challenge detected (${text.length} chars), memulai fallback berjenjang untuk ${url}...\n`);

    // 1. Decodo Anti-Bot Scraper (Residential Proxy Pool)
    const decodo = await fetchDecodoFallback(url);
    if (decodo && isValidScrapedText(decodo.text)) {
      if (result && result.screenshotPath) decodo.screenshotPath = result.screenshotPath;
      origLog(JSON.stringify(decodo));
      process.exit(0);
    }

    // 2. Jina Reader AI Markdown Scraper
    const jina = await fetchJinaReaderFallback(url);
    if (jina && isValidScrapedText(jina.text)) {
      if (result && result.screenshotPath) jina.screenshotPath = result.screenshotPath;
      origLog(JSON.stringify(jina));
      process.exit(0);
    }

    // 3. ZenRows Anti-Bot
    const zr = await fetchZenRowsFallback(url);
    if (zr && isValidScrapedText(zr.text)) {
      if (result && result.screenshotPath) zr.screenshotPath = result.screenshotPath;
      origLog(JSON.stringify(zr));
      process.exit(0);
    }

    // 4. ScrapingBee (Hanya jika respons valid dan memiliki kuota)
    const sb = await fetchScrapingBeeFallback(url);
    if (sb && isValidScrapedText(sb.text)) {
      if (result && result.screenshotPath) sb.screenshotPath = result.screenshotPath;
      origLog(JSON.stringify(sb));
      process.exit(0);
    }
  }

  if (result && isValidScrapedText(result.text)) {
    if (result.screenshotPath && fs.existsSync(result.screenshotPath)) {
      try {
        fs.mkdirSync(SHOTS_DIR, { recursive: true });
        const dest = path.join(SHOTS_DIR, path.basename(result.screenshotPath));
        if (dest !== result.screenshotPath) fs.copyFileSync(result.screenshotPath, dest);
        result.screenshotPath = dest;
      } catch (e) {
        process.stderr.write(`copy screenshot gagal: ${e.message}\n`);
      }
    }
    origLog(JSON.stringify(result));
    process.exit(0);
  }

  // Jika tetap ada screenshot dari local browser meskipun teks challenge
  if (result && result.screenshotPath) {
    origLog(JSON.stringify(result));
    process.exit(0);
  }

  origLog(JSON.stringify({ success: false, error: 'Gagal membuka halaman web setelah mencoba semua engine fallback' }));
  process.exit(1);
}

main();
