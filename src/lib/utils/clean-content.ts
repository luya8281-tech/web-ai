import { ActionInfo } from '@/types/chat';

export const TOOL_NAMES = 'CARI_WEB|BUKA_WEB|SCREENSHOT_WEB|RUN_BASH|BACA_SKILL|RUN_PYTHON|INSTALL_SKILL|SIMPAN_MEMORI|RINGKAS_YOUTUBE|BUAT_PDF|BACA_OCR';

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

// Scan one line for the closing bracket. Brackets inside quotes are ignored,
// but only when the quotes on that line balance (so prose like "don't" still works).
function scanLine(line: string, depth: number, useQuotes: boolean): { depth: number; closeAt: number; openQuote: boolean } {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (useQuotes) {
      if (quote) {
        if (ch === '\\') { i++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
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
  const openRe = new RegExp(`\\[(${names}):`, 'gi');
  const tags: ParsedToolTag[] = [];
  let m: RegExpExecArray | null;

  while ((m = openRe.exec(text)) !== null) {
    const start = m.index;
    const bodyStart = start + m[0].length;
    let depth = 1;
    let end = -1;
    let pos = bodyStart;

    while (pos <= text.length && end === -1) {
      const nl = text.indexOf('\n', pos);
      const lineEnd = nl === -1 ? text.length : nl;
      const line = text.substring(pos, lineEnd);
      let res = scanLine(line, depth, true);
      if (res.closeAt === -1 && res.openQuote) res = scanLine(line, depth, false);
      if (res.closeAt !== -1) {
        end = pos + res.closeAt + 1;
        break;
      }
      depth = res.depth;
      if (nl === -1) break;
      pos = nl + 1;
    }

    const closed = end !== -1;
    if (!closed) {
      openRe.lastIndex = bodyStart;
      const next = openRe.exec(text);
      end = next ? next.index : text.length;
    }

    const rawParam = text.substring(bodyStart, closed ? end - 1 : end);
    tags.push({ type: m[1].toUpperCase(), param: rawParam.trim(), start, end, closed });
    openRe.lastIndex = end;
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

export function cleanMessageContent(text: string, isLive = false): string {
  if (!text) return '';
  let cleaned = stripToolTags(text.replace(/\[\/?BALASAN_AKHIR\]/gi, ''))
    .replace(/\[TOOL RESULTS\]:[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, '')
    .replace(/(?:TOOL OUTPUT|BASH OUTPUT|SKILL CONTENT|PYTHON OUTPUT):?[\s\S]*?(?=\n\n|$)/gi, '')
    .replace(/\*⚡ Executing tools\.\.\.\*/gi, '')
    .replace(/\n{3,}/g, '\n\n');

  if (isLive) {
    // Hide trailing partial tag while live streaming (e.g. "[RUN_BASH: ..." while model is typing)
    cleaned = cleaned.replace(new RegExp(`\\s*\\[\\/?(?:${TOOL_NAMES}|[A-Z_]+)[^\\]]*$`, 'i'), '');
  }

  return cleaned.trim();
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
    if (type === 'RUN_BASH') label = `Perintah server: ${firstLine.substring(0, 45)}`;
    else if (type === 'BUKA_WEB') label = `Membuka web: ${firstLine.substring(0, 45)}`;
    else if (type === 'SCREENSHOT_WEB') label = `Tangkapan layar: ${firstLine.substring(0, 45)}`;
    else if (type === 'CARI_WEB') label = `Mencari informasi: "${firstLine.substring(0, 45)}"`;
    else if (type === 'RUN_PYTHON') label = `Analisis Python: ${firstLine.substring(0, 45)}`;
    else if (type === 'BACA_SKILL') label = `Membaca modul keahlian: ${firstLine.substring(0, 45)}`;
    else if (type === 'INSTALL_SKILL') label = `Menginstal modul baru`;

    const textBefore = cleanMessageContent(content.substring(lastIndex, tag.start), false);
    list.push({
      id: `tag_${tag.start}`,
      type,
      label,
      status: 'done',
      details: param,
      textBefore: textBefore || undefined,
    });
    lastIndex = tag.end;
  }
  return list;
}
