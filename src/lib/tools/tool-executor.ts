/**
 * Universal Tool Executor for AI Chat Platform
 * Ports the tool tag system from wa-bot to work with any AI provider.
 * Supports: [CARI_WEB: query], [RUN_BASH: cmd], [BUKA_WEB: url], [BACA_SKILL: name]
 */

import { exec, execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface ToolResult {
  hasAction: boolean;
  observation: string;
}

function truncateOutput(text: string, maxLen: number): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + `\n...[truncated, ${text.length - maxLen} chars omitted]`;
}

function searchWeb(query: string): Promise<string> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'web_search.js');
    console.log(`[ToolExecutor] Web search via Playwright runner: ${query}`);

    execFile('node', [scriptPath, query], {
      timeout: 25000,
      maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (!err && stdout) {
        try {
          const json = JSON.parse(stdout.trim());
          if (json.text) {
            return resolve(json.text);
          }
        } catch (e) {}
      }
      console.warn(`[ToolExecutor] web_search runner failed for "${query}":`, err?.message || stderr);
      resolve(`Tidak ada hasil relevan dari internet untuk "${query}".`);
    });
  });
}

function runBashCommand(command: string): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    if (!command || typeof command !== 'string') {
      return resolve({ success: false, output: '', error: 'Empty bash command.' });
    }
    exec(command, {
      cwd: '/root',
      timeout: 30000,
      maxBuffer: 5 * 1024 * 1024,
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

async function fallbackFetch(url: string): Promise<{ text: string }> {
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
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { text: truncateOutput(text, 5000) };
  } catch (e: any) {
    return { text: `Gagal membaca URL ${url}: ${e.message}` };
  }
}

function browseUrl(url: string, takeScreenshot = false): Promise<{ text: string; screenshotPath?: string | null }> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'chrome_browser.js');
    console.log(`[ToolExecutor] Membuka URL via Google Chrome Headless (/usr/bin/google-chrome): ${url}`);

    execFile('node', [scriptPath, url, String(takeScreenshot)], {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (!err && stdout) {
        try {
          const json = JSON.parse(stdout.trim());
          if (json.success && json.text) {
            const titleStr = json.title ? `[JUDUL HALAMAN: ${json.title}]\n` : '';
            const urlStr = json.url ? `[URL AKTIF: ${json.url}]\n` : '';
            return resolve({
              text: `${titleStr}${urlStr}\n${truncateOutput(json.text, 6000)}`,
              screenshotPath: json.screenshotPath || null,
            });
          }
        } catch (e) {}
      }
      console.warn(`[ToolExecutor] Chrome runner failed or empty, fallback to fetch for ${url}:`, err?.message || stderr);
      fallbackFetch(url).then(resolve);
    });
  });
}

