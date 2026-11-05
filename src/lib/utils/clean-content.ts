import { ActionInfo, SearchSource } from '@/types/chat';

import { stripDsml } from './dsml';

export const TOOL_NAMES =
  'CARI_WEB|BUKA_WEB|SCREENSHOT_WEB|CEK_CUACA|RUN_BASH|BACA_SKILL|RUN_PYTHON|INSTALL_SKILL|SIMPAN_MEMORI|CATAT_PELAJARAN|CEK_KESEHATAN_PROYEK|RINGKAS_YOUTUBE|BUAT_PDF|BUAT_FILE|BACA_OCR|AMBIL_SUBTITEL|AMBIL_HALAMAN|BROWSER|BACA_SESI_KERJA|BACA_FILE|EDIT_FILE|MCP|CLI';

export const ACTION_TAG_REGEX = new RegExp(
  `\\[(${TOOL_NAMES}):\\s*([\\s\\S]*?)(?:\\](?![\\:;,)_a-zA-Z0-9\\"\\'])|(?=\\s*\\[(?:${TOOL_NAMES}):)|$)`,
  'gi'
);

export interface ParsedToolTag {
  type: string;
  param: string;
  start: number;
  end: number;
  closed: boolean;
}

export interface InteractivePermission {
  id: string;
  title: string;
  description: string;
  approvePrompt: string;
  denyPrompt: string;
}

// Scan one line for the closing bracket. Brackets inside quotes are ignored,
// but only when the quotes on that line balance (so prose like "don't" still works).
function scanLine(
  line: string,
  depth: number,
  useQuotes: boolean
): { depth: number; closeAt: number; openQuote: boolean } {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (useQuotes) {
      if (quote) {
        if (ch === '\\') {
          i++;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        continue;
      }
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return { depth, closeAt: i, openQuote: false };
    }
  }
  return { depth, closeAt: -1, openQuote: quote !== null };
}

/**
 * Parse [TOOL: ...] tags by bracket depth instead of a lookahead regex, so params
 * containing code (d['a'][0], heredocs, arrays) are captured in full.
 * Unclosed tags run until the next tool tag or end of text.
 */
export function parseToolTags(text: string, names: string = TOOL_NAMES): ParsedToolTag[] {
  if (!text) return [];
  const headRe = new RegExp(`^\\[(${names}):`, 'i');
  const nextTokenRe = /[`\[]/g;
  const tags: ParsedToolTag[] = [];
  let pos = 0;

  while (pos < text.length) {
    nextTokenRe.lastIndex = pos;
    const tok = nextTokenRe.exec(text);
    if (!tok) break;
    pos = tok.index;

    // 1. Skip fenced code blocks ``` ... ``` outside tool tags
    if (text.startsWith('```', pos)) {
      const closeFence = text.indexOf('```', pos + 3);
      if (closeFence !== -1) {
        pos = closeFence + 3;
        continue;
      } else {
        break;
      }
    }

    // 2. Skip inline code spans ` ... ` (on the same line) outside tool tags
    if (text[pos] === '`') {
      const nl = text.indexOf('\n', pos + 1);
      const lineLimit = nl === -1 ? text.length : nl;
      const closeTick = text.indexOf('`', pos + 1);
      if (closeTick !== -1 && closeTick < lineLimit) {
        pos = closeTick + 1;
        continue;
      }
      pos++;
      continue;
    }

    // 3. Check if '[' starts a valid [TOOL_NAME: tag
    const m = headRe.exec(text.substring(pos));
    if (!m) {
      pos++;
      continue;
    }

    const start = pos;
    const bodyStart = start + m[0].length;
    let depth = 1;
    let end = -1;
    let scanPos = bodyStart;

    while (scanPos <= text.length && end === -1) {
      const nl = text.indexOf('\n', scanPos);
      const lineEnd = nl === -1 ? text.length : nl;
      const line = text.substring(scanPos, lineEnd);
      let res = scanLine(line, depth, true);
      if (res.closeAt === -1 && res.openQuote) res = scanLine(line, depth, false);
      if (res.closeAt !== -1) {
        end = scanPos + res.closeAt + 1;
        break;
      }
      depth = res.depth;
      if (nl === -1) break;
      scanPos = nl + 1;
    }

    const closed = end !== -1;
    if (!closed) {
      const nextOpenRe = new RegExp(`\\[(${names}):`, 'gi');
      nextOpenRe.lastIndex = bodyStart;
      const next = nextOpenRe.exec(text);
      end = next ? next.index : text.length;
    }

    const rawParam = text.substring(bodyStart, closed ? end - 1 : end);
    tags.push({ type: m[1].toUpperCase(), param: rawParam.trim(), start, end, closed });
    pos = end;
  }
  return tags;
}

