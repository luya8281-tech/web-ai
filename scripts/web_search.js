#!/usr/bin/env node
/**
 * High-Capacity Multi-Engine Web Search Runner for Web AI Chat
 * Supports 10 to 50 sources per search query.
 * Aggregates Google News RSS (ID & Global), Bing News/Web RSS, DuckDuckGo HTML, and Wikipedia API.
 * Returns structured `sources` (with domain & favicon logo) + formatted `text`.
 *
 * Revisi 2026-10 (peringkat relevansi): tokenisasi sadar-kata, bobot IDF,
 * batas-kata + sufiks Indonesia, bonus kebaruan, keragaman domain, dan
 * pembuangan judul nyaris kembar. Lihat blok "Relevance helpers".
 *
 * Tavily (https://api.tavily.com, kunci di /root/.tavily/api_key atau env
 * TAVILY_API_KEY) dipakai sebagai mesin utama bila tersedia; hasilnya
 * diprioritaskan dan tak ikut difilter kata kunci.
 */
const fs = require('fs');
const fetch = globalThis.fetch; // Node 20 built-in
const cheerio = require('cheerio');

const searchCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function extractDomain(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.hostname.replace(/^www\./i, '');
  } catch {
    return 'web';
  }
}

function getFaviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        ...(options.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function searchGoogleNewsRss(query, hl = 'id', gl = 'ID', ceid = 'ID:id') {
  const items = [];
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${encodeURIComponent(ceid)}`;
    const res = await fetchWithTimeout(url, {}, 9000);
    if (!res.ok) return items;
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    $('item').each((_, el) => {
      const rawTitle = $(el).find('title').text().trim();
      const rawUrl = $(el).find('link').text().trim();
      const sourceEl = $(el).find('source');
      const sourceUrl = sourceEl.attr('url') || '';
      const sourceName = sourceEl.text().trim();
      const descHtml = $(el).find('description').text() || '';
      let snippet = '';
      if (descHtml) {
        try {
          const $desc = cheerio.load(descHtml);
          const firstA = $desc('a').first().text().trim();
          snippet = firstA && firstA !== rawTitle ? firstA : rawTitle;
        } catch {
          snippet = rawTitle;
        }
      }
      snippet = snippet.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();

      if (rawTitle && rawUrl) {
        const effectiveDomain = sourceUrl ? extractDomain(sourceUrl) : extractDomain(rawUrl);
        items.push({
          title: rawTitle,
          url: rawUrl,
          sourceUrl: sourceUrl || rawUrl,
          domain: effectiveDomain,
          siteName: sourceName || effectiveDomain,
          snippet: pubDate ? `${pubDate} — ${snippet}` : snippet,
        });
      }
    });
  } catch {}
  return items;
}

async function searchBingRss(query) {
  const items = [];
  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=30`;
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) return items;
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    $('item').each((_, el) => {
      const title = $(el).find('title').text().trim();
      const rawUrl = $(el).find('link').text().trim();
      const snippet = $(el)
        .find('description')
        .text()
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (title && rawUrl) {
        const domain = extractDomain(rawUrl);
        items.push({
          title,
          url: rawUrl,
          sourceUrl: rawUrl,
          domain,
          siteName: domain,
          snippet,
        });
      }
    });
  } catch {}
  return items;
}

