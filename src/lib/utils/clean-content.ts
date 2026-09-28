import { ActionInfo } from '@/types/chat';

export const TOOL_NAMES = 'CARI_WEB|BUKA_WEB|SCREENSHOT_WEB|RUN_BASH|BACA_SKILL|RUN_PYTHON|INSTALL_SKILL|SIMPAN_MEMORI|RINGKAS_YOUTUBE|BUAT_PDF|BACA_OCR';

export const ACTION_TAG_REGEX = new RegExp(
  `\\[(${TOOL_NAMES}):\\s*([\\s\\S]*?)(?:\\](?![\\:;,)_a-zA-Z0-9\\"\\'])|(?=\\s*\\[(?:${TOOL_NAMES}):)|$)`,
  'gi'
);

export function cleanMessageContent(text: string, isLive = false): string {
  if (!text) return '';
  let cleaned = text
    .replace(/\[\/?BALASAN_AKHIR\]/gi, '')
    .replace(new RegExp(`\\[(?:${TOOL_NAMES}):[\\s\\S]*?(?:\\](?![\\:;,)_a-zA-Z0-9\\"\\'])|(?=\\s*\\[(?:${TOOL_NAMES}):)|$)`, 'gi'), '')
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
  ACTION_TAG_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  let lastIndex = 0;

  while ((m = ACTION_TAG_REGEX.exec(content)) !== null) {
    const type = m[1].toUpperCase();
    const param = m[2].trim();
    const firstLine = param.split('\n')[0].trim();
    let label = `Aksi server: ${type}`;
    if (type === 'RUN_BASH') label = `Perintah server: ${firstLine.substring(0, 45)}`;
    else if (type === 'BUKA_WEB') label = `Membuka web: ${firstLine.substring(0, 45)}`;
    else if (type === 'SCREENSHOT_WEB') label = `Tangkapan layar: ${firstLine.substring(0, 45)}`;
    else if (type === 'CARI_WEB') label = `Mencari informasi: "${firstLine.substring(0, 45)}"`;
    else if (type === 'RUN_PYTHON') label = `Analisis Python: ${firstLine.substring(0, 45)}`;
    else if (type === 'BACA_SKILL') label = `Membaca modul keahlian: ${firstLine.substring(0, 45)}`;
    else if (type === 'INSTALL_SKILL') label = `Menginstal modul baru`;

    const textBefore = cleanMessageContent(content.substring(lastIndex, m.index), false);
    list.push({
      id: `tag_${m.index}`,
      type,
      label,
      status: 'done',
      details: param,
      textBefore: textBefore || undefined,
    });
    lastIndex = m.index + m[0].length;
  }
  return list;
}