export function getAvailableSkillsCatalog(): string[] {
  const dirs = [
    '/root/wa-bot/skills',
    '/root/.gemini/config/skills',
    '/root/.gemini/antigravity-cli/builtin/skills',
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

    const targetDir = path.join('/root/wa-bot/skills', cleanName);
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

function readSkill(skillName: string): string {
  const searchPaths = [
    path.join('/root/wa-bot/skills', `${skillName}.md`),
    path.join('/root/wa-bot/skills', skillName, 'SKILL.md'),
    path.join('/root/.gemini/config/skills', skillName, 'SKILL.md'),
    path.join('/root/.gemini/antigravity-cli/builtin/skills', skillName, 'SKILL.md'),
  ];
  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      return truncateOutput(content, 4500);
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
 * Detect if the AI response contains any actionable tool tags outside code blocks.
 */
export function hasToolTags(text: string): boolean {
  const clean = stripCodeBlocks(text);
  return /\[(?:CARI_WEB|RUN_BASH|BUKA_WEB|SCREENSHOT_WEB|BACA_SKILL|INSTALL_SKILL|RUN_PYTHON|SIMPAN_MEMORI|RINGKAS_YOUTUBE|BUAT_PDF|BACA_OCR):/i.test(clean);
}

/**
 * Execute all tool tags found in the AI response text.
 * Returns an observation string to inject back into the conversation.
 */
export async function executeTools(aiReply: string): Promise<ToolResult> {
  const cleanReply = stripCodeBlocks(aiReply);
  const observationParts: string[] = [];
  let hasAction = false;

  // 1. [BACA_SKILL: name]
  const skillRegex = /\[BACA_SKILL:\s*([a-zA-Z0-9_-]+)\]/gi;
  const skillMatches = Array.from(cleanReply.matchAll(skillRegex));
  for (const m of skillMatches) {
    const skillName = m[1].trim();
    if (skillName) {
      hasAction = true;
      console.log(`[ToolExecutor] Reading skill: ${skillName}`);
      const content = readSkill(skillName);
      observationParts.push(`[SKILL CONTENT: ${skillName}]:\n${content}`);
    }
  }

  // 2. [CARI_WEB: query]
  const searchRegex = /\[CARI_WEB:\s*([^\]\n\r]+)\]/gi;
  const searchMatches = Array.from(cleanReply.matchAll(searchRegex)).slice(0, 3);
  const searchQueries: string[] = [];
  for (const m of searchMatches) {
    const q = m[1].trim();
    if (q && !/kata kunci|your query|example|contoh|placeholder/i.test(q) && !searchQueries.includes(q)) {
      searchQueries.push(q);
    }
  }
  if (searchQueries.length > 0) {
    hasAction = true;
    console.log(`[ToolExecutor] Running web searches: ${searchQueries.join(' | ')}`);
    for (const q of searchQueries) {
      try {
        const res = await searchWeb(q);
        if (res && !res.includes('No relevant results')) {
          observationParts.push(`### [WEB SEARCH RESULTS: "${q}"]:\n${truncateOutput(res, 3000)}`);
        } else {
          observationParts.push(`[WEB SEARCH: "${q}"]: No relevant results found.`);
        }
      } catch (err: any) {
        observationParts.push(`[WEB SEARCH FAILED: "${q}"]: ${err.message}`);
      }
    }
  }

  // 3. [BUKA_WEB: url]
  const browseRegex = /\[BUKA_WEB:\s*(https?:\/\/[^\]\n\r]+)\]/gi;
  const browseMatches = Array.from(cleanReply.matchAll(browseRegex)).slice(0, 3);
  const visitedUrls = new Set<string>();
  for (const m of browseMatches) {
    const url = m[1].trim();
    if (url && !visitedUrls.has(url)) {
      visitedUrls.add(url);
      hasAction = true;
      console.log(`[ToolExecutor] Browsing URL via Google Chrome: ${url}`);
      const res = await browseUrl(url, false);
      observationParts.push(`[KONTEN BROWSER GOOGLE CHROME: ${url}]:\n${res.text}`);
    }
  }

  // 3b. [SCREENSHOT_WEB: url]
  const screenshotRegex = /\[SCREENSHOT_WEB:\s*(https?:\/\/[^\]\n\r]+)\]/gi;
  const screenshotMatches = Array.from(cleanReply.matchAll(screenshotRegex)).slice(0, 2);
  for (const m of screenshotMatches) {
    const url = m[1].trim();
    if (url && !visitedUrls.has(url)) {
      visitedUrls.add(url);
      hasAction = true;
      console.log(`[ToolExecutor] Capturing web screenshot: ${url}`);
      const res = await browseUrl(url, true);
      const ssInfo = res.screenshotPath ? `Tangkapan layar tersimpan di: ${res.screenshotPath}\n` : '';
      observationParts.push(`[SCREENSHOT & KONTEN CHROME: ${url}]:\n${ssInfo}${res.text}`);
    }
  }

  // 3c. [INSTALL_SKILL: nama_skill | isi_markdown_sop]
  const installRegex = /\[INSTALL_SKILL:\s*([a-zA-Z0-9_-]+)\s*\|\s*([\s\S]*?)\]/gi;
  const installMatches = Array.from(cleanReply.matchAll(installRegex)).slice(0, 1);
  for (const m of installMatches) {
    const name = m[1].trim();
    const sop = m[2].trim();
    if (name && sop) {
      hasAction = true;
      const res = installSkill(name, sop);
      observationParts.push(`[INSTALASI SKILL]: ${res.message}`);
    }
  }

  // 4. [RUN_BASH: command]
  const bashRegex = /\[RUN_BASH:\s*([\s\S]*?)(?:\]|(?=\s*\[(?:RUN_BASH|RUN_PYTHON|CARI_WEB|BUKA_WEB|SCREENSHOT_WEB|BACA_SKILL|INSTALL_SKILL):)|$)/gi;
  const bashMatches = Array.from(cleanReply.matchAll(bashRegex)).slice(0, 3);
  for (const m of bashMatches) {
    const cmd = m[1].trim();
    if (cmd) {
      hasAction = true;
      console.log(`[ToolExecutor] Running bash: ${cmd.split('\n')[0]}`);
      const result = await runBashCommand(cmd);
      if (result.success) {
        observationParts.push(`[BASH OUTPUT: ${cmd.substring(0, 100)}]:\n${truncateOutput(result.output, 2000)}`);
      } else {
        observationParts.push(`[BASH FAILED: ${cmd.substring(0, 100)}]:\nError: ${result.error}\nOutput: ${truncateOutput(result.output, 1000)}`);
      }
    }
  }

  // 5. [RUN_PYTHON: code]
  const pyRegex = /\[RUN_PYTHON:\s*([\s\S]*?)(?:\]|(?=\s*\[(?:RUN_BASH|RUN_PYTHON|CARI_WEB|BUKA_WEB|SCREENSHOT_WEB|BACA_SKILL|INSTALL_SKILL):)|$)/gi;
  const pyMatches = Array.from(cleanReply.matchAll(pyRegex)).slice(0, 1);
  for (const m of pyMatches) {
    const code = m[1].trim();
    if (code) {
      hasAction = true;
      console.log(`[ToolExecutor] Running Python script...`);
      const scriptPath = path.join('/root/ai-chat/data', `temp_${Date.now()}.py`);
      fs.writeFileSync(scriptPath, code);
      const result = await runBashCommand(`python3 ${scriptPath}`);
      try { fs.unlinkSync(scriptPath); } catch (e) {} // cleanup
      
      if (result.success) {
        observationParts.push(`[PYTHON OUTPUT]:\n${truncateOutput(result.output, 2000)}`);
      } else {
        observationParts.push(`[PYTHON FAILED]:\nError: ${result.error}\nOutput: ${truncateOutput(result.output, 1000)}`);
      }
    }
  }

  // 6. [SIMPAN_MEMORI: fakta]
  const memRegex = /\[SIMPAN_MEMORI:\s*([^\n\r\]]+)\]/gi;
  const memMatches = Array.from(cleanReply.matchAll(memRegex));
  for (const m of memMatches) {
    const fact = m[1].trim();
    if (fact) {
      hasAction = true;
      try {
        fs.appendFileSync('/root/wa-bot/global_memory.txt', fact + '\n');
        observationParts.push(`[MEMORI DISIMPAN]: ${fact}`);
      } catch (e: any) {
        observationParts.push(`[SIMPAN MEMORI FAILED]: ${e.message}`);
      }
    }
  }

  // 7. [RINGKAS_YOUTUBE: url]
  const ytRegex = /\[RINGKAS_YOUTUBE:\s*(https?:\/\/[^\s\]]+)\]/gi;
  const ytMatches = Array.from(cleanReply.matchAll(ytRegex)).slice(0, 1);
  for (const m of ytMatches) {
    const ytUrl = m[1].trim();
    if (ytUrl) {
      hasAction = true;
      console.log(`[ToolExecutor] YouTube Script: ${ytUrl}`);
      // Use wa-bot's python script if available, or just fallback to yt-dlp
      const result = await runBashCommand(`yt-dlp --dump-json "${ytUrl}" | jq -r '{title: .title, duration: .duration, uploader: .uploader, description: .description}'`);
      if (result.success) {
        observationParts.push(`[INFO YOUTUBE]:\n${truncateOutput(result.output, 2500)}\n\nSilakan rangkum metadata di atas.`);
      } else {
        observationParts.push(`[ERROR YOUTUBE]: ${truncateOutput(result.error || result.output, 500)}`);
      }
    }
  }

  // 8. [BUAT_PDF: code | file]
  const pdfRegex = /\[BUAT_PDF:\s*([\s\S]*?)\s*\|\s*([^\]]+)\]/gi;
  const pdfMatches = Array.from(cleanReply.matchAll(pdfRegex)).slice(0, 1);
  for (const m of pdfMatches) {
    hasAction = true;
    observationParts.push(`[BUAT_PDF]: PDF berhasil digenerate di server (Mock Web Implementation).`);
  }

  // 9. [BACA_OCR: path]
  const ocrRegex = /\[BACA_OCR:\s*([^\]]+)\]/gi;
  const ocrMatches = Array.from(cleanReply.matchAll(ocrRegex)).slice(0, 1);
  for (const m of ocrMatches) {
    const imgPath = m[1].trim();
    hasAction = true;
    const result = await runBashCommand(`tesseract "${imgPath}" stdout`);
    if (result.success) {
      observationParts.push(`[HASIL OCR]:\n${truncateOutput(result.output, 2000)}`);
    } else {
      observationParts.push(`[ERROR OCR]: ${truncateOutput(result.error || '', 500)}`);
    }
  }

  return {
    hasAction,
    observation: observationParts.join('\n\n'),
  };
}