async function searchBingNewsRss(query) {
  const items = [];
  try {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`;
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) return items;
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    $('item').each((_, el) => {
      const title = $(el).find('title').text().trim();
      let rawUrl = $(el).find('link').text().trim();
      const urlParamMatch = rawUrl.match(/[?&]url=([^&]+)/);
      if (urlParamMatch) {
        try {
          rawUrl = decodeURIComponent(urlParamMatch[1]);
        } catch {}
      }
      const snippet = $(el)
        .find('description')
        .text()
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (title && rawUrl) {
        const domain = extractDomain(rawUrl);
        items.push({
          title,
          url: rawUrl,
          sourceUrl: rawUrl,
          domain,
          siteName: domain,
          snippet,
        });
      }
    });
  } catch {}
  return items;
}

async function searchDuckDuckGoHtml(query) {
  const items = [];
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(url, {}, 9000);
    if (!res.ok) return items;
    const html = await res.text();
    const $ = cheerio.load(html);
    $('.result').each((_, el) => {
      const title = $(el).find('h2.result__title a').text().trim();
      let rawUrl = $(el).find('a.result__url').attr('href') || $(el).find('h2.result__title a').attr('href');
      if (rawUrl && rawUrl.includes('uddg=')) {
        const match = rawUrl.match(/uddg=([^&]+)/);
        if (match) rawUrl = decodeURIComponent(match[1]);
      } else if (rawUrl && rawUrl.startsWith('//')) {
        rawUrl = 'https:' + rawUrl;
      }
      const snippet = $(el).find('a.result__snippet, .result__snippet').text().trim();
      if (title && rawUrl) {
        const domain = extractDomain(rawUrl);
        items.push({
          title,
          url: rawUrl,
          sourceUrl: rawUrl,
          domain,
          siteName: domain,
          snippet,
        });
      }
    });
  } catch {}
  return items;
}

async function searchWikipedia(query) {
  const items = [];
  try {
    const url = `https://id.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&srlimit=5`;
    const res = await fetchWithTimeout(url, {}, 6000);
    if (!res.ok) return items;
    const data = await res.json();
    const searchList = data?.query?.search || [];
    for (const s of searchList) {
      const pageUrl = `https://id.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/\s+/g, '_'))}`;
      const snippet = (s.snippet || '').replace(/<[^>]+>/g, '').trim();
      items.push({
        title: `${s.title} — Wikipedia Bahasa Indonesia`,
        url: pageUrl,
        sourceUrl: pageUrl,
        domain: 'id.wikipedia.org',
        siteName: 'Wikipedia',
        snippet,
      });
    }
  } catch {}
  return items;
}

// ---------------------------------------------------------------------------
// Tavily — mesin pencarian utama (bila kunci tersedia).
// ---------------------------------------------------------------------------
const TAVILY_KEY_FILE = '/root/.tavily/api_key';
const TAVILY_CACHE_FILE = '/root/.tavily/search_cache.json';
const TAVILY_CACHE_TTL_MS = 10 * 60 * 1000;

function getTavilyKeys() {
  const raw = process.env.TAVILY_API_KEYS || process.env.TAVILY_API_KEY || '';
  const list = raw.split(',').map(k => k.trim()).filter(Boolean);
  try {
    const fileKey = fs.readFileSync(TAVILY_KEY_FILE, 'utf8').trim();
    if (fileKey && !list.includes(fileKey)) list.unshift(fileKey);
  } catch {}
  return list;
}

function getTavilyKey() {
  const keys = getTavilyKeys();
  return keys[0] || null;
}