export function stripToolTags(text: string, names: string = TOOL_NAMES): string {
  const tags = parseToolTags(text, names);
  if (tags.length === 0) return text;
  let out = '';
  let last = 0;
  for (const t of tags) {
    out += text.substring(last, t.start);
    last = t.end;
  }
  return out + text.substring(last);
}

export const MEDIA_TAG_NAMES =
  'KIRIM_FILE|KIRIM_DOKUMEN|KIRIM_VIDEO|KIRIM_GAMBAR|KIRIM_AUDIO|KIRIM_STIKER';

export interface InlineMediaItem {
  id: string;
  kind: 'video' | 'image' | 'audio' | 'file';
  url: string;
  caption?: string;
  filename: string;
  ext: string;
}

const DEAD_MEDIA_URL_REGEX =
  /https?:\/\/(?:ai\.beritadetik\.my\.id|vee2\.my\.id)\/(?:media|screenshots|share)\/([A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,10})/gi;

function classifyFileKind(filename: string, tagType?: string): InlineMediaItem['kind'] {
  if (tagType === 'KIRIM_VIDEO' || /\.(mp4|webm|mov|mkv)$/i.test(filename)) return 'video';
  if (
    tagType === 'KIRIM_GAMBAR' ||
    tagType === 'KIRIM_STIKER' ||
    /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(filename)
  ) {
    return 'image';
  }
  if (tagType === 'KIRIM_AUDIO' || /\.(mp3|ogg|wav|m4a|flac|aac)$/i.test(filename)) return 'audio';
  return 'file';
}