function readTavilyCache() {
  try {
    return JSON.parse(fs.readFileSync(TAVILY_CACHE_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeTavilyCache(cache) {
  try {
    const keys = Object.keys(cache);
    if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete cache[k];
    fs.writeFileSync(TAVILY_CACHE_FILE, JSON.stringify(cache));
  } catch {}
}

async function searchTavily(query, maxResults = 10, wantsRecent = false) {
  const empty = { items: [], answer: '' };
  const keys = getTavilyKeys();
  if (!keys.length) return empty;

  const topic = wantsRecent ? 'news' : 'general';
  const cacheKey = `${query.toLowerCase()}::${maxResults}::${topic}`;
  const cache = readTavilyCache();
  const hit = cache[cacheKey];
  if (hit && Date.now() - hit.t < TAVILY_CACHE_TTL_MS) {
    return { items: hit.items || [], answer: hit.answer || '' };
  }

  for (const key of keys) {
    const body = {
      api_key: key,
      query,
      max_results: Math.min(Math.max(5, Number(maxResults) || 10), 20),
      search_depth: 'basic',
      topic: 'general',
      exclude_domains: [
        'instagram.com',
        'facebook.com',
        'tiktok.com',
        'pinterest.com',
        'twitter.com',
        'x.com',
        'threads.net',
      ],
      include_answer: true,
    };

    const items = [];
    let answer = '';
    try {
      const res = await fetchWithTimeout(
        'https://api.tavily.com/search',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        12000
      );
      if (res.status === 401 || res.status === 402 || res.status === 429) {
        process.stderr.write(`Tavily key ${key.slice(0, 12)}... quota/limit reached (${res.status}), trying next key...\n`);
        continue;
      }
      if (res.ok) {
        const data = await res.json();
        answer = typeof data.answer === 'string' ? data.answer : '';
        for (const r of data.results || []) {
          if (!r.url || !r.title) continue;
          const domain = extractDomain(r.url);
          items.push({
            title: r.title,
            url: r.url,
            sourceUrl: r.url,
            domain,
            siteName: domain,
            snippet: String(r.content || '').replace(/\s+/g, ' ').slice(0, 400),
            tavilyScore: typeof r.score === 'number' ? r.score : 0,
          });
        }
        items.sort((a, b) => (b.tavilyScore || 0) - (a.tavilyScore || 0));
        if (items.length) {
          cache[cacheKey] = { t: Date.now(), items, answer };
          writeTavilyCache(cache);
        }
        return { items, answer };
      }
    } catch (e) {
      process.stderr.write(`Tavily error with key ${key.slice(0, 12)}...: ${e.message}\n`);
    }
  }
  return empty;
}

// ---------------------------------------------------------------------------
// Brave Search API — Mesin pencarian web resmi bereputasi tinggi.
// ---------------------------------------------------------------------------
const BRAVE_KEY_FILE = '/root/.brave/api_key';
const BRAVE_CACHE_FILE = '/root/.brave/search_cache.json';
const BRAVE_CACHE_TTL_MS = 10 * 60 * 1000;

function getBraveKey() {
  const fromEnv = process.env.BRAVE_SEARCH_API_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    const k = fs.readFileSync(BRAVE_KEY_FILE, 'utf8').trim();
    return k || null;
  } catch {
    return null;
  }
}

function readBraveCache() {
  try {
    return JSON.parse(fs.readFileSync(BRAVE_CACHE_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeBraveCache(cache) {
  try {
    const keys = Object.keys(cache);
    if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete cache[k];
    fs.writeFileSync(BRAVE_CACHE_FILE, JSON.stringify(cache));
  } catch {}
}

async function searchBrave(query, maxResults = 10) {
  const empty = { items: [], infobox: '' };
  const key = getBraveKey();
  if (!key) return empty;

  const cacheKey = `${query.toLowerCase()}::${maxResults}`;
  const cache = readBraveCache();
  const hit = cache[cacheKey];
  if (hit && Date.now() - hit.t < BRAVE_CACHE_TTL_MS) {
    return { items: hit.items || [], infobox: hit.infobox || '' };
  }

  const count = Math.min(Math.max(5, Number(maxResults) || 10), 20);
  const items = [];
  let infobox = '';

  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&country=ID&text_decorations=false`;
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': key,
        },
      },
      12000
    );

    if (res.ok) {
      const data = await res.json();

      if (Array.isArray(data?.infobox?.results) && data.infobox.results.length > 0) {
        const info = data.infobox.results[0];
        const desc = info.long_desc || info.description || '';
        if (desc) {
          infobox = `${info.title ? `[${info.title}] ` : ''}${desc.replace(/<[^>]+>/g, '').trim()}`;
        }
      }

      for (const r of data?.web?.results || []) {
        if (!r.url || !r.title) continue;
        const domain = extractDomain(r.url);

        if (
          [
            'instagram.com',
            'facebook.com',
            'tiktok.com',
            'pinterest.com',
            'twitter.com',
            'x.com',
            'threads.net',
          ].some((d) => domain.includes(d))
        ) {
          continue;
        }

        let snippet = (r.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (Array.isArray(r.extra_snippets) && r.extra_snippets.length > 0) {
          const extra = r.extra_snippets
            .slice(0, 2)
            .map((s) => s.replace(/<[^>]+>/g, ' ').trim())
            .join(' ');
          if (extra) snippet += ` ${extra}`;
        }

        items.push({
          title: r.title.replace(/<[^>]+>/g, '').trim(),
          url: r.url,
          sourceUrl: r.url,
          domain,
          siteName: r.profile?.name || domain,
          snippet: snippet.slice(0, 450),
          pageAge: r.page_age || r.age || '',
        });
      }
    }
  } catch {}

  if (items.length) {
    cache[cacheKey] = { t: Date.now(), items, infobox };
    writeBraveCache(cache);
  }
  return { items, infobox };
}

// ---------------------------------------------------------------------------
// Relevance helpers (revisi 2026-10)
//   Mesin ini tidak punya API pencarian berbayar, jadi kualitas hasil sangat
//   ditentukan oleh peringkat. Perbaikan: tokenisasi sadar-kata, bobot IDF
//   (kata pembeda lebih berharga daripada kata umum), batas-kata + sufiks
//   Indonesia, bonus kebaruan, keragaman domain, dan pembuangan judul kembar.
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  'dan', 'yang', 'di', 'ke', 'dari', 'untuk', 'dengan', 'ini', 'itu', 'apa', 'ada', 'adalah',
  'pada', 'juga', 'atau', 'akan', 'tidak', 'bukan', 'sudah', 'belum', 'bisa', 'dapat', 'agar',
  'the', 'and', 'for', 'with', 'how', 'what', 'who', 'when', 'where', 'why', 'from', 'that',
  'this', 'are', 'was', 'were', 'you', 'your',
  'info', 'informasi', 'berita', 'news', 'update', 'terbaru', 'terkini', 'hari', 'latest', 'today',
  // kata umum cara/panduan
  'cara', 'caranya', 'tutorial', 'panduan', 'langkah', 'tips', 'guide', 'how', 'what', 'dimana',
  'bagaimana', 'kenapa', 'mengapa', 'sih', 'dong', 'kah',
  // kata waktu (dipakai untuk niat kebaruan, bukan kata isi)
  'januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober',
  'november', 'desember', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'agu', 'ags', 'sep', 'okt', 'nov',
  'des', 'oct', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'jum', 'sabtu', 'minggu', 'tahun', 'bulan',
  'tanggal', 'pukul', 'jam', 'wib', 'wita', 'wit',
]);

// Kata pendek yang tetap bermakna (jangan dibuang walau kurang dari 3 huruf).
const SHORT_TOKENS = new Set([
  'ai', 'ml', 'dl', 'nn', 'nlp', 'ui', 'ux', 'os', 'pc', 'hp', 'tv', 'vr', 'ar', 'iot', 'api',
  'sdk', 'cdn', 'vps', 'ssd', 'hdd', 'gpu', 'cpu', 'ram', 'ip', 'dns', 'db', 'sql', 'css', 'js',
  'ts', '5g', '4g', '6g', '2d', '3d', '4k', '8k', 'ev', 'ppn', 'pbb', 'bi', 'ojk',
]);

const RECENCY_RE =
  /\b(hari ini|terbaru|terkini|saat ini|sekarang|baru saja|besok|kemarin|pekan ini|minggu ini|today|latest|current|now|update)\b|\b20\d{2}\b/i;

function extractTokens(query) {
  const out = [];
  const parts = String(query || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/);
  for (const t of parts) {
    if (!t) continue;
    if (STOPWORDS.has(t)) continue;
    if (/^\d+$/.test(t)) continue; // tahun / nomor versi murni
    if (t.length < 2) continue;
    if (t.length < 3 && !SHORT_TOKENS.has(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

function compileToken(token) {
  const esc = String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Batas-kata + sufiks umum Indonesia/Inggris. "cara" tidak lagi cocok dengan
  // "caramel", sementara "meninggal" tetap cocok dengan "meninggalnya".
  return new RegExp(`(^|[^a-z0-9])${esc}(nya|kan|an|lah|kah|ku|mu|s)?([^a-z0-9]|$)`, 'i');
}

function hasRecencyIntent(rawQuery) {
  return RECENCY_RE.test(String(rawQuery || ''));
}

function titleSignature(title) {
  const stop = new Set(['dan', 'yang', 'di', 'ke', 'dari', 'untuk', 'dengan', 'ini', 'itu', 'the', 'and', 'for', 'with']);
  const set = new Set();
  for (const t of String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)) {
    if (t.length >= 3 && !stop.has(t)) set.add(t);
  }
  return set;
}

function isNearDuplicate(sig, keptSigs, threshold = 0.65) {
  if (!sig.size) return false;
  for (const kept of keptSigs) {
    let inter = 0;
    for (const t of sig) if (kept.has(t)) inter++;
    const union = sig.size + kept.size - inter;
    if (union > 0 && inter / union >= threshold) return true;
  }
  return false;
}

function recencyBonus(item, wantsRecent) {
  if (!wantsRecent) return 0;
  const now = new Date();
  const curYear = String(now.getFullYear());
  const monthsId = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
  const monthsEn = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const hay = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  let bonus = 0;
  if (hay.includes(curYear)) bonus += 0.2;
  const day = now.getDate();
  const mId = monthsId[now.getMonth()];
  const mEn = monthsEn[now.getMonth()];
  if (new RegExp(`(^|[^0-9])${day}([^0-9]|$)`).test(hay) && (hay.includes(mId) || hay.includes(mEn))) {
    bonus += 0.15;
  }
  const oldYear = hay.match(/\b(201[0-9]|202[0-5])\b/g);
  if (oldYear && !hay.includes(curYear)) bonus -= 0.2;
  return bonus;
}

// Peringkat kebaruan 0..3 untuk mengurutkan hasil pada query "hari ini/terbaru".
function freshnessRank(item, wantsRecent) {
  if (!wantsRecent) return 0;
  const now = new Date();
  const curYear = String(now.getFullYear());
  const monthsId = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
  const monthsEn = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const hay = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  if (!hay.includes(curYear)) return 0;
  const mId = monthsId[now.getMonth()];
  const mEn = monthsEn[now.getMonth()];
  const hasMonth = hay.includes(mId) || hay.includes(mEn);
  if (!hasMonth) return 1;
  const day = now.getDate();
  if (new RegExp(`(^|[^0-9])${day}([^0-9]|$)`).test(hay)) return 3;
  for (let d = day - 1; d >= day - 3 && d > 0; d--) {
    if (new RegExp(`(^|[^0-9])${d}([^0-9]|$)`).test(hay)) return 2;
  }
  return 1;
}

async function runMultiSearch(rawQuery, maxResults = 30) {
  const cleanQuery = (rawQuery || '').trim().substring(0, 220);
  const clampedMax = Math.min(Math.max(10, Number(maxResults) || 30), 50);
  const cacheKey = `${cleanQuery.toLowerCase()}::${clampedMax}`;

  if (searchCache.has(cacheKey) && Date.now() - searchCache.get(cacheKey).timestamp < CACHE_TTL_MS) {
    return searchCache.get(cacheKey).payload;
  }

  // Run multiple engines concurrently so we can gather 10 to 50 diverse sources quickly
  const wantsRecentEarly = hasRecencyIntent(cleanQuery);
  const [ddgItems, gnewsIdItems, bingWebItems, bingNewsItems, gnewsEnItems, wikiItems, tavily, brave] =
    await Promise.all([
      searchDuckDuckGoHtml(cleanQuery),
      searchGoogleNewsRss(cleanQuery, 'id', 'ID', 'ID:id'),
      searchBingRss(cleanQuery),
      searchBingNewsRss(cleanQuery),
      searchGoogleNewsRss(cleanQuery, 'en-US', 'US', 'US:en'),
      searchWikipedia(cleanQuery),
      searchTavily(cleanQuery, clampedMax, wantsRecentEarly),
      searchBrave(cleanQuery, clampedMax),
    ]);
  const tavilyItems = tavily.items || [];
  const tavilyAnswer = tavily.answer || '';
  const braveItems = brave.items || [];
  const braveInfobox = brave.infobox || '';

  // --- Peringkat relevansi ------------------------------------------------
  const wantsRecent = hasRecencyIntent(cleanQuery);
  const tokens = extractTokens(cleanQuery);
  const matchers = new Map(tokens.map((t) => [t, compileToken(t)]));

  const engines = [
    { items: braveItems, base: 4.5, kind: 'web', trusted: true },
    { items: tavilyItems, base: 4.0, kind: 'web', trusted: true },
    { items: gnewsIdItems, base: 3.0, kind: 'news' },
    { items: bingNewsItems, base: 2.0, kind: 'news' },
    { items: gnewsEnItems, base: 1.6, kind: 'news' },
    { items: wikiItems, base: 2.0, kind: 'web' },
    { items: bingWebItems, base: 1.6, kind: 'web' },
    { items: ddgItems, base: 1.2, kind: 'web' },
  ];

  const allItems = [];
  for (const eng of engines) allItems.push(...eng.items);

  // IDF: kata yang jarang muncul di kandidat lebih menentukan relevansi.
  const N = allItems.length || 1;
  const df = new Map(tokens.map((t) => [t, 0]));
  for (const it of allItems) {
    const hay = `${it.title} ${it.snippet || ''} ${it.domain || ''}`.toLowerCase();
    for (const t of tokens) {
      if (df.get(t) === 0 && matchers.get(t).test(hay)) df.set(t, df.get(t) + 1);
    }
  }
  const idf = new Map(tokens.map((t) => [t, Math.log(1 + N / (1 + df.get(t)))]));
  const totalIdf = tokens.reduce((s, t) => s + idf.get(t), 0) || 1;

  // Dua tingkat cakupan: judul (sinyal kuat) dan teks lengkap.
  const titleCoverage = (item) => {
    if (!tokens.length) return 1;
    const hay = `${item.title} ${item.domain || ''}`.toLowerCase();
    let hit = 0;
    for (const t of tokens) if (matchers.get(t).test(hay)) hit += idf.get(t);
    return hit / totalIdf;
  };
  const coverage = (item) => {
    if (!tokens.length) return 1;
    const hay = `${item.title} ${item.snippet || ''} ${item.domain || ''}`.toLowerCase();
    let hit = 0;
    for (const t of tokens) if (matchers.get(t).test(hay)) hit += idf.get(t);
    return hit / totalIdf;
  };
  const blend = (item) => 0.65 * titleCoverage(item) + 0.35 * coverage(item);

  const rankedBy = [...tokens].sort((a, b) => idf.get(b) - idf.get(a));
  const topToken = rankedBy[0];
  const hayOf = (item) => `${item.title} ${item.snippet || ''} ${item.domain || ''}`.toLowerCase();
  const isWiki = (item) => /(^|\.)wikipedia\.org$/i.test(item.domain || '');
  const countMatched = (item) => {
    const hay = hayOf(item);
    let n = 0;
    for (const t of tokens) if (matchers.get(t).test(hay)) n++;
    return n;
  };
  const matchesTop = (item) => !topToken || matchers.get(topToken).test(hayOf(item));

  // Query berita/kebaruan -> utamakan kanal berita; query umum -> utamakan web.
  const newsMul = wantsRecent ? 1.25 : 0.8;
  const webMul = wantsRecent ? 0.8 : 1.3;

  const scored = [];
  for (const eng of engines) {
    const w = eng.base * (eng.kind === 'news' ? newsMul : webMul);
    eng.items.forEach((item, pos) => {
      scored.push({
        item,
        titleCov: titleCoverage(item),
        cov: blend(item),
        wiki: isWiki(item),
        trusted: !!eng.trusted,
        fresh: freshnessRank(item, wantsRecent),
        score: w * (0.4 + blend(item)) - pos * 0.03 + recencyBonus(item, wantsRecent),
      });
    });
  }

  // Wikipedia dkk. sering mengembalikan artikel yang hanya "nyerempet" kata
  // kunci lewat isi artikel (mis. "Nasi kari", "Muse Spark"), jadi judulnya
  // wajib menyentuh query.
  const notWikiJunk = (s) => !s.wiki || s.titleCov > 0;

  const minHit = tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length / 2);
  const requireTitleHit = tokens.length === 1;
  // Hasil Tavily "trusted": selalu lolos filter kata kunci (mesin pencari penuh).
  let pool = scored.filter(
    (s) =>
      s.trusted ||
      (notWikiJunk(s) &&
        s.cov >= 0.35 &&
        countMatched(s.item) >= minHit &&
        matchesTop(s.item) &&
        (!requireTitleHit || s.titleCov > 0))
  );
  if (pool.length < 5) {
    pool = scored.filter((s) => s.trusted || (notWikiJunk(s) && s.cov > 0.15 && matchesTop(s.item)));
  }
  if (pool.length === 0) {
    pool = scored.filter((s) => s.trusted || (notWikiJunk(s) && s.titleCov > 0 && matchesTop(s.item)));
  }
  if (pool.length === 0) pool = scored.filter((s) => s.trusted || (notWikiJunk(s) && s.titleCov > 0));
  pool.sort((a, b) => {
    // 1. Tavily (trusted) selalu diprioritaskan di posisi teratas
    const t = (b.trusted ? 1 : 0) - (a.trusted ? 1 : 0);
    if (t !== 0) return t;

    // 2. Jika sama-sama trusted atau sama-sama fallback, cek kebaruan bila diminta
    if (wantsRecent && b.fresh !== a.fresh) {
      return b.fresh - a.fresh;
    }

    // 3. Peringkat skor relevansi umum
    return b.score - a.score;
  });
  const combined = pool.map((s) => s.item);

  // --- Dedup + keragaman sumber ------------------------------------------
  const MAX_PER_DOMAIN = 2;
  const stripSourceSuffix = (t) => String(t || '').replace(/\s[-–—|]\s[-–—|]{0,1}[^-–—|]{2,45}$/, '').trim();
  const seenUrls = new Set();
  const seenTitles = new Set();
  const domainCount = new Map();
  const keptSigs = [];
  const spill = [];
  const finalSources = [];

  const pushSource = (item, domain) => {
    finalSources.push({
      index: finalSources.length + 1,
      title: item.title,
      url: item.url,
      sourceUrl: item.sourceUrl || item.url,
      domain,
      siteName: item.siteName || domain,
      favicon: getFaviconUrl(domain),
      snippet: item.snippet || '(Tersedia di halaman sumber)',
    });
  };

  for (const item of combined) {
    if (!item.url || !item.title) continue;
    const normUrl = item.url.replace(/\/$/, '').toLowerCase();
    const baseTitle = stripSourceSuffix(item.title);
    const normTitle = baseTitle.toLowerCase().substring(0, 70);
    if (seenUrls.has(normUrl) || seenTitles.has(normTitle)) continue;
    const domain = item.domain || extractDomain(item.sourceUrl || item.url);
    const sig = titleSignature(baseTitle);
    if (isNearDuplicate(sig, keptSigs)) continue;
    if ((domainCount.get(domain) || 0) >= MAX_PER_DOMAIN) {
      spill.push({ item, domain, normUrl, normTitle });
      continue;
    }
    seenUrls.add(normUrl);
    seenTitles.add(normTitle);
    domainCount.set(domain, (domainCount.get(domain) || 0) + 1);
    if (sig.size) keptSigs.push(sig);
    pushSource(item, domain);
    if (finalSources.length >= clampedMax) break;
  }

  // Bila hasil belum cukup, izinkan domain yang sama tampil lagi (maks 4).
  if (finalSources.length < clampedMax) {
    for (const s of spill) {
      if (finalSources.length >= clampedMax) break;
      if (seenUrls.has(s.normUrl) || seenTitles.has(s.normTitle)) continue;
      if ((domainCount.get(s.domain) || 0) >= 4) continue;
      seenUrls.add(s.normUrl);
      seenTitles.add(s.normTitle);
      domainCount.set(s.domain, (domainCount.get(s.domain) || 0) + 1);
      pushSource(s.item, s.domain);
    }
  }

  if (finalSources.length === 0) {
    return {
      success: false,
      sources: [],
      text: `Tidak ada hasil relevan dari internet untuk kata kunci: "${cleanQuery}".`,
    };
  }

  let formattedText = finalSources
    .map(
      (s) =>
        `${s.index}. [${s.title}] (${s.siteName} — ${s.domain})\n   URL: ${s.url}\n   Ringkasan: ${s.snippet}`
    )
    .join('\n\n');

  if (braveInfobox) {
    formattedText = `INFO KUNCI (Brave): ${braveInfobox}\n\n${formattedText}`;
  }

  if (tavilyAnswer) {
    formattedText = `RINGKASAN (Tavily): ${tavilyAnswer}\n\n${formattedText}`;
  }

  if (finalSources.length < 5) {
    formattedText +=
      `\n\nCATATAN: hanya ${finalSources.length} sumber relevan ditemukan untuk kata kunci ini. ` +
      'Jika dirasa kurang, coba lagi dengan kata kunci lebih spesifik atau tambahkan istilah teknis/nama situs resmi.';
  }

  const payload = {
    success: true,
    query: cleanQuery,
    count: finalSources.length,
    sources: finalSources,
    text: formattedText,
  };

  searchCache.set(cacheKey, { timestamp: Date.now(), payload });
  return payload;
}

async function main() {
  const args = process.argv.slice(2);
  let maxResults = 30;
  let queryParts = args;

  // Check if last argument is --max=N or pipe syntax "query | 40"
  const rawJoined = queryParts.join(' ');
  let cleanQuery = rawJoined;
  const pipeMatch = rawJoined.match(/^(.*?)\|\s*(\d{1,2})\s*$/);
  if (pipeMatch) {
    cleanQuery = pipeMatch[1].trim();
    maxResults = parseInt(pipeMatch[2], 10);
  }

  if (!cleanQuery) {
    process.stdout.write(JSON.stringify({ success: false, sources: [], text: 'No query provided' }) + '\n');
    process.exit(1);
  }

  console.log = console.warn = console.info = console.error = function () {
    process.stderr.write(Array.from(arguments).join(' ') + '\n');
  };

  try {
    const result = await runMultiSearch(cleanQuery, maxResults);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(0);
  } catch (err) {
    process.stdout.write(
      JSON.stringify({ success: false, sources: [], text: `Error: ${err.message}` }) + '\n'
    );
    process.exit(1);
  }
}

main();