export function normalizeMediaUrl(rawPathOrUrl: string): { url: string; filename: string } | null {
  const clean = (rawPathOrUrl || '').trim().replace(/^['"`]+|['"`]+$/g, '');
  if (!clean) return null;

  // 1. Dead domain URL -> rewrite to local /api/browser-shots/<filename>
  const deadMatch = clean.match(
    /^https?:\/\/(?:ai\.beritadetik\.my\.id|vee2\.my\.id)\/(?:media|screenshots|share)\/([A-Za-z0-9_.-]+)$/i
  );
  if (deadMatch) {
    const fname = deadMatch[1];
    return { url: `/api/browser-shots/${encodeURIComponent(fname)}`, filename: fname };
  }

  // 2. Already /api/browser-shots/<filename>
  const apiMatch = clean.match(/^\/api\/browser-shots\/([^?#\s)]+)/i);
  if (apiMatch) {
    const fname = decodeURIComponent(apiMatch[1]);
    return { url: `/api/browser-shots/${encodeURIComponent(fname)}`, filename: fname };
  }

  // 3. Public HTTP(S) URL
  if (/^https?:\/\//i.test(clean)) {
    const parts = clean.split('?')[0].split('/');
    const fname = parts[parts.length - 1] || 'berkas';
    return { url: clean, filename: fname };
  }

  // 4. Any local server filename or path with an extension (.lua, .xlsx, .docx, .txt, .mp4, .mp3, .pdf, .csv, etc.)
  const rawBase = clean.split('/').pop() || '';
  const base = rawBase.replace(/[^A-Za-z0-9_.\- ()[\]]+/g, '_').replace(/^_+/, '');
  if (/^[A-Za-z0-9_.\- ()[\]]+\.[A-Za-z0-9]{1,10}$/i.test(base)) {
    return { url: `/api/browser-shots/${encodeURIComponent(base)}`, filename: base };
  }

  return null;
}

export function extractInlineMedia(content: string): InlineMediaItem[] {
  if (!content) return [];
  const items: InlineMediaItem[] = [];
  const seenUrls = new Set<string>();

  // 1. Extract from [KIRIM_FILE: path | caption], [KIRIM_DOKUMEN: ...], [KIRIM_VIDEO: ...], [KIRIM_AUDIO: ...], [KIRIM_GAMBAR: ...]
  const tags = parseToolTags(content, `${MEDIA_TAG_NAMES}|BUAT_FILE|BUAT_PDF`);
  tags.forEach((tag, idx) => {
    const parts = tag.param.split('|').map((s) => s.trim());
    let rawTarget = parts[0] || '';
    let caption = parts.slice(1).join(' | ').trim() || undefined;

    if (tag.type === 'BUAT_PDF') {
      rawTarget = parts[1] || parts[0] || 'dokumen.pdf';
      if (!/\.pdf$/i.test(rawTarget)) rawTarget += '.pdf';
      caption = `Dokumen PDF (${rawTarget})`;
    } else if (tag.type === 'BUAT_FILE') {
      rawTarget = parts[0] || '';
      caption = `Berkas ${rawTarget}`;
    }

    const norm = normalizeMediaUrl(rawTarget);
    if (!norm || seenUrls.has(norm.url)) return;
    seenUrls.add(norm.url);

    const extMatch = norm.filename.match(/\.([A-Za-z0-9]{1,10})$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'file';

    items.push({
      id: `media_tag_${idx}_${tag.start}`,
      kind: classifyFileKind(norm.filename, tag.type),
      url: norm.url,
      caption,
      filename: norm.filename,
      ext,
    });
  });

  // 2. Also detect any direct /api/browser-shots/<filename.ext> or dead-domain <filename.ext> links in text
  const linkRe =
    /(?:https?:\/\/(?:ai\.beritadetik\.my\.id|vee2\.my\.id)\/(?:media|screenshots|share)\/|\/api\/browser-shots\/)([A-Za-z0-9_.\-%]+\.[A-Za-z0-9]{1,10})/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(content)) !== null) {
    const fname = decodeURIComponent(m[1]);
    // Skip browser auto-screenshots from appearing twice if already in action cards
    if (/^shot_\d+_/i.test(fname)) continue;
    const url = `/api/browser-shots/${encodeURIComponent(fname)}`;
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      const extMatch = fname.match(/\.([A-Za-z0-9]{1,10})$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'file';
      items.push({
        id: `media_link_${m.index}`,
        kind: classifyFileKind(fname),
        url,
        caption: fname,
        filename: fname,
        ext,
      });
    }
  }

  return items;
}


/**
 * Buang token kontrol internal model yang kadang bocor ke teks
 * (mis. <budget:token_budget200000>, </budget:token_budget>, <|im_end|>, [INST]).
 * Sengaja hanya menyasar nama namespace internal agar HTML/XML di blok kode aman.
 */
export function stripInternalMarkers(text: string): string {
  if (!text) return '';
  return stripDsml(text)
    .replace(/<[\s/]*(?:budget|token_budget|context|system|internal|meta)[\s:][^>]{0,160}>/gi, '')
    .replace(/\bbudget\s*:\s*token_budget\s*\d*/gi, '')
    .replace(/\btoken_budget\s*\d+/gi, '')
    .replace(/<\|[^|<>]{0,40}\|>/g, '')
    .replace(/\[\/?INST\]/gi, '')
    .replace(/<\/?(?:antml:|[^<>a-zA-Z])?(?:parameter|invoke|function_calls|function|tool_call)[^>]*>/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function cleanMessageContent(text: string, isLive = false): string {
  if (!text) return '';
  let cleaned = stripToolTags(
    text.replace(/\[\/?BALASAN_AKHIR\]/gi, ''),
    `${TOOL_NAMES}|${MEDIA_TAG_NAMES}|CATAT_TUGAS|SELESAI_TUGAS|IZIN|PILIHAN|QUEST`
  )
    .replace(/\[\s*BACA_SESI_KERJA\s*\]/gi, '')
    .replace(/\[FAKTA UI\s*&\s*AKSI PESAN INI:[\s\S]*?(?:\]|$)/gi, '')
    .replace(DEAD_MEDIA_URL_REGEX, '/api/browser-shots/$1')
    .replace(/\[TOOL RESULTS\]:[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, '')
    .replace(/(?:TOOL OUTPUT|BASH OUTPUT|SKILL CONTENT|PYTHON OUTPUT):?[\s\S]*?(?=\n\n|$)/gi, '')
    .replace(/\*⚡ Executing tools\.\.\.\*/gi, '')
    .replace(/\n{3,}/g, '\n\n');

  cleaned = stripInternalMarkers(cleaned);

  if (isLive) {
    cleaned = cleaned.replace(
      new RegExp(`\\s*\\[\\/?(?:${TOOL_NAMES}|${MEDIA_TAG_NAMES}|IZIN|PILIHAN|QUEST|FAKTA UI|[A-Z_]+)[^\\]]*$`),
      ''
    );
    // Potong tag XML tool-call yang belum selesai ditulis (live stream).
    cleaned = cleaned.replace(
      /\s*<[/]?(?:antml:|[^<>a-zA-Z])?(?:parameter|invoke|function(?:_calls)?|tool_call)[^>]*$/,
      ''
    );
  }

  return cleaned.trim();
}

export const INTERNAL_EXEC_TOOL_NAMES =
  'CARI_WEB|BUKA_WEB|SCREENSHOT_WEB|CEK_CUACA|RUN_BASH|BACA_SKILL|RUN_PYTHON|INSTALL_SKILL|SIMPAN_MEMORI|CATAT_PELAJARAN|CEK_KESEHATAN_PROYEK|RINGKAS_YOUTUBE|BUAT_PDF|BUAT_FILE|BACA_OCR|AMBIL_SUBTITEL|AMBIL_HALAMAN|BROWSER|BACA_SESI_KERJA|BACA_FILE|EDIT_FILE|CATAT_TUGAS|SELESAI_TUGAS|MCP|CLI';

/**
 * Membersihkan sisa tag tool internal di sisi server SEBELUM disimpan ke DB / dikirim
 * pada final-cleanup, TANPA menghapus tag kartu UI ([KIRIM_FILE], [KIRIM_AUDIO],
 * [KIRIM_VIDEO], [KIRIM_GAMBAR], [KIRIM_DOKUMEN], [IZIN], [PILIHAN], [QUEST]).
 * Komponen MessageItem di frontend membutuhkan tag kartu UI tersebut untuk merender
 * UniversalFileCard / kartu izin / tombol pilihan.
 */
export function cleanServerFinalContent(text: string): string {
  if (!text) return '';
  return stripInternalMarkers(stripToolTags(
    text.replace(/\[\/?BALASAN_AKHIR\]/gi, ''),
    INTERNAL_EXEC_TOOL_NAMES
  )
    .replace(/\[\s*BACA_SESI_KERJA\s*\]/gi, '')
    .replace(/\[FAKTA UI\s*&\s*AKSI PESAN INI:[\s\S]*?(?:\]|$)/gi, '')
    .replace(DEAD_MEDIA_URL_REGEX, '/api/browser-shots/$1')
    .replace(/\[TOOL RESULTS\]:[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, '')
    .replace(/(?:TOOL OUTPUT|BASH OUTPUT|SKILL CONTENT|PYTHON OUTPUT):?[\s\S]*?(?=\n\n|$)/gi, '')
    .replace(/\*⚡ Executing tools\.\.\.\*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim());
}

export function extractInteractivePermissions(content: string): InteractivePermission[] {
  if (!content) return [];
  const results: InteractivePermission[] = [];
  const tags = parseToolTags(content, 'IZIN');
  tags.forEach((tag, idx) => {
    const parts = tag.param.split('|').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 1) {
      results.push({
        id: `perm_${idx}_${tag.start}`,
        title: parts[0] || 'Permintaan Izin Eksekusi',
        description:
          parts[1] ||
          'Agen AI meminta persetujuan Anda sebelum menjalankan tindakan sensitif ini.',
        approvePrompt: parts[2] || 'Ya, setuju. Silakan lanjutkan tindakan tersebut.',
        denyPrompt: 'Jangan, batalkan tindakan tersebut.',
      });
    }
  });

  // Catatan: heuristik "tebak izin dari kalimat basa-basi" sudah dihapus.
  // Kartu izin hanya muncul dari tag [IZIN: ...] yang eksplisit, sehingga
  // pertanyaan retoris ("boleh saya bantu?") tidak lagi memicu persetujuan palsu.

  // Dedupe berdasarkan judul: satu tindakan = satu kartu.
  const seenTitles = new Set<string>();
  return results
    .filter((perm) => {
      const key = perm.title.trim().toLowerCase();
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    })
    .slice(0, 2);
}

export function extractInteractiveChoices(content: string): string[] {
  if (!content) return [];
  const choices: string[] = [];
  const tags = parseToolTags(content, 'PILIHAN|QUEST');
  for (const tag of tags) {
    const parts = tag.param
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 110);
    for (const p of parts) {
      if (!choices.includes(p)) choices.push(p);
    }
  }
  return choices.slice(0, 6);
}

export function extractSourcesFromAction(action: ActionInfo): SearchSource[] {
  if (action.sources && action.sources.length > 0) {
    return action.sources;
  }
  const sources: SearchSource[] = [];
  const raw = action.details || action.output || '';
  if (!raw) return sources;

  // Parse URLs from formatted search results or browse outputs
  const urlRe = /https?:\/\/[^\s<>"'{}|\\^`[\])]+/gi;
  const seen = new Set<string>();
  const lines = raw.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matches = line.match(urlRe);
    if (!matches) continue;
    for (const rawUrl of matches) {
      const cleanUrl = rawUrl.replace(/[.,;)]+$/, '');
      if (seen.has(cleanUrl)) continue;
      seen.add(cleanUrl);
      let domain = 'web';
      try {
        domain = new URL(cleanUrl).hostname.replace(/^www\./i, '');
      } catch {}
      const prevLine = (lines[i - 1] || '').replace(/^\d+\.\s*\[?|\]$/g, '').trim();
      const nextLine = (lines[i + 1] || '').replace(/^\s*Ringkasan:\s*/i, '').trim();
      sources.push({
        index: sources.length + 1,
        title: prevLine && !prevLine.startsWith('http') ? prevLine : domain,
        url: cleanUrl,
        sourceUrl: cleanUrl,
        domain,
        siteName: domain,
        favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
        snippet: nextLine || undefined,
      });
    }
  }
  return sources;
}

export function extractActionsFromText(content: string): ActionInfo[] {
  if (!content) return [];
  const list: ActionInfo[] = [];
  let lastIndex = 0;

  for (const tag of parseToolTags(content)) {
    const type = tag.type;
    const param = tag.param;
    const firstLine = param.split('\n')[0].trim();
    let label = `Aksi server: ${type}`;
    if (type === 'RUN_BASH') label = `Perintah server: ${firstLine.substring(0, 60)}`;
    else if (type === 'BUKA_WEB') label = `Membuka web: ${firstLine.substring(0, 60)}`;
    else if (type === 'SCREENSHOT_WEB') label = `Tangkapan layar: ${firstLine.substring(0, 60)}`;
    else if (type === 'CARI_WEB') label = `Mencari informasi: "${firstLine.substring(0, 60)}"`;
    else if (type === 'CEK_CUACA') label = `Mengecek cuaca: ${firstLine.substring(0, 60)}`;
    else if (type === 'RUN_PYTHON') label = `Analisis Python: ${firstLine.substring(0, 60)}`;
    else if (type === 'BACA_SKILL') label = `Membaca modul keahlian: ${firstLine.substring(0, 60)}`;
    else if (type === 'INSTALL_SKILL') label = `Menginstal modul baru`;
    else if (type === 'BUAT_FILE') label = `Membuat berkas: ${firstLine.split('|')[0].trim().substring(0, 50)}`;
    else if (type === 'BUAT_PDF') label = `Membuat dokumen PDF`;
    else if (type === 'CATAT_PELAJARAN') label = `Mencatat pembelajaran: ${firstLine.split('|')[0].trim().substring(0, 50)}`;
    else if (type === 'CEK_KESEHATAN_PROYEK') label = `Diagnostik kesehatan proyek: ${firstLine.substring(0, 50)}`;

    const textBefore = cleanMessageContent(content.substring(lastIndex, tag.start), false);
    list.push({
      id: `tag_${tag.start}`,
      type,
      label,
      status: 'done',
      details: param,
      command: type === 'RUN_BASH' || type === 'RUN_PYTHON' ? param : undefined,
      url: type === 'BUKA_WEB' || type === 'SCREENSHOT_WEB' ? param : undefined,
      textBefore: textBefore || undefined,
    });
    lastIndex = tag.end;
  }
  return list;
}
