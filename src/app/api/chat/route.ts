import { getClaudePersonaPrompt } from "@/lib/claude-personas";
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { ConversationRepository } from '@/lib/db/repositories/conversation-repo';
import { MessageRepository } from '@/lib/db/repositories/message-repo';
import { ProviderRepository } from '@/lib/db/repositories/provider-repo';
import { ProjectRepository } from '@/lib/db/repositories/project-repo';
import { SettingsRepository } from '@/lib/db/repositories/settings-repo';
import { MemoryRepository } from '@/lib/db/repositories/memory-repo';
import { WorkSessionRepository } from '@/lib/db/repositories/work-session-repo';
import { AIRouter } from '@/lib/ai/router';
import { ChatMessage, ChatRequest } from '@/lib/ai/provider-interface';
import { hasToolTags, executeTools, stageMediaTagsInReply, searchTokens, findDuplicateSearch } from '@/lib/tools/tool-executor';
import { buildNativeTools, nativeCallsToTags, shouldSendNativeTools } from '@/lib/tools/native-tools';
import { getRecentStagedFilesSummary } from '@/lib/tools/file-generator';
import { parseBrowserCommand } from '@/lib/tools/browser-agent';
import {
  cleanMessageContent,
  cleanServerFinalContent,
  extractInlineMedia,
  MEDIA_TAG_NAMES,
  parseToolTags,
} from '@/lib/utils/clean-content';
import { buildActionSubject, isActionFailure } from '@/lib/utils/action-display';
import { getCapabilitySnapshot } from '@/lib/capabilities/registry';
import {
  buildEnvironmentCard,
  buildMcpToolSection,
  buildSkillSection,
} from '@/lib/capabilities/prompt';
import { getCachedMcpTools, isMcpCacheFresh, listAllMcpTools } from '@/lib/mcp/manager';
import { describeCliBridge } from '@/lib/cli-bridge';
import { mergeTaskList } from '@/lib/agents/tasks';
import { convertDsmlToolCalls, stripDsml } from '@/lib/utils/dsml';
import { reviewAction, shouldReview } from '@/lib/agents/reviewer';
import type { TaskItem } from '@/types/chat';
import { persistActiveGen, clearActiveGen, recoverStaleGens } from '@/lib/ai/active-gen-store';
import { ensureJobsRecovered, listJobsForConversation } from '@/lib/ai/detached-jobs';

import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * Rute harness OpenCode ("oc/*" via 9router) menambah system prompt sendiri
 * (~2.7k token) di sisi server. System prompt 50k karakter membuat upstream
 * gratis sering timeout/balas kosong. Pangkas bagian non-esensial saja:
 * katalog skill, protokol investigasi panjang, dan catatan pembelajaran.
 */
function trimPromptForHarness(prompt: string): string {
  const dropPatterns = [
    /Protokol Investigasi Otonom/i,
    /PEMBELAJARAN KEGAGALAN/i,
  ];
  const lines = prompt.split('\n');
  const kept: string[] = [];
  let dropping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,4}\s/.test(trimmed)) {
      dropping = dropPatterns.some((p) => p.test(trimmed));
    }
    if (!dropping) kept.push(line);
  }
  const out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

export const runtime = 'nodejs';

function resolveAttachmentDataUrl(att: any): string | null {
  if (!att) return null;
  if (att.dataUrl && typeof att.dataUrl === 'string' && att.dataUrl.startsWith('data:image/')) {
    return att.dataUrl;
  }
  if (att.url && typeof att.url === 'string') {
    if (att.url.startsWith('data:image/')) {
      return att.url;
    }
    // Check if uploaded file on server disk
    const match = att.url.match(/[?&]file=([^&]+)/);
    const filename = match ? path.basename(decodeURIComponent(match[1])) : path.basename(att.url);
    const filePath = path.join(process.cwd(), 'uploads', filename);
    if (fs.existsSync(filePath)) {
      try {
        const fileBuffer = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase();
        let mime = att.mimeType || 'image/jpeg';
        if (ext === '.png') mime = 'image/png';
        else if (ext === '.webp') mime = 'image/webp';
        else if (ext === '.gif') mime = 'image/gif';
        else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
        return `data:${mime};base64,${fileBuffer.toString('base64')}`;
      } catch (e) {
        console.error('[resolveAttachmentDataUrl error]', e);
      }
    }
    if (att.url.startsWith('http://') || att.url.startsWith('https://')) {
      return att.url;
    }
  }
  return null;
}

function formatMessageContentWithAttachments(content: string, attachments?: any[]): string {
  if (!attachments || attachments.length === 0) return content;
  const nonImageFiles = attachments.filter(
    (att) =>
      !att.mimeType?.startsWith('image/') &&
      !att.url?.startsWith('data:image/') &&
      !resolveAttachmentDataUrl(att)
  );
  if (nonImageFiles.length === 0) return content;

  let out = content;
  out += '\n\n==================================================';
  out += '\n[BERKAS DILAMPIRKAN OLEH PENGGUNA]:';
  for (const f of nonImageFiles) {
    const name = f.name || 'berkas';
    const p = f.localPath || '';
    out += `\n\n--- Berkas: "${name}" ${p ? `(tersimpan di: ${p})` : ''} ---`;
    if (f.extractedText) {
      out += `\n[Isi / Ringkasan Dokumen]:\n${f.extractedText}\n--- Akhir Isi Berkas ---`;
    } else {
      out += `\n(Berkas biner/multimedia diunggah pengguna. Anda dapat menganalisisnya lewat path di atas menggunakan tool jika diperlukan.)`;
    }
  }
  out += '\n==================================================';
  return out;
}

const ChatRequestSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  temporary: z.boolean().optional(),
  systemPrompt: z.string().optional(),
  claudePersona: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().positive().optional(),
  reasoningEffort: z.string().optional(),
  attachments: z.array(z.any()).optional(),
  userLocation: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    label: z.string().optional(),
    accuracy: z.number().optional(),
  }).optional(),
  searchQuota: z.number().min(10).max(50).optional(),
  activeConnectors: z.array(z.string()).optional(),
  // Sumber pesan. Bridge WhatsApp/Telegram/Discord mengirim nilainya secara
  // eksplisit; web tidak mengirim apa pun sehingga dianggap 'web'.
  channel: z.enum(['web', 'whatsapp', 'telegram', 'discord']).optional(),
});

// Registry generasi aktif: generasi tetap berjalan & tersimpan ke DB walau klien
// (mis. Chrome mobile di-background) terputus. Klien bisa menyambung ulang via GET
// dan menerima teks/reasoning/aksi yang sedang berjalan secara real-time.
type ActiveGen = {
  controller: AbortController;
  startedAt: number;
  content: string;
  reasoning: string;
  actions: import('@/types/chat').ActionInfo[];
};
const g = globalThis as unknown as { __aiChatActiveGens?: Map<string, ActiveGen> };
const activeGens: Map<string, ActiveGen> = g.__aiChatActiveGens || (g.__aiChatActiveGens = new Map());

// Sekali per proses: selamatkan generasi yang terpotong oleh restart/deploy
// sebelumnya (isinya disimpan berkala ke data/active-gens). Dipanggil di awal
// GET/POST karena modul route baru dimuat saat request pertama masuk.
const gRecover = globalThis as unknown as { __aiChatRecovered?: boolean };
function ensureRecovered(): void {
  if (gRecover.__aiChatRecovered) return;
  gRecover.__aiChatRecovered = true;
  try {
    const recovered = recoverStaleGens();
    if (recovered.length) {
      console.log(`[ActiveGen] ${recovered.length} jawaban terputus dipulihkan dari restart:`, recovered.join(', '));
    }
  } catch (e) {
    console.warn('[ActiveGen] Gagal memulihkan generasi tertinggal:', e);
  }
}

export async function GET(req: NextRequest) {
  ensureRecovered();
  ensureJobsRecovered();
  const convId = req.nextUrl.searchParams.get('conversationId') || '';
  const gen = convId ? activeGens.get(convId) : undefined;
  return new Response(
    JSON.stringify({
      running: Boolean(gen),
      startedAt: gen?.startedAt || null,
      content: gen?.content || '',
      reasoning: gen?.reasoning || '',
      actions: gen?.actions || [],
      jobs: convId ? listJobsForConversation(convId) : [],
    }),
    {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }
  );
}

export async function DELETE(req: NextRequest) {
  const convId = req.nextUrl.searchParams.get('conversationId') || '';
  const gen = convId ? activeGens.get(convId) : undefined;
  if (gen) gen.controller.abort();
  return new Response(JSON.stringify({ stopped: Boolean(gen) }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  try {
    ensureRecovered();
    ensureJobsRecovered();
    const user = getCurrentUser(req);
    const body = await req.json();
    const parsed = ChatRequestSchema.safeParse(body);

    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid request', details: parsed.error.format() }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const {
      conversationId: incomingConvId,
      message: userContent,
      providerId,
      modelId,
      temporary = false,
      temperature,
      topP,
      maxTokens,
      reasoningEffort,
      attachments = [],
      userLocation,
      searchQuota = 30,
      channel: incomingChannel,
    } = parsed.data;

    let convId = incomingConvId;
    let conversation = convId ? ConversationRepository.getConversation(convId) : null;

    // Kanal resmi dari bridge. Untuk sesi lama yang dibuat sebelum field ini ada,
    // jatuh ke penanda judul bridge sebagai fallback.
    const channel: 'web' | 'whatsapp' | 'telegram' | 'discord' =
      incomingChannel || (/\[whatsapp\]/i.test(conversation?.title || '') ? 'whatsapp' : 'web');
    const isWhatsApp = channel === 'whatsapp';

    // Auto-create conversation if new
    if (!conversation) {
      convId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      // Generate clean initial title from first line of message
      let initialTitle = userContent.trim().split('\n')[0].replace(/^[\s#>\-*`]+/, '').trim().substring(0, 50);
      if (!initialTitle) initialTitle = 'New Chat';
      conversation = ConversationRepository.createConversation({
        id: convId,
        userId: user.id,
        title: initialTitle,
        providerId,
        modelId,
        temporary,
        temperature,
        topP,
        maxTokens,
        reasoningEffort,
      });
    } else {
      // Touch conversation to refresh updated_at so it stays at the top of recent chats
      ConversationRepository.touchConversation(convId!);
    }

    // Sesi kerja lintas percakapan: simpan permintaan terakhir sebelum prompt
    // dibangun agar sesi ini langsung terlihat oleh model di sesi lain.
    if (!temporary && convId) {
      try {
        WorkSessionRepository.touch(user.id, convId, conversation.title || 'Sesi kerja', userContent);
      } catch (workErr) {
        console.warn('[WorkSession] Gagal menyegarkan sesi kerja:', workErr);
      }
    }

    // Determine System Prompt Hierarchy:
    // Priority: conversation.systemPrompt > project.systemPrompt > userSettings.systemPrompt
    let effectiveSystemPrompt = parsed.data.systemPrompt || conversation.systemPrompt || '';
    if (!effectiveSystemPrompt && conversation.projectId) {
      const project = ProjectRepository.getProject(conversation.projectId);
      if (project?.systemPrompt) {
        effectiveSystemPrompt = project.systemPrompt;
      }
    }
    if (!effectiveSystemPrompt) {
      const settings = SettingsRepository.getUserSettings(user.id);
      if (settings?.systemPrompt) {
        effectiveSystemPrompt = settings.systemPrompt;
      }
    }

    // Inject Persona / Gaya Bahasa Resmi Claude (disimpan untuk disuntikkan di akhir prompt)
    const requestedPersona = parsed.data.claudePersona || (user?.id ? (SettingsRepository.getUserSettings(user.id) as any)?.claudePersona : null);
    const personaPrompt = getClaudePersonaPrompt(requestedPersona);

    // Auto-inject current date and time to fix knowledge cutoff hallucinations
    const currentDateStr = new Intl.DateTimeFormat('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
    }).format(new Date());

    const temporalContext = `\n\n[Waktu Server Saat Ini: ${currentDateStr}]. Perlakukan ini sebagai kebenaran waktu; jangan pernah berasumsi tahun lama.
Aturan query pencarian (berpikir, jangan kaku):
- JANGAN menempelkan tahun/bulan ke setiap query kebaruan ("harga emas hari ini", "kurs dollar hari ini", "berita terbaru") — mesin pencari sudah menangani kebaruan dan tambahan tahun justru mempersempit hasil.
- Sertakan tahun/bulan HANYA bila tanpanya query ambigu: acara terjadwal (jadwal pertandingan, konser, rilis versi), penghargaan/peristiwa tahunan, atau ketika pengguna sendiri menyebut tahun.
- Jika hasil terlihat basi, pertegas dengan bulan/tahun tertentu atau buka sumber bertanggal lewat [BUKA_WEB]; jangan mengulang query yang sama.`;

    const isAdmin = user.role === 'admin';

    // Memori jangka panjang: tangkap fakta eksplisit dari pesan pengguna
    // sebelum prompt dibangun, agar fakta seperti nama/pekerjaan/hobi langsung
    // terpakai pada giliran ini (tanpa menunggu model menulis tag).
    if (!temporary) {
      try {
        const captured = MemoryRepository.captureFromUserMessage(user.id, userContent);
        if (captured.length > 0) {
          console.log(`[Memory] ${captured.length} fakta pengguna disimpan dari pesan langsung.`);
        }
      } catch (memErr) {
        console.warn('[Memory] Gagal menangkap fakta dari pesan pengguna:', memErr);
      }
    }

    // Gerbang persetujuan OTP: hanya aktif bila pesan pengguna terakhir memang
    // berisi kata setuju. AI tidak dapat memalsukan pesan pengguna, sehingga
    // pembacaan email (OTP) selalu butuh persetujuan manusia.
    const otpApproved = (() => {
      const t = (userContent || '').toLowerCase();
      if (!t) return false;
      if (/\b(jangan|belum|tidak|batal|cancel)\b/.test(t)) return false;
      return /\b(setuju|boleh|izinkan|silakan|silahkan|approve|approved|ya|iya|yak|lanjut)\b/.test(t);
    })();

    // --- Perintah slash /ig (unduh video Instagram) ---
    // Deterministik: dinormalisasi ke shortcode agar tidak bisa dipakai untuk
    // menyisipkan perintah shell lain lewat tautan.
    const igMatch = userContent.match(/^\s*\/(?:ig|instagram)\s+(\S+)/i);
    const rawIgArg = igMatch ? igMatch[1].replace(/[),.;]+$/, '') : '';
    const igShortcode = igMatch
      ? ((rawIgArg.match(/instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i) || [])[1] ||
         (/^[A-Za-z0-9_-]{10,15}$/.test(rawIgArg) ? rawIgArg : ''))
      : '';
    let igPrompt = '';
    if (igMatch) {
      if (!igShortcode) {
        igPrompt = `\n\n[PERINTAH /ig]: Tautan Instagram tidak valid ("${rawIgArg}"). Minta pengguna mengirim tautan Reels/Post yang benar (contoh: https://www.instagram.com/reel/XXXX/). JANGAN menjalankan perintah bash apa pun.`;
      } else {
        const igUrl = `https://www.instagram.com/reel/${igShortcode}/`;
        igPrompt = `\n\n==================================================\n[PERINTAH SLASH /ig — WAJIB DIEKSEKUSI SEKARANG]:\nPengguna mengetik perintah /ig untuk tautan: ${igUrl}\nJANGAN membahas menu pop-up, autocomplete, atau cara memakai perintah. JANGAN memanggil [BUKA_WEB] untuk tautan ini.\nLangkah wajib pada respons ini:\n1. Panggil [BACA_SKILL: ig] lalu ikuti SOP-nya.\n2. Jalankan [RUN_BASH: node /root/ai-chat/scripts/download_instagram.js "${igUrl}"]\n3. Baca JSON hasilnya. Jika "ok":true, panggil [KIRIM_FILE: <path dari JSON> | Video Instagram] pada respons pertama (carousel berlagu otomatis keluar sebagai video MP4 slideshow bersuara).\n4. Jika "ok":false, sampaikan error singkat; jangan mengarang hasil.\n==================================================`;
      }
    }

    // URL Auto-Detection Prompt Trigger (Direct or from Recent Conversation History)
    const urlRegex = /https?:\/\/[^\s<>"'{}|\\^`[\]]+/gi;
    let detectedUrls = Array.from(userContent.matchAll(urlRegex)).map((m) => m[0]);

    if (detectedUrls.length === 0 && convId) {
      try {
        const recentHistory = MessageRepository.listMessages(convId).slice(-6).reverse();
        const wantsToOpen = /(?:(?:buka|baca|kunjungi|lihat)\s+(?:kembali|lagi|link|tautan|web|url|artikel|berita|halaman)|(?:link|tautan|web|url|artikel|berita)\s+(?:tadi|kemarin|sebelumnya|yang tadi)|coba buka (?:lagi|tadi))/i.test(userContent);
        if (wantsToOpen) {
          for (const pastMsg of recentHistory) {
            const found = Array.from(pastMsg.content.matchAll(urlRegex)).map((m) => m[0]);
            if (found.length > 0) {
              detectedUrls = [found[0]];
              break;
            }
          }
        }
      } catch (e) {}
    }

    let urlTriggerPrompt = '';
    if (detectedUrls.length > 0 && !igMatch) {
      urlTriggerPrompt = `\n\n==================================================\n[PERINTAH DETEKSI TAUTAN / URL]:\nPengguna meminta membuka tautan: ${detectedUrls.join(', ')}.\nAnda memiliki kapabilitas web browser untuk membaca konten halaman web secara utuh.\nAnda WAJIB LANGSUNG mengeksekusi: [BUKA_WEB: ${detectedUrls[0]}] sekarang juga pada respons ini!\nDILARANG KERAS berhalusinasi atau menolak tautan luar. Panggil [BUKA_WEB: ${detectedUrls[0]}] sekarang!\n==================================================`;
    }

    // --- GPS / Lokasi pengguna untuk cek cuaca ---
    const asksWeather = /(cuaca|weather|hujan|panas|dingin|berawan|mendung|suhu|temperatur|prakiraan|ramalan cuaca|cerah|badai|angin kencang)/i.test(userContent);
    let locationPrompt = '';
    if (userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lon === 'number') {
      const locLabel = userLocation.label ? ` (${userLocation.label})` : '';
      locationPrompt = `\n\n[LOKASI PENGGUNA (GPS/IP aktif, izin diberikan)]: ${userLocation.lat}, ${userLocation.lon}${locLabel}. Koordinat ini DIDAPAT LANGSUNG dari perangkat pengguna via tombol 📍 di composer — BUKAN dari skill, BUKAN tebakan. DILARANG menjawab "tidak ada kemampuan GPS / tidak bisa melacak lokasi".`;
      if (asksWeather) {
        locationPrompt += `\n[PERINTAH CUACA]: Pengguna menanyakan cuaca dan lokasi tersedia. Anda WAJIB LANGSUNG memanggil [CEK_CUACA: ${userLocation.lat}, ${userLocation.lon}] pada respons ini untuk data real-time (Open-Meteo). DILARANG mengarang cuaca tanpa tool. Setelah hasil tool kembali, rangkum dengan ramah dalam Bahasa Indonesia.`;
      } else {
        locationPrompt += ` Jika pengguna bertanya lokasi/posisi/cuaca ("di mana saya", "cuaca di sini", "lacak lokasi saya"), gunakan koordinat di atas: panggil [CEK_CUACA: ${userLocation.lat}, ${userLocation.lon}] untuk cuaca, atau sebutkan koordinat + labelnya untuk pertanyaan posisi. Jangan suruh kirim pin WhatsApp — lokasi sudah ada. Jika pengguna bertanya cuaca tanpa menyebut kota, panggil [CEK_CUACA: ${userLocation.lat}, ${userLocation.lon}].`;}
    } else if (asksWeather) {
      locationPrompt = `\n\n[INFO CUACA TANPA GPS]: Izin lokasi/GPS pengguna BELUM aktif. Jika pertanyaan menyebut nama kota (contoh "cuaca Jakarta"), LANGSUNG panggil [CEK_CUACA: NamaKota]. Jika pengguna bertanya "cuaca di sini / hari ini" tanpa kota dan tanpa GPS, JANGAN mengarang — minta pengguna menekan ikon 📍 (Izinkan Lokasi) di composer ATAU menyebutkan nama kotanya, lalu panggil [CEK_CUACA: kota] setelah info tersedia.`;
    }

    let roleSpecificPrompt = '';
    if (isAdmin) {
      // Dynamic Skills Catalog from Server (/root/ai-chat/skills)
      const { getAvailableSkillsCatalog } = await import('@/lib/tools/tool-executor');
      const skillsList = getAvailableSkillsCatalog();
      const skillsText = skillsList.length > 0 ? skillsList.join('\n') : '  - Tidak ada skill eksternal.';
      const recentStagedFiles = getRecentStagedFilesSummary(10);

      // Comprehensive Executive AI Automation Tools & Environment Prompt for Admin (Vee)
      const toolInstructions = `
\n\n---
# AI AUTOMATION SYSTEM & SERVER CAPABILITIES (ANTIGRAVITY WEB AI)
Anda adalah Asisten AI Utama berintegritas tinggi dengan kapabilitas otomasi penuh di server Linux Ubuntu.
Pengguna utama Anda adalah **Vee** (pemilik & pengembang sistem).

## 0. KESADARAN DIRI, ARSITEKTUR RUNTIME INTERNAL, & BERKAS STAGING AKTIF
Anda TIDAK buta terhadap lingkungan Anda sendiri. Ketahui fakta arsitektur tempat Anda berjalan saat ini:
- **Aplikasi Web Utama:** \`/root/ai-chat\` (Next.js 14 App Router, Port \`3010\`, PM2: \`ai-chat\`, Domain: \`https://vee2.my.id\`).
- **Database Utama:** \`/root/ai-chat/data/chat.db\` (SQLite WAL mode, tabel \`conversations\`, \`messages\`, \`memories\`, \`work_sessions\`).
- **Konteks Sesi Saat Ini:** \`conversationId=${convId}\` | \`model=${providerId}/${modelId}\` | \`browserSession=${convId}\`.
- **Alur Route Chat & Rendering Kartu Media (\`src/app/api/chat/route.ts\` -> \`src/components/chat/message-item.tsx\`):**
  1. Selama balasan Anda memuat tag tool eksekusi (\`[RUN_BASH: ...]\`, \`[BROWSER: ...]\`, \`[BUKA_WEB: ...]\`, \`[CARI_WEB: ...]\`, dll.), server mengeksekusi tool tersebut, menyimpan teks pengantar ke kartu aksi (\`action.textBefore\`), me-reset buffer teks sementara (\`event: reset\`), lalu memberikan \`[TOOL RESULTS]\` untuk putaran berikutnya.
  2. Teks dari putaran terakhir (setelah semua tool selesai) disimpan ke \`messages.content\` di SQLite dan dirender oleh \`MessageItem\`.
  3. Di sisi UI pengguna (\`MessageItem\`), fungsi \`extractInlineMedia(message.content)\` membaca tag \`[KIRIM_FILE: /path/lengkap/berkas.ext | Judul]\` (atau \`KIRIM_AUDIO\`, \`KIRIM_VIDEO\`, \`KIRIM_GAMBAR\`, \`KIRIM_DOKUMEN\`) untuk merender kartu pemutar interaktif \`<UniversalFileCard>\` (pemutar \`<audio controls>\`, \`<video controls>\`, pratinjau gambar, dan tombol Unduh 1-Klik via \`/api/browser-shots/<nama_berkas>\`), lalu \`cleanMessageContent()\` menyembunyikan teks tag mentahnya dari paragraf Markdown.
  4. **ATURAN ANTI-HALU PENGIRIMAN BERKAS:**
     - **JANGAN PERNAH** mengarang alasan teknis palsu seperti *"pesan saya terpotong saat memanggil tool internal sebelum tag pengiriman dicetak"*.
     - **DILARANG KERAS** menulis catatan telemetri internal seperti \`[FAKTA UI & AKSI PESAN INI: ...]\` di dalam balasan kepada pengguna.
     - Jika berkas yang ingin dikirim **SUDAH ADA** di daftar \`[BERKAS STAGING TERBARU DI SERVER]\` di bawah, **JANGAN memanggil \`[RUN_BASH]\` lagi** (tidak perlu \`ls\`, \`find\`, \`cp\`, atau \`grep\`)! Langsung tulis balasan akhir Anda beserta tag \`[KIRIM_FILE: /root/ai-chat/uploads/shared/<nama_file> | Judul]\` pada baris tersendiri.
- **[BERKAS STAGING TERBARU DI SERVER (/root/ai-chat/uploads/shared) — SIAP KIRIM LANGSUNG]:**
${recentStagedFiles}

## 1. PETA LINGKUNGAN SERVER & KAPABILITAS BROWSER GOOGLE CHROME
- **Google Chrome Headless Asli:** Terpasang aktif di server pada \`/usr/bin/google-chrome\` (didukung Playwright Chromium).
- Tag \`[BUKA_WEB: url]\` secara otomatis membuka halaman via Google Chrome asli, mengeksekusi JavaScript, merender Single Page Application (React/Next.js/Vue), dan membaca konten teks DOM secara utuh.
- **DILARANG MENYERAH (ZERO-DEFEATISM):** DILARANG KERAS menolak tautan dari pengguna dengan alasan "saya tidak bisa mengakses tautan langsung", "saya AI bahasa tanpa internet", atau menyuruh pengguna copy-paste teks secara manual. Jika ada link, LANGSUNG panggil \`[BUKA_WEB: url]\`!

## 2. EKOSISTEM SKILL & ARSITEKTUR MCP (MODEL CONTEXT PROTOCOL)
- **Konsep MCP (Model Context Protocol):** Standar industri untuk menghubungkan model AI dengan sumber daya eksternal, alat otomasi (tools), dan server MCP di sistem Antigravity.
- **Katalog Skill Khusus (/root/ai-chat/skills) — Anda MEMILIKI ${skillsList.length} skill berikut:**
${skillsText}
- **WAJIB CEK SKILL SEBELUM MENGERJAKAN TUGAS:** Sebelum menjawab atau mengerjakan tugas apa pun, periksa daftar skill di atas. Jika ada yang relevan, WAJIB panggil \`[BACA_SKILL: nama_skill]\`, ikuti SOP-nya, dan sebutkan singkat skill yang kamu pakai (contoh: "Memakai skill \`linux-server-ops\`"). Jika tidak ada yang relevan, kerjakan langsung tanpa memaksa memakai skill.
- **Cara Membaca SOP Panjang (berhalaman):** Hasil \`[BACA_SKILL]\` selalu diawali penanda \`bagian 1/N\`. Jika N > 1, WAJIB lanjutkan dengan \`[BACA_SKILL: nama_skill 2]\`, lalu \`3\`, dan seterusnya sampai muncul penanda \`[SKILL SELESAI]\`. JANGAN berhenti di bagian pertama dan jangan mengarang isi bagian yang belum dibaca.
- **Instalasi Skill Baru:** Jika diminta membuat atau menginstal skill baru, gunakan \`[INSTALL_SKILL: nama_skill | isi_markdown_sop]\`. Sistem akan otomatis menyimpannya ke \`/root/ai-chat/skills/\` dan mendaftarkannya secara permanen.

## 2b. ARSITEKTUR MCP SERVER, TOKEN ENV, & UTILITAS AKTIF
- **MCP nyata, bukan sekadar klaim:** server MCP terpasang di \`/root/.config/mcp/config.json\` dan \`/root/.gemini/config/mcp_config.json\`. Hanya server yang benar-benar tersambung (lihat KARTU LINGKUNGAN di akhir prompt) yang boleh dipanggil, dengan format \`[MCP: server.tool | {"arg":"nilai"}]\`. JANGAN mengarang nama server atau tool MCP yang tidak tercantum di kartu. Database SQLite utama berada di \`/root/ai-chat/data/chat.db\` (symlink \`/root/mcp-servers/local.db\`).
- **Semua Kredensial & Jaringan Stealth Ada di ENV:** Seluruh kunci API (\`TAVILY_API_KEY\`, \`BRAVE_API_KEY\`, \`SCRAPERAPI_KEY\`, \`ZENROWS_API_KEY\`, \`GITHUB_TOKEN\`, \`DECODO_API_KEY\`, \`CAPMONSTER_API_KEY\`, \`CAPSOLVER_API_KEY\`) dan proxy Cloudflare WARP (\`WARP_PROXY="socks5://127.0.0.1:40000"\`) sudah tersedia di server (\`.bashrc\`, \`.env.local\`, \`.api_keys.env\`). Seluruh akses browser otomasi otomatis terlindungi pool IP Cloudflare edge via WARP proxy untuk bypass bot protection dan Turnstile tanpa IP datacenter ban. DILARANG meminta token kepada pengguna dan DILARANG meng-hardcode kunci API.
- **Utilitas Server:**
  * TikTok Engine: \`node /root/ai-chat/scripts/download_tiktok.js "<url>"\` (mendukung video MP4 & photo mode slideshow dengan musik latar utuh; media tersimpan di \`/root/ai-chat/uploads/shared/\`).
  * Instagram Engine: \`node /root/ai-chat/scripts/download_instagram.js "<url>"\` (mendukung video MP4 & carousel/foto berlagu auto-merge slideshow bersuara via FFmpeg; default --merge-audio aktif; media tersimpan di \`/root/ai-chat/uploads/shared/\`).
    - **ATURAN MUTLAK KONTEN INSTAGRAM & AUDIO (ANTI-NGEYEL):**
      1. Carousel berlagu dan foto bersuara **WAJIB KELUAR SEBAGAI VIDEO MP4 (SLIDESHOW) BERSUARA**, BUKAN galeri foto statis.
      2. DILARANG KERAS berargumen atau membantah pengguna bahwa "postingan tidak memiliki musik / audio bawaan tidak ada" hanya karena output scraping publik bertuliskan has_audio: false! Akses scraping publik Instagram tanpa login memang menyembunyikan stream audio CDN Meta.
      3. Jika pengguna menyatakan postingan memiliki lagu (misal: "ada musiknya", atau menyebut judul lagunya), ATAU jika ada judul lagu terdeteksi:
         LANGSUNG jalankan:
         \`node /root/ai-chat/scripts/download_instagram.js "<url>" --audio-query "<judul lagu>"\`
         atau unduh audionya via:
         \`yt-dlp "ytsearch1:<judul lagu>" -x --audio-format m4a -o /tmp/ig_audio.m4a\`
         lalu gabungkan slide foto dengan audio via FFmpeg menjadi MP4 slideshow bersuara (-movflags +faststart).
      4. WAJIB sertakan tag \`[KIRIM_FILE: /root/ai-chat/uploads/shared/<file> | Judul]\` pada balasan pertama agar pemutar video/kartu langsung tampil di layar pengguna. Dilarang hanya mengetik teks konfirmasi tanpa tag \`[KIRIM_FILE]\`.
  * Web Search: \`node /root/ai-chat/scripts/web_search.js "<query>"\`.
  * Google Chrome Headless: \`node /root/ai-chat/scripts/chrome_browser.js "<url>"\`.
  * Subtitle Whisper: \`/root/getsub/getsub.sh "<url>"\`.
  * Jembatan WhatsApp / Sosmed: \`/root/ai-chat-bridge/\` (PM2: \`ai-chat-bridge\`).
    - **PROTOKOL WHATSAPP BRIDGE (ANTI-SPAM KODE & TEKS PANJANG):**
      ${isWhatsApp ? 'SESI INI BERASAL DARI WHATSAPP.' : 'Jika percakapan berasal dari WhatsApp (kanal whatsapp):'}
      1. DILARANG KERAS menampilkan blok kode markdown (\`\`\`...\`\`\`), baris perintah terminal (node, python, bash, ffmpeg), atau objek JSON mentah (\`{"ok":...}\`) saat melayani permintaan unduhan media (Instagram, TikTok, YouTube). Jalankan skrip di latar belakang secara hening.
      2. Saat unduhan selesai, LANGSUNG berikan tag \`[KIRIM_FILE: /root/ai-chat/uploads/shared/<file> | Judul]\`.
      3. JANGAN MENULIS TEKS PANJANG, rincian teknis (resolusi, bitrate, codec, parameter FFmpeg), atau kutipan panjang teks poster di chat WhatsApp. Balasan teks harus sangat singkat (maksimal 1 kalimat ramah) atau kosongkan saja agar file media langsung terkirim bersih ke WhatsApp tanpa spam teks.
  * JANGAN PERNAH mengecek ke direktori lama atau phantom (seperti wa-bot lama).

## 2c. PETA RUTE UTILITAS — PERIKSA INI DULU SEBELUM MENGARANG CARA SENDIRI
Sebagian besar tugas di server ini SUDAH punya alat resminya. Cocokkan tugas dengan peta ini sebelum menulis skrip atau menyimpulkan sesuatu tidak bisa:
- Subtitle/transkrip video (TikTok, YouTube, Threads, X/Twitter, Facebook Reels, Bluesky, dll.) -> [AMBIL_SUBTITEL: url]. Alat ini mentranskrip lokal dengan Whisper dan TIDAK butuh cookie/login; dilarang menyimpulkan gagal karena cookie. Video Threads ditangkap via browser headless (yt-dlp tidak mendukung Threads) — tetap panggil tool ini untuk URL threads.com/threads.net.
- Unduh video/foto TikTok atau Instagram -> pakai TikTok Engine / Instagram Engine di seksi 2b dan skill ig; jangan merakit ulang yt-dlp/ffmpeg dari nol.
- Membaca halaman yang memblokir (Cloudflare, 403, challenge) -> [AMBIL_HALAMAN: url]. Interaksi/login/klik -> [BROWSER] (patuhi ATURAN KEMUDI ALAT di seksi 3b). Dilarang menulis skrip scraping/solver browser sendiri — termasuk pola dari skill playwright-scraping-ninja; skill itu referensi baca saja, bukan jalur eksekusi.
- Soal tunnel/API/VM Muse (port 2222 dan 5005, API 502, "VM mati") -> WAJIB [BACA_SKILL: muse-vm-ops] sebelum menyimpulkan apa pun. Dilarang menyatakan tunnel tidak persisten atau mati permanen tanpa memeriksa fakta pemulihan otomatisnya.
- Mengetahui utilitas/file/kemampuan apa saja yang ada di server -> [BACA_SKILL: muse-utilities] (peta lengkap di /root/muse-utilities-20261018/INVENTARIS.md). Dilarang mengarang bahwa sesuatu tidak tersedia sebelum memeriksa peta ini.
- Kesehatan server, PM2, disk, log -> [BACA_SKILL: linux-server-ops].
- Deploy/restart ai-chat -> npm run deploy (berjalan detached otomatis). Dilarang npm run build langsung; sistem menolaknya. Setelah tag dijadwalkan, status yang benar adalah "sedang berjalan di latar belakang" — DILARANG mengklaim "selesai/sukses"; laporan final datang otomatis ke percakapan.

## 3. DAFTAR ALAT OTOMASI LENGKAP:
1. \`[BUKA_WEB: url]\` -> Buka halaman web via browser Google Chrome asli (Playwright) dan baca isinya secara utuh. Gunakan ini jika ringkasan dari hasil pencarian terpotong atau kosong.
2. \`[SCREENSHOT_WEB: url]\` -> Buka halaman web dan ambil tangkapan layar antarmuka via Google Chrome.
3. \`[CARI_WEB: query]\` -> Mencari info di internet via search engine. **PENTING: \`query\` WAJIB berupa 2-4 kata kunci singkat (contoh: "hasil final indonesia thailand", bukan kalimat lengkap "berapa skor hasil final indonesia thailand").** **DEFAULT: SATU query.** Tambahkan query kedua HANYA bila objek yang dicari benar-benar DUA hal berbeda (mis. harga emas DAN kurs dollar). MAKSIMAL 2 tag CARI_WEB per giliran — lebih dari itu akan dipotong server. DILARANG menduplikasi atau memparafrase query yang sama, dan DILARANG menulis 3 query sekaligus hanya untuk satu kebutuhan sederhana. Tulis tiap tag di baris sendiri. JANGAN mengulang atau memparafrase query yang sudah dijalankan pada giliran sebelumnya dalam percakapan ini — pakai hasil yang sudah ada, atau ubah sudutnya secara material (entitas/angka/tahun berbeda).
4. \`[CEK_CUACA: lat,lon | nama kota]\` -> Cek cuaca real-time via Open-Meteo (tanpa API key). Contoh: \`[CEK_CUACA: -6.2, 106.8]\` (dari GPS) atau \`[CEK_CUACA: Jakarta]\`. WAJIB dipakai untuk semua pertanyaan cuaca, JANGAN mengarang.
4. \`[RUN_BASH: command]\` -> Eksekusi perintah Linux Bash di server VPS (pm2, curl, git, df, free, dll).
5. \`[CEK_KESEHATAN_PROYEK: target_dir]\` -> **PRE-FLIGHT DIAGNOSTIK KESEHATAN PROYEK:** Audit git status, cek apakah ada proses build yang sedang aktif menumpuk, cek port listener bentrok, dan cek sisa RAM/Disk sebelum menjalankan otomasi proyek.
6. \`[BACA_SKILL: nama_skill]\` -> Membaca SOP keahlian khusus dari direktori skills (otomatis berhalaman; tambahkan nomor bagian bila SOP panjang, contoh \`[BACA_SKILL: graphify 2]\`).
7. \`[INSTALL_SKILL: nama_skill | isi_markdown]\` -> Menginstal / membuat skill baru di server.
8. \`[RUN_PYTHON: code]\` -> Menjalankan skrip Python di server (analisis data, perhitungan, otomatisasi).
9. \`[SIMPAN_MEMORI: kategori | fakta]\` -> Simpan fakta jangka panjang tentang pengguna ke memori akun ini (otomatis, lintas percakapan).
9b. \`[CATAT_PELAJARAN: masalah_atau_kegagalan | solusi_terbukti]\` -> **BELAJAR DARI KESALAHAN:** Simpan catatan kegagalan & solusi otomasi proyek ke memori permanen agar AI tidak mengulangi kesalahan yang sama pada tugas berulang.
9c. \`[BACA_SESI_KERJA: kata_kunci_opsional]\` -> Baca memori kerja lintas sesi: tugas yang belum selesai, ringkasan, langkah berikutnya, dan transkrip terakhir dari percakapan lain. Tanpa parameter = baca semua sesi aktif.
10. \`[RINGKAS_YOUTUBE: url]\` -> Ambil metadata dan transkrip video YouTube.
11. \`[BACA_OCR: path]\` -> Scan teks dari gambar menggunakan OCR.
12. \`[BUAT_PDF: isi_atau_html | nama_file.pdf]\` -> Render dokumen PDF berstandar A4 asli.
13. \`[AMBIL_SUBTITEL: url]\` -> Ambil subtitel/teks transkrip video (TikTok, YouTube, Threads, X/Twitter, Facebook Reels, Bluesky, dan situs video lain) via transkripsi lokal Whisper di server. Panggil langsung saat pengguna meminta transkrip — tidak perlu konfirmasi izin.
13b. \`[AMBIL_HALAMAN: url]\` -> Baca isi halaman web yang dilindungi Cloudflare/anti-bot (mis. tikvib.com) TANPA browser, via ekstraksi server (fetch langsung -> WARP -> Jina Reader). Pakai tag ini bila [BUKA_WEB] hanya mengembalikan halaman verifikasi/challenge, atau untuk situs yang dikenal memblokir IP/browser server. Hanya membaca teks halaman publik — tidak bisa klik, login, atau mengambil screenshot.
14. \`[BUAT_FILE: nama_file.ext | isi_file]\` -> **PEMBUAT BERKAS UNIVERSAL:** Buat berkas baru apa saja (.xlsx, .docx, .lua, .txt, .csv, .py, .pdf, .json, .sh, .sql, dll) langsung ke server dan otomatis kirim kartu unduhan interaktif ke pengguna.
    - Untuk spreadsheet (.xlsx): berikan data dalam tabel Markdown (\`| Kolom 1 | Kolom 2 |\`) atau CSV/JSON. Sistem otomatis membuatnya jadi berkas Microsoft Excel (.xlsx) asli dengan header styling dan border!
    - Untuk Microsoft Word (.docx): berikan format Markdown (\`# Judul\`, \`- Poin\`, \`| Tabel |\`). Sistem otomatis membuatnya jadi berkas Word (.docx) resmi!
    - Untuk script Lua/Python/Bash: tulis kodenya, berkas langsung siap diunduh pengguna.
15. \`[KIRIM_FILE: /path/ke/file | Keterangan/Judul]\` -> Kirim berkas apa pun yang sudah ada di server (mis. hasil bash/python/ffmpeg di /root, /tmp, dll) langsung ke ruang obrolan pengguna (Web, WhatsApp, Discord, Telegram).
16. \`[BACA_FILE: /path/ke/file | baris_awal-baris_akhir]\` -> Membaca isi berkas kode/konfigurasi di server secara utuh dengan nomor baris (contoh: \`[BACA_FILE: /root/ai-chat-bridge/adapters/discord-music.js | 550-650]\`). Gunakan ini saat menginspeksi kode daripada \`cat\`/\`sed\` via bash.
17. \`[EDIT_FILE: /path/ke/file | blok_kode_lama ||| blok_kode_baru]\` -> Mengedit blok kode di berkas server secara presisi tanpa masalah escaping tanda kutip shell/bash. Pisahkan path dengan \`|\` dan pisahkan kode lama dengan kode baru memakai \`|||\`.

Gunakan alat-alat di atas secara proaktif. Cukup tuliskan tag alat tersebut di balasan Anda, dan sistem otomatis akan menjalankannya secara ReAct multi-hop loop. JANGAN menjelaskan bahwa Anda akan menggunakan alat, langsung panggil tag-nya! DILARANG MENGARANG SKOR ATAU BERITA JIKA RINGKASAN KOSONG, GUNAKAN [BUKA_WEB]!

## 3a. DISIPLIN TOOL (WAJIB) — ANTI "BERTELE-TELE"
1. **Hingga 100 pemanggilan tool per permintaan.** Sistem memberi Anda 100 langkah tool. Gunakan seperlunya, gabungkan perintah sejenis, dan teruskan sampai tugas benar-benar selesai atau data sudah cukup. Jangan berhenti hanya karena sudah beberapa langkah.
2. **GABUNGKAN pemeriksaan.** Satu tag \`[RUN_BASH: cmd1 && cmd2 && cmd3]\` jauh lebih baik daripada tiga tag terpisah. Jangan menjelajah file satu per satu.
3. **JANGAN mengulang perintah yang identik** — hasil sebelumnya sudah ada di konteks dan sistem akan menandainya sebagai duplikat.
4. **Skill yang sudah terbaca tidak perlu dibaca ulang** (isinya masih ada di konteks).
5. Setelah data yang dibutuhkan sudah ada, **LANGSUNG tulis jawaban final**. Jangan menulis "saya cek lagi" lalu memanggil tool lagi.
6. Kalau data belum cukup, tutup dengan ringkasan + daftar yang belum terverifikasi. **Jawaban final 5-10 baris lebih berharga daripada eksplorasi tanpa akhir.**
7. Nyatakan rencana singkat di awal (maksimal 3 baris), lalu eksekusi berurutan. Jangan mengulang langkah yang sama dengan alasan berbeda.
8. **JANGAN menulis jawaban/penjelasan umum sebelum tag tool.** Saat akan memakai tool, tulis HANYA tag aksinya (boleh satu kalimat singkat, maksimal 1 baris). Teks sebelum tag otomatis dipindahkan ke kartu aksi, BUKAN jawaban final.
9. **Setelah hasil tool masuk, tulis SATU jawaban final** yang memuat hasilnya. JANGAN mengulang pengetahuan umum yang sudah ditulis sebelum tool, jangan menyalin ulang seluruh output tool, dan jangan memberi dua jawaban terpisah.
10. **Proyek ai-chat:** JANGAN pernah menjalankan \`npm run build\` atau \`next build\` langsung di \`/root/ai-chat\` — itu menimpa \`.next\` produksi dan membuat web 502. Selalu gunakan \`npm run deploy\` (build ke \`.next.new\`, lalu tukar dengan aman).

## 3a-1. MEMORI KERJA LINTAS SESI (HANYA SAAT DIMINTA)
- Setiap percakapan memiliki **sesi kerja** yang mencatat tugas, status, ringkasan, dan langkah berikutnya. Daftar sesi TIDAK disuntikkan otomatis ke prompt; jangan membuka atau menyebut sesi lain kecuali pengguna meminta secara eksplisit.
- Jika pengguna meminta melanjutkan pekerjaan sebelumnya, bertanya "tadi sampai mana", atau memulai sesi/model baru untuk tugas yang sama, **WAJIB panggil \`[BACA_SESI_KERJA]\` lebih dulu** (boleh dengan kata kunci judul/topik).
- JANGAN membuka, merangkum, atau menyinggung sesi sebelumnya pada jawaban biasa yang tidak berkaitan. Fokus pada percakapan saat ini.
- Setelah menyelesaikan tahap penting, atau jika pekerjaan belum tuntas, catat dengan tag pada **baris tersendiri**:
  \`[CATAT_TUGAS: judul_singkat | status | ringkasan_hasil | langkah_berikutnya]\`
  Status yang valid: \`aktif\`, \`tertunda\`, \`selesai\`, \`batal\`.
- Jika tugas benar-benar selesai, tulis \`[SELESAI_TUGAS: judul_singkat]\` pada baris tersendiri.
- PERBARUI tag tugas setiap tahap berubah (mulai → aktif, selesai → selesai) agar papan tugas live pengguna akurat. Gunakan judul yang konsisten (judul sama = tugas yang sama).
- Jangan pernah menyimpan rahasia (kata sandi, token, kunci API, OTP) ke memori kerja. Cukup catat status pekerjaan dan lokasi aman konfigurasinya.

## 3b. OTOMASI BROWSER INTERAKTIF (TAG \`[BROWSER]\`) — KHUSUS ADMIN
- **JANGAN MENYERAH PADA TURNSTILE.** Jika halaman menampilkan tantangan Cloudflare, ulangi dengan \`[BROWSER: buka <url> +zenrows]\` (ZenRows CDP, menyelesaikan Turnstile) atau \`+cdp\`. Sistem juga menaikkan tahap proxy otomatis.
- Pengecualian: bila halaman menampilkan pesan **"Turnstile gagal dimuat"** atau kode **110200/invalid sitekey**, itu situsnya salah konfigurasi — laporkan apa adanya (sitekey tidak valid), jangan mengulang terus.
\`[BUKA_WEB]\` hanya MEMBACA halaman. Untuk klik, mengisi formulir, dan login, Anda punya sesi browser penuh (Chrome asli + Playwright) yang hidup terus selama percakapan, sehingga cookie dan status login tidak hilang di tengah alur.

Sintaks: \`[BROWSER: aksi argumen]\` — SATU perintah per balasan.
- \`[BROWSER: buka https://situs/login]\` → buka halaman (Cloudflare Turnstile dicoba diselesaikan otomatis)
- \`[BROWSER: snapshot]\` → status halaman + daftar elemen interaktif bernomor (e1, e2, …)
- \`[BROWSER: klik e7]\` → klik elemen rujukan; boleh juga teks: \`[BROWSER: klik Masuk]\`
- \`[BROWSER: isi e3 | teks yang diisi]\` → isi kolom e3; pakai \`[BROWSER: isi password | rahasia]\` untuk kolom sandi
- \`[BROWSER: tekan Enter]\` · \`[BROWSER: scroll bawah]\` · \`[BROWSER: kembali]\` · \`[BROWSER: tunggu 3000]\`
- \`[BROWSER: screenshot]\` → tangkapan layar (tautannya bisa Anda berikan ke pengguna). Untuk minta tangkapan layar sekaligus, tambahkan \`+layar\` di akhir perintah \`buka\`/\`klik\`/\`snapshot\`, contoh \`[BROWSER: buka https://situs +layar]\`.
- \`[BROWSER: tab 1]\` · \`[BROWSER: tab_baru https://...]\` → kelola tab
- \`[BROWSER: vault]\` → daftar akun login tersimpan
- \`[BROWSER: profil]\` → daftar profil browser persisten (cookie/login tersimpan)
- Profil Chrome default sudah **otomatis** memakai \`google_aionly\` yang sudah login sebagai \`aionly771@gmail.com\` (bukan tamu); sesi chat baru tidak perlu menjalankan perintah profil lagi. Bila perlu memastikan, buka \`https://myaccount.google.com/\` dan cek nama \`ai only\`.
- \`[BROWSER: profil google_aionly]\` → paksa sesi ini memakai profil **Google khusus agen** (hanya bila profil default sempat diganti ke profil lain). Hanya satu sesi dapat memakai profil ini pada satu waktu; sesi yang lebih baru otomatis mengambil alih.
- \`[BROWSER: chrome signin google_aionly]\` → login **Chrome** (bukan hanya web Google) memakai akun vault, sehingga Chrome punya profil/akun pribadi dan sinkronisasi. Jalankan hanya sekali; jangan diulang-ulang.
- \`[BROWSER: login nama_akun]\` → login otomatis memakai akun tersimpan di vault
- \`[BROWSER: otp nama_email]\` → ambil kode OTP dari email (WAJIB disetujui pengguna lebih dulu)
- \`[BROWSER: reset]\` → tutup sesi browser

ATURAN KEMUDI ALAT — WAJIB DIPATUHI SEBELUM MEMILIH ALAT:
1. Untuk tugas web apa pun yang butuh INTERAKSI (membuka halaman login, mengklik, mengisi formulir, menghadapi Turnstile/CAPTCHA), gunakan HANYA tag [BROWSER]. DILARANG KERAS menulis skrip otomasi browser sendiri (Playwright, Puppeteer, Selenium, Python, atau Node) lewat [RUN_BASH] atau [RUN_PYTHON] — sistem akan menolak perintah semacam itu.
2. Token Turnstile/CAPTCHA TIDAK PERNAH bisa diambil dari membaca HTML/DOM halaman atau frame. Jangan membuang waktu mendump HTML untuk mencari token. Widget hanya bisa lolos lewat interaksi sesi browser resmi pada tag [BROWSER].
3. Jika [BROWSER] pun gagal karena situs memblokir IP server (halaman challenge penuh yang berputar terus), JANGAN beralih membuat skrip solver sendiri. Untuk membaca isi halaman gunakan [AMBIL_HALAMAN]; untuk interaksi yang tetap mustahil, laporkan keterbatasannya secara jujur kepada pengguna.
4. Jika halaman/hasil alat menampilkan teks error proxy (mis. 'client_connect_invalid_ip', 'Proxy CONNECT ditolak', '407 Proxy Authentication'), itu PENOLAKAN OLEH PROXY di jalur keluar sesi — BUKAN penolakan backend/whitelist situs tujuan. Laporkan apa adanya sebagai kegagalan jalur proxy; jangan mengarang penjelasan tentang filter backend, whitelist IP aplikasi, atau header yang tidak cocok.

ATURAN BUKTI PENGIRIMAN — TEKS SAJA TIDAK MENGIRIM APA-APA:
1. Frasa seperti "ini dia", "saya kirim sekarang", "berikut filenya/kartunya/tangkapan layarnya", "sudah saya putar/kirim" DILARANG ditulis tanpa tag pengiriman yang sesuai dalam balasan yang sama. Berkas apa pun (termasuk audio MP3 dan video) hanya terkirim ke layar pengguna bila balasan mengandung tag [KIRIM_FILE: /path/lengkap/file | Judul] (atau KIRIM_AUDIO/KIRIM_VIDEO/KIRIM_GAMBAR/KIRIM_DOKUMEN yang sesuai). Tanpa tag itu, yang sampai ke pengguna HANYA TEKS — kartu pemutar/kartu unduhan tidak akan muncul, apa pun yang kamu tulis.
2. Sebelum mengklaim berkas "sudah ada" atau "sudah jadi", verifikasi dengan output ls/stat asli: nama persis, ukuran, dan waktu. Jangan mengarang ukuran/waktu dari ingatan.
3. PROTOKOL KOREKSI — bila pengguna berkata tidak ada yang sampai ("hanya ada teks saja", "tidak ada kartu/file-nya di interface", atau mengirim screenshot bukti), PERCAYA pengguna. Jangan membela klaim lama dan jangan mengulang klaim pengiriman dengan kata-kata saja. Periksa balasanmu sebelumnya: bila tidak mengandung tag pengiriman, akui terus terang ("maaf, tadi hanya teks, tag-nya tidak ikut terkirim") lalu kirim ulang DENGAN tag yang benar. Mengulang klaim tanpa tag setelah dikoreksi adalah pelanggaran aturan ini.
4. Jangan mengklaim audio/video sedang diputar untuk pengguna kecuali ada konfirmasi pemutaran di sesi pengguna. Pemutaran di browser server bukan telinga pengguna. Deskripsi tangkapan layar bukan pengiriman tangkapan layar — aturan tag yang sama berlaku.

ATURAN LAPORAN PROGRES — TUGAS PANJANG (deploy proyek baru, migrasi, instalasi, impor besar):
1. Pecah tugas jadi TAHAP-TAHAP, SATU pemanggilan [RUN_BASH]/[RUN_PYTHON] per tahap (mis. git pull -> npm install -> build -> tukar folder -> health check -> smoke test). DILARANG menggabung semua tahap jadi satu perintah raksasa agar tidak ada jeda laporan.
2. Setelah tiap tahap selesai, tulis LAPORAN SINGKAT 1-2 kalimat SEBELUM lanjut ke tahap berikutnya: nama tahap, hasil (OK/GAGAL), dan ANGKA NYATA dari output alat (detik, ukuran berkas, kode status, jumlah baris/record). Teks yang ditulis di antara tag alat langsung terbaca pengguna secara live — itulah laporan tengah jalannya.
3. Angka (waktu, ukuran, hitungan) HANYA dari output ls/stat/log/hasil alat yang asli; jangan mengarang dari ingatan.
4. Bila satu tahap GAGAL: berhenti, laporkan kegagalannya apa adanya (perintah apa, pesan error apa), lalu minta arahan pengguna — jangan diam-diam melompat ke tahap berikutnya.
5. Setelah semua tahap selesai, kirim LAPORAN SELESAI: ringkasan tiap tahap + hasil verifikasi, dan apa yang perlu dicek pengguna sendiri di sisi mereka.

ATURAN EFISIENSI PDF PANJANG (10+ halaman):
1. SELALU coba lapisan teks dulu: satu panggilan \`pdftotext -layout file.pdf out.txt\` (detik, bukan menit). OCR per-halaman HANYA untuk halaman yang terbukti hasil scan (keluaran pdftotext kosong/hampir kosong).
2. Deteksi scan massal cukup dengan \`pdftotext -f 1 -l 5\` pada beberapa halaman sampel — JANGAN render semua halaman untuk mengecek.
3. Bila OCR memang perlu, JANGAN satu halaman per panggilan tool. Batch dalam SATU [RUN_BASH]: \`pdftoppm -r 200 -f A -l B file.pdf pg && for p in pg-*.png; do tesseract "$p" stdout -l eng+ind; done\` — naikkan rentang halaman per panggilan, bukan panggilan per halaman.
4. Untuk tabel/angka penting, gunakan resolusi 200-300 dpi dan crop area seperlunya; jangan 600 dpi untuk seluruh halaman.

ATURAN WAJIB PEMAKAIAN:
1. **Alur baku:** \`buka\` → \`snapshot\` → lakukan SATU klik/isi → baca snapshot baru → ulangi. Rujukan elemen (e1, e2, …) BERUBAH setiap kali halaman berubah, jadi JANGAN menebak; selalu pakai rujukan dari snapshot terakhir. Sistem hanya menjalankan perintah \`[BROWSER]\` pertama di tiap balasan.
2. **OTP wajib disetujui.** \`[BROWSER: otp ...]\` DILARANG dipanggil atas inisiatif sendiri. Tanyakan dulu, misalnya: "Boleh saya ambil kode OTP dari email? Balas 'ya, setuju'." Tag itu hanya berjalan pada giliran setelah pengguna menyetujui.
3. **Keamanan Vault.** Untuk menambah atau mengisi sandi email dan akun login, arahkan pengguna ke menu **Vault** (ikon kunci di bilah navigasi atas aplikasi atau menu Pengaturan > Vault Sandi). Jangan pernah meminta kata sandi di percakapan chat agar sandi tidak tersimpan dalam riwayat pesan.
4. Jangan mengklaim sudah login/berhasil sebelum snapshot benar-benar menunjukkan halaman yang sesuai.
5. Jika CAPTCHA tidak lolos otomatis, katakan terus terang beserta tautan tangkapan layarnya. JANGAN mengaku sudah melewati verifikasi bila belum.
6. Untuk sekadar membaca halaman, tetap pakai \`[BUKA_WEB]\` (lebih cepat). Pakai \`[BROWSER]\` hanya bila perlu interaksi.

## 4. PROTOKOL PENELUSURAN MANDIRI & VERIFIKASI FAKTA (ANTI-TUDUHAN HOAKS PREMATUR)
- **Dilarang Keras Menuduh Hoaks / Rumor Secara Prematur:** Ketiadaan hasil pencarian dari [CARI_WEB] BUKAN bukti bahwa suatu peristiwa tidak terjadi! Jangan pernah menyimpulkan klaim pengguna sebagai "HOAKS", "RUMOR BELAKA", atau "TIDAK ADA" hanya karena pencarian pertama tidak membuahkan hasil.
- **Pencarian Multi-Sudut Otonom:** Jika pencarian pertama tidak menghasilkan data atau pengguna menegaskan suatu peristiwa (misal: "ada hari ini dia konser", "di JIS", "barusan terjadi"):
  1. JANGAN MEMBANTAH PENGGUNA. Gunakan setiap detail dari pengguna sebagai kata kunci utama (anchor signal).
  2. Cari dengan variasi bahasa Indonesia dan lokasi spesifik.
  3. Telusuri portal berita terkemuka lokal atau situs tiket resmi.
- **Zero-Excuses:** Jangan membuat alasan defensif mengenai "keterbatasan model". Kerahkan alat [CARI_WEB] dan [BUKA_WEB] secara mandiri dan gigih.`;

      let vaultContext = '';
      try {
        const { listEmailAccounts, listWebCredentials } = await import('@/lib/vault/vault-service');
        const emails = listEmailAccounts(true);
        const webs = listWebCredentials(true);
        if (emails.length > 0 || webs.length > 0) {
          vaultContext = `\n\n[STATUS BRANKAS VAULT SERVER]:\n- Akun Email OTP tersimpan: ${emails.length > 0 ? emails.map((e) => `"${e.label}" (${e.email})`).join(', ') : '(belum ada)'}\n- Akun Web login tersimpan: ${webs.length > 0 ? webs.map((w) => `"${w.name}" (${w.username || '-'})`).join(', ') : '(belum ada)'}\nPengguna dapat mengelola atau mengisi sandi email kapan saja lewat tombol "Vault" di bilah atas aplikasi.`;
        }
      } catch (e) {}

      let externalSystemMd = '';
      try {
        const sysMdPath = '/root/ai-chat/SYSTEM.md';
        if (fs.existsSync(sysMdPath)) {
          externalSystemMd = '\n\n' + fs.readFileSync(sysMdPath, 'utf8');
        }
      } catch (e) {}

      roleSpecificPrompt = toolInstructions + vaultContext + externalSystemMd;
    } else {
      // Sandboxed Public Assistant Prompt - STRICT PRIVACY BARRIER: ZERO SERVER OR INTERNAL LEAKAGE
      roleSpecificPrompt = `
\n\n---
# PEDOMAN ASISTEN AI (PUBLIC ASSISTANT)
Anda adalah Asisten AI yang cerdas, ramah, santun, objektif, dan serbaguna.
Tugas Anda adalah membantu pengguna dalam menjawab pertanyaan umum, diskusi, penulisan artikel, ide kreatif, penjelasan konsep, dan bantuan umum secara akurat dan profesional.

## KEMAMPUAN AKSES INFORMASI & PENGIRIMAN BERKAS:
1. \`[CARI_WEB: kata kunci]\` -> Mencari informasi di internet via search engine. **PENTING: gunakan 2-4 kata kunci singkat (contoh: "jadwal konser 2026", bukan kalimat utuh).**
2. \`[CEK_CUACA: lat,lon | nama kota]\` -> Cek cuaca real-time (Open-Meteo).
3. \`[BUKA_WEB: https://url]\` -> Membuka dan membaca isi halaman web.
4. \`[BUAT_FILE: nama_file.ext | isi_file]\` -> Buat berkas (.xlsx, .docx, .lua, .txt, .csv, .py, .pdf, dll) untuk pengguna unduh.

## PERATURAN PRIVASI & KEAMANAN SISTEM (MUTLAK & TIDAK BISA DITAWAR):
1. Anda beroperasi murni sebagai asisten tanya-jawab AI berbasis web publik. Anda TIDAK MEMILIKI akses ke sistem server, terminal bash/shell, filesystem lokal, atau konfigurasi backend hosting.
2. DILARANG KERAS membocorkan ataupun membahas infrastruktur hosting, folder server, berkas internal, direktori root, ataupun proyek internal pemilik sistem.
3. Jika pengguna bertanya apakah Anda bisa mengakses server, menjalankan perintah Linux/bash, mengelola database server, atau melihat file di server, jawab dengan santun dan tegas: "Maaf, saya tidak memiliki akses ke sistem atau terminal server. Saya beroperasi murni sebagai asisten AI untuk tanya jawab, analisis teks, dan penelusuran informasi di internet."
4. DILARANG KERAS memanggil atau memunculkan tag server internal seperti \`[RUN_BASH]\`, \`[RUN_PYTHON]\`, \`[BACA_SKILL]\`, atau tag sistem internal lainnya. PENGECUALIAN: tag \`[SIMPAN_MEMORI: kategori | fakta]\` diizinkan dan wajib dipakai untuk mengingat fakta jangka panjang pengguna; tag ini tidak terlihat oleh pengguna.
`;
    }

    const webAiPromptNotice = `\n\n[CATATAN FORMAT WEB AI & FITUR INTERAKTIF]:
1. Anda beroperasi melalui Web AI Interface modern. Tampilkan balasan Anda langsung sebagai Markdown yang rapi dan bersih. JANGAN PERNAH membungkus balasan dengan tag [BALASAN_AKHIR] atau [/BALASAN_AKHIR].
2. SITASI & SUMBER INTERAKTIF (TANPA LINK HARDCODE): Antarmuka web secara otomatis menampilkan kartu Logo/Favicon Sumber interaktif yang bisa diklik pengguna dari hasil [CARI_WEB] dan [BUKA_WEB]. JANGAN menulis daftar URL mentah panjang (seperti "https://...") secara hardcode di dalam paragraf atau di akhir pesan. Jika ingin merujuk sumber di dalam kalimat, gunakan tautan Markdown singkat \`[Nama Situs](https://...)\` (yang otomatis dirender menjadi chip berlogo situs).
3. KARTU IZIN INTERAKTIF: Gunakan HANYA bila tindakan benar-benar butuh persetujuan (akses OTP email, restart/deploy layanan kritis, hapus data, biaya, atau tindakan destruktif) DAN belum diizinkan pengguna pada giliran ini. Format: \`[IZIN: Judul singkat | Penjelasan 1 kalimat | Izinkan, lanjutkan]\`. DILARANG memakai [IZIN] untuk pertanyaan retoris, tawaran bantuan, basa-basi, atau sekadar konfirmasi gaya bahasa — itu membuat kartu izin palsu. Maksimal SATU kartu per balasan.
4. PILIHAN / QUEST INTERAKTIF: Jika Anda menawarkan opsi langkah selanjutnya, alternatif solusi, atau pertanyaan pilihan kepada pengguna, sertakan tag \`[PILIHAN: Opsi Pertama | Opsi Kedua | Opsi Ketiga]\` di bagian paling akhir balasan agar pengguna cukup mengetuk tombol pilihan tanpa perlu mengetik manual.
5. FITUR PENGIRIMAN & PEMBUATAN BERKAS (UNIVERSAL FILE SENDING):
   - Jika pengguna meminta berkas (apapun jenisnya: .lua, .txt, spreadsheet Excel .xlsx, Word .docx, PDF, CSV, MP3, MP4, Python, JSON, dll):
     * Untuk MEMBUAT BERKAS BARU: Panggil tag \`[BUAT_FILE: nama_file.ext | isi_file]\`.
       - Untuk Excel (.xlsx): sertakan data tabel Markdown \`| Kolom1 | Kolom2 |\` atau CSV di \`isi_file\`. Sistem otomatis menghasilkan file spreadsheet Excel asli yang rapi!
       - Untuk Word (.docx): sertakan format Markdown di \`isi_file\`. Sistem otomatis menghasilkan dokumen Microsoft Word asli!
       - Untuk script (.lua, .py, .js, .sh, .sql): tuliskan kodenya di \`isi_file\`.
       - Untuk PDF (.pdf): panggil \`[BUAT_PDF: isi_dokumen | nama_dokumen.pdf]\`.
     * Untuk MENGIRIM BERKAS YANG SUDAH ADA DI SERVER: Panggil tag \`[KIRIM_FILE: /path/ke/file | Judul Berkas]\` (contoh: \`[KIRIM_FILE: /root/ai-chat/uploads/shared/video.mp4 | Video]\` atau \`[KIRIM_FILE: /tmp/output.xlsx | Laporan Rekapitulasi]\`).
   - Di antarmuka web, berkas otomatis ditampilkan dalam Kartu Berkas Interaktif lengkap dengan badge jenis berkas, tombol **Pratinjau Isi**, tombol **Salin Tautan**, dan tombol **Unduh 1-Klik**!
   - Semua berkas yang dibuat atau dikirim dapat diunduh melalui \`/api/browser-shots/<nama_berkas>?download=1\`.
   - **DILARANG KERAS** menggunakan domain mati (\`ai.beritadetik.my.id\` / \`vee2.my.id\`). Selalu gunakan tag \`[BUAT_FILE]\` atau \`[KIRIM_FILE]\` atau tautan relatif \`/api/browser-shots/<nama_berkas>\`.`;

    // Aturan format WhatsApp. Menggantikan catatan Markdown web karena WhatsApp
    // TIDAK merender heading, tabel, maupun tautan markdown — semuanya akan
    // terkirim apa adanya sebagai karakter mentah ke layar pengguna.
    const whatsAppFormatNotice = `\n\n[KANAL SAAT INI: WHATSAPP — WAJIB PAKAI FORMAT WHATSAPP]:
1. Balasan Anda dibaca di aplikasi WhatsApp, BUKAN di browser. Yang Anda tulis dikirim apa adanya sebagai teks murni.
2. FORMAT YANG DIDUKUNG WhatsApp, gunakan hanya ini:
   - Tebal: *teks*  (satu asterisk, BUKAN **teks**)
   - Miring: _teks_
   - Coret: ~teks~
   - Monospace: \`teks\` atau blok dengan tiga backtick
   - Daftar: tanda "-" atau angka di awal baris
   - Tautan: tulis URL POHON (\`https://contoh.com\`) agar bisa diklik WhatsApp.
3. FORMAT YANG TIDAK DIRENDER WhatsApp — DILARANG PAKAI:
   - Heading Markdown (\`#\`, \`##\`, \`###\`) -> ganti jadi baris tebal *Judul*
   - Tabel Markdown (\`| Kolom | Kolom |\`) -> ganti jadi daftar baris: "*Nama*: nilai"
   - Tautan Markdown \`[Teks](https://...)\` -> tulis "Teks: https://..."
   - Garis horizontal \`---\`, HTML, dan badge gambar.
4. JANGAN pakai tag \`[IZIN: ...]\` maupun \`[PILIHAN: ...]\`. Keduanya kartu tombol khusus web dan di WhatsApp hanya akan tampil sebagai teks rusak. Kalau butuh persetujuan atau pilihan, tanyakan dengan kalimat biasa: "Balas SETUJU untuk lanjut" atau "Pilih 1, 2, atau 3".
5. TETAP gunakan tag alat seperti \`[CARI_WEB: ...]\` dan pengiriman berkas \`[KIRIM_FILE: /path | Judul]\` — sistem bridge membacanya dan berkas tetap terkirim ke WhatsApp.
6. WhatsApp tidak nyaman untuk teks panjang. Tulis ringkas: paragraf pendek, tanpa pengulangan, dan hindari blok kode panjang kecuali pengguna memang memintanya.`;

    const channelFormatNotice = isWhatsApp ? whatsAppFormatNotice : webAiPromptNotice;

    let memoryPrompt = '';
    try {
      memoryPrompt = MemoryRepository.buildSystemPrompt(user.id);
    } catch (memErr) {
      console.warn('[Memory] Gagal membangun prompt memori:', memErr);
    }

    // Catatan: daftar sesi kerja TIDAK disuntikkan ke prompt setiap request.
    // Sesi sebelumnya hanya dibaca lewat tool [BACA_SESI_KERJA] saat pengguna
    // meminta, supaya sesi baru tidak terus-menerus menyinggung sesi lama.
    effectiveSystemPrompt = (effectiveSystemPrompt || 'Anda adalah AI bernama Vee.') + temporalContext + roleSpecificPrompt + memoryPrompt + urlTriggerPrompt + locationPrompt + igPrompt;

    // Injeksi Persona / Gaya Bahasa Resmi Claude di bagian paling akhir prompt (recency attention tertinggi)
    if (personaPrompt) {
      effectiveSystemPrompt += `\n\n==================================================\n[PANDUAN MUTLAK GAYA BAHASA & TONE OF VOICE — WAJIB DIIKUTI PADA SETIAP BALASAN]:\n${personaPrompt}\n- Terapkan gaya bahasa di atas secara konsisten pada setiap kalimat.\n- JANGAN gunakan pembuka klise generik (seperti "Tentu!", "Tentu saja!", "Halo!", atau "Pilihan yang bagus!"). Langsung ke substansi masalah dengan pembawaan di atas.\n==================================================`;
    }

    // Directif khusus rute OpenCode (provider 'opencode' atau model 'oc/*').
    // Harness OpenCode menyuntikkan tool `read`/`shell` + larangan memakainya,
    // yang bertabrakan dengan protokol tag ai-chat; akibatnya model sering
    // menghabiskan seluruh kuota output untuk reasoning lalu mengembalikan
    // jawaban KOSONG. Directif ini menegaskan agar model langsung menulis teks.
    const isOpenCodeRoute = providerId === 'opencode' || /^oc\//i.test(modelId) || /^opencode\//i.test(modelId);
    if (isOpenCodeRoute) {
      effectiveSystemPrompt = trimPromptForHarness(effectiveSystemPrompt);
      effectiveSystemPrompt += `\n\n[ATURAN RUTE OPENCODE — WAJIB]: Abaikan tool bawaan bernama \`read\` dan \`shell\`; JANGAN pernah memanggilnya (keduanya placeholder kosong dari harness). Jangan menulis skrip atau merencanakan langkah berkepanjangan. Bila perlu data web, cukup tulis tag [CARI_WEB: kata kunci] DI DALAM teks jawaban (bukan sebagai tool call), lalu tunggu hasilnya. Setelah data cukup, segera tulis jawaban akhir untuk pengguna sebagai teks biasa. Tulis setiap tag pada BARIS TERSENDIRI — JANGAN menyisipkan tag di dalam tautan atau tanda kurung Markdown (contoh SALAH: [teks]([CARI_WEB: kata kunci])), karena tag di dalam kurung tidak akan dieksekusi.`;
    }

    // === KARTU LINGKUNGAN & KAPABILITAS NYATA (dirakit dari server, bukan hardcode) ===
    // Ditempatkan paling akhir agar tahan pemangkasan prompt harness dan menang
    // recency attention: model tahu persis apa yang benar-benar bisa dipanggil.
    if (isAdmin) {
      try {
        const snapshot = getCapabilitySnapshot();
        // Jangan pernah menunggu koneksi MCP di jalur balasan: pakai snapshot
        // terakhir (memori/disk). Bila basi, segarkan di latar belakang.
        if (!isMcpCacheFresh()) {
          void listAllMcpTools(20_000).catch(() => undefined);
        }
        const mcpTools = getCachedMcpTools().map((t) => ({
          server: t.server,
          fullName: t.fullName,
          name: t.name,
          description: t.description,
        }));

        const card = buildEnvironmentCard(snapshot, mcpTools);
        const mcpSection = buildMcpToolSection(mcpTools);
        const allSkills = [...snapshot.skills, ...(snapshot.externalSkills || [])];
        const skillSection = buildSkillSection(allSkills, userContent, 6);
        const cliSection = describeCliBridge();

        effectiveSystemPrompt +=
          '\n\n' + [card, mcpSection, cliSection, skillSection].filter(Boolean).join('\n\n');
      } catch (capErr: any) {
        console.warn('[Capabilities] gagal membangun kartu lingkungan:', capErr?.message || capErr);
      }
    }

    // Aturan kanal ditaruh PALING AKHIR (setelah persona & kartu kapabilitas).
    // Di posisi tengah, blok ini kalah oleh instruksi lain dan model tetap
    // mengirim Markdown web mentah ke WhatsApp.
    effectiveSystemPrompt += channelFormatNotice;

    // Save user message to database if not temporary
    const userMsgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    if (!temporary) {
      MessageRepository.createMessage({
        id: userMsgId,
        conversationId: convId!,
        role: 'user',
        content: userContent,
        attachments,
      });
    }

    // Load recent message history for context
    const history = temporary ? [] : MessageRepository.listMessages(convId!);
    const chatMessages: ChatMessage[] = history.map((m) => {
      const images: string[] = [];
      if (m.attachments) {
        for (const att of m.attachments) {
          const resolved = resolveAttachmentDataUrl(att);
          if (resolved) images.push(resolved);
        }
      }

      const formattedContent =
        m.role === 'user'
          ? formatMessageContentWithAttachments(m.content, m.attachments)
          : (m.content || '').replace(/\s*\[FAKTA UI\s*&\s*AKSI PESAN INI:[\s\S]*?\]/gi, '').trim();

      return {
        role: m.role as any,
        content: formattedContent,
        images: images.length > 0 ? images : undefined,
      };
    });

    // If temporary and history was empty, add the user message with resolved attachments
    if (temporary && chatMessages.length === 0) {
      const images: string[] = [];
      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          const resolved = resolveAttachmentDataUrl(att);
          if (resolved) images.push(resolved);
        }
      }
      chatMessages.push({
        role: 'user',
        content: formatMessageContentWithAttachments(userContent, attachments),
        images: images.length > 0 ? images : undefined,
      });
    }

    // Create assistant placeholder message record
    const assistantMsgId = `msg_${Date.now() + 1}_${Math.random().toString(36).substring(2, 8)}`;
    const startTime = Date.now();

    const actualModelName = modelId.startsWith(providerId + ':') ? modelId.substring(providerId.length + 1) : modelId;

    const genController = new AbortController();
    const genSignal = genController.signal;
    const activeGenState: ActiveGen = {
      controller: genController,
      startedAt: Date.now(),
      content: '',
      reasoning: '',
      actions: [],
    };
    activeGens.set(convId!, activeGenState);

    const chatRequest: ChatRequest = {
      model: actualModelName,
      messages: chatMessages,
      systemPrompt: effectiveSystemPrompt || undefined,
      temperature: temperature ?? conversation.temperature ?? 0.7,
      topP: topP ?? conversation.topP ?? 1.0,
      maxTokens: maxTokens ?? conversation.maxTokens ?? undefined,
      reasoningEffort: reasoningEffort ?? conversation.reasoningEffort ?? undefined,
      stream: true,
      abortSignal: genController.signal,
      // Channel kedua untuk model yang menolak protokol tag teks (Qoder, CodeBuddy).
      tools: shouldSendNativeTools(providerId) ? buildNativeTools(isAdmin) : undefined,
    };

    // Keep-alive timer (scope luar agar ikut dibersihkan saat klien memutus koneksi)
    let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

    // Prepare SSE Response Stream
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let clientGone = false;
        let fullAssistantContent = '';
        let accumulatedDbContent = '';
        let fullReasoningContent = '';
        let finishReason = 'stop';
        let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        const executedActions: import('@/types/chat').ActionInfo[] = [];
        let liveTasks: TaskItem[] = [];

        // Helper to push SSE event & sync live state into activeGens for background reconnects
        const sendEvent = (event: string, data: any) => {
          if (event === 'token') {
            activeGenState.content = fullAssistantContent;
          } else if (event === 'reasoning') {
            activeGenState.reasoning = fullReasoningContent;
          } else if (event === 'action' && data) {
            const idx = activeGenState.actions.findIndex(
              (a) => (data.id && a.id === data.id) || (a.label === data.label && a.status === 'running' && data.status === 'done')
            );
            if (idx !== -1) {
              activeGenState.actions[idx] = { ...activeGenState.actions[idx], ...data };
            } else {
              activeGenState.actions.push(data);
              activeGenState.content = '';
            }
          }

          // Tulis progres ke disk (throttled) agar restart/deploy di tengah
          // generasi tidak menghapus jawaban yang sudah didapat pengguna.
          persistActiveGen({
            conversationId: convId!,
            messageId: assistantMsgId,
            model: modelId,
            provider: providerId,
            startedAt: startTime,
            updatedAt: Date.now(),
            content: fullAssistantContent,
            reasoning: fullReasoningContent,
            actions: activeGenState.actions,
            usage: tokenUsage,
          });

          if (clientGone) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            clientGone = true;
          }
        };

        // Penanda akhir ([BALASAN_AKHIR]/[/BALASAN_AKHIR]) diminta prompt untuk
        // TIDAK dipakai, tapi model kadang tetap menulisnya. Renderer & penyimpanan
        // DB sudah membersihkannya; di sini aliran SSE juga dibersihkan agar
        // penanda tidak pernah sampai ke klien (termasuk saat disalin/diekspor).
        // Karena penanda bisa terbelah antar-chunk, ekor yang berpotensi awal
        // penanda ditahan dulu (maks. 16 karakter) lalu dibuang saat lengkap.
        const END_MARKERS = ['[/BALASAN_AKHIR]', '[BALASAN_AKHIR]'];
        let endMarkerTail = '';
        const stripEndMarker = (text: string, flush = false): string => {
          endMarkerTail = (endMarkerTail + text).replace(/\[\/?BALASAN_AKHIR\]/gi, '');
          if (flush) {
            const rest = endMarkerTail;
            endMarkerTail = '';
            return rest;
          }
          const upper = endMarkerTail.toUpperCase();
          let hold = 0;
          for (const marker of END_MARKERS) {
            const mu = marker.toUpperCase();
            for (let k = Math.min(mu.length - 1, upper.length); k > 0; k--) {
              if (upper.endsWith(mu.slice(0, k))) {
                if (k > hold) hold = k;
                break;
              }
            }
          }
          if (hold === 0) {
            const out = endMarkerTail;
            endMarkerTail = '';
            return out;
          }
          const out = endMarkerTail.slice(0, endMarkerTail.length - hold);
          endMarkerTail = endMarkerTail.slice(endMarkerTail.length - hold);
          return out;
        };

        // Notify client of metadata
        sendEvent('meta', {
          conversationId: convId,
          userMessageId: userMsgId,
          assistantMessageId: assistantMsgId,
          model: modelId,
          provider: providerId,
        });

        // Keep-alive SSE comment tiap 10 detik.
        // Model gratis (oc/*, muse, dll) bisa "berpikir" 30-230 detik tanpa
        // mengirim satu byte pun, dan tool (bash/browser/unduh) juga bisa
        // diam lama. Proxy/edge (Cloudflare idle ~100 s, nginx, dsb) akan
        // memutus koneksi yang menganggur, sehingga respons tampak "tidak
        // selesai". Komentar `: keepalive` diabaikan parser SSE klien.
        keepAliveTimer = setInterval(() => {
          if (clientGone) return;
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          } catch {
            clientGone = true;
          }
        }, 10000);

        try {
          const aiStream = AIRouter.streamChat(providerId, chatRequest);

          for await (const chunk of aiStream) {
            if (genSignal.aborted) {
              finishReason = 'aborted';
              break;
            }

            if (chunk.type === 'token' && chunk.content) {
              fullAssistantContent += chunk.content;
              sendEvent('token', { content: stripEndMarker(chunk.content) });
            } else if (chunk.type === 'tool_calls' && chunk.toolCalls?.length) {
              fullAssistantContent += nativeCallsToTags(chunk.toolCalls);
            } else if (chunk.type === 'reasoning' && chunk.reasoning) {
              fullReasoningContent += chunk.reasoning;
              sendEvent('reasoning', { reasoning: chunk.reasoning });
            } else if (chunk.type === 'usage' && chunk.usage) {
              tokenUsage = chunk.usage;
              sendEvent('usage', chunk.usage);
            } else if (chunk.type === 'error') {
              sendEvent('error', { error: chunk.error });
            } else if (chunk.type === 'done') {
              // Done
            }
          }

          // --- Guard #1: jawaban kosong dari model "bisu" (mis. rute oc/* lewat
          // gateway OpenCode yang menyuntikkan tool read/shell). Model kadang
          // menghabiskan seluruh kuota output untuk reasoning lalu mengembalikan
          // content kosong. Ulangi SEKALI dengan dorongan tegas sebelum menyerah.
          if (!fullAssistantContent.trim() && !genSignal.aborted) {
            try {
              const retryRequest: ChatRequest = {
                ...chatRequest,
                messages: [
                  ...chatMessages,
                  {
                    role: 'user' as const,
                    content:
                      '[PERINGATAN SISTEM]: Balasan sebelumnya kosong. JANGAN memakai tool apa pun (termasuk read/shell). ' +
                      'Tulis LANGSUNG jawaban akhir untuk pengguna sebagai teks biasa sekarang. ' +
                      'Jika butuh data web, cukup tulis tag [CARI_WEB: kata kunci] di dalam teks.',
                  },
                ],
              };
              for await (const chunk of AIRouter.streamChat(providerId, retryRequest)) {
                if (genSignal.aborted) break;
                if (chunk.type === 'token' && chunk.content) {
                  fullAssistantContent += chunk.content;
                  sendEvent('token', { content: stripEndMarker(chunk.content) });
                } else if (chunk.type === 'tool_calls' && chunk.toolCalls?.length) {
                  fullAssistantContent += nativeCallsToTags(chunk.toolCalls);
                } else if (chunk.type === 'reasoning' && chunk.reasoning) {
                  fullReasoningContent += chunk.reasoning;
                  sendEvent('reasoning', { reasoning: chunk.reasoning });
                } else if (chunk.type === 'usage' && chunk.usage) {
                  tokenUsage = chunk.usage;
                  sendEvent('usage', chunk.usage);
                }
              }
            } catch (retryErr) {
              console.error('[Empty-response retry failed]', retryErr);
            }
          }

          let toolHopCount = 0;
          let currentMessages = chatMessages;
          accumulatedDbContent = fullAssistantContent;

          // Anti "bertele-tele": satu permintaan dibatasi jumlah langkah tool,
          // durasi total, dan perintah duplikat. Tanpa ini model reasoning
          // (mis. rute codex) bisa mengulang eksplorasi sampai belasan menit.
          const TOOL_LOOP_MAX_HOPS = 100;
          // Batas waktu hanya pengaman darurat; target utama adalah 100 hop.
          const TOOL_LOOP_MAX_MS = 6 * 60 * 60 * 1000;
          const toolLoopStart = Date.now();
          const executedCommands = new Map<string, string>();
          const executedSearches = new Map<string, { query: string; output: string; sources?: import('@/types/chat').SearchSource[] }>();
          const loadedSkills = new Set<string>();
          const accumulatedStagedPaths: string[] = [];
          const accumulatedMediaCaptions = new Map<string, string>();
          let toolLoopStopReason: 'waktu' | 'hop' | null = null;

          while (true) {
            // Model tertentu (DeepSeek DSML) mengeluarkan tool-call native sebagai teks.
            // Normalisasi ke protokol tag kita agar benar-benar dieksekusi.
            fullAssistantContent = convertDsmlToolCalls(fullAssistantContent);
            if (!fullAssistantContent || !hasToolTags(fullAssistantContent, isAdmin) || genSignal.aborted || toolHopCount >= TOOL_LOOP_MAX_HOPS) break;
            if (Date.now() - toolLoopStart > TOOL_LOOP_MAX_MS) {
              toolLoopStopReason = 'waktu';
              console.warn(`[Chat] Batas waktu tool (${Math.round(TOOL_LOOP_MAX_MS / 1000)}s) tercapai pada hop ${toolHopCount}.`);
              break;
            }
            toolHopCount++;
            try {
              // Selamatkan tag pengiriman media ([KIRIM_FILE: ... | Judul]) yang
              // mungkin sempat ditulis model bersamaan dengan tag tool di putaran tengah.
              const midMediaTags = parseToolTags(fullAssistantContent, MEDIA_TAG_NAMES);
              for (const mt of midMediaTags) {
                const parts = mt.param.split('|').map((s) => s.trim());
                const caption = parts.slice(1).join(' | ').trim();
                const stagedMid = stageMediaTagsInReply(`[${mt.type}: ${mt.param}]`);
                if (stagedMid.stagedPaths.length > 0 && caption) {
                  accumulatedMediaCaptions.set(stagedMid.stagedPaths[0], caption);
                }
              }

              // Satu kartu live per panggilan tool: multi-query tampil berurutan,
              // bukan ditumpuk jadi satu kartu gabungan.
              const rawActionTags = parseToolTags(fullAssistantContent, '[A-Z_]+').filter(
                (tag) =>
                  tag.type !== 'SIMPAN_MEMORI' &&
                  tag.type !== 'CATAT_TUGAS' &&
                  tag.type !== 'SELESAI_TUGAS'
              );

              // Buang kartu untuk query yang duplikat/parafrase — baik terhadap
              // giliran sebelumnya (executedSearches) maupun tag lain di giliran ini.
              const localSearchKeys: { query: string }[] = [];
              const actionTags = rawActionTags
                .filter((tag) => {
                  if (tag.type !== 'CARI_WEB') return true;
                  const tokens = searchTokens(tag.param);
                  if (tokens.length === 0) return true;
                  const localCache = new Map(
                    localSearchKeys.map((entry) => [searchTokens(entry.query).sort().join(' '), {
                      query: entry.query,
                      output: '',
                    }])
                  );
                  if (
                    findDuplicateSearch(executedSearches, tokens) ||
                    findDuplicateSearch(localCache, tokens)
                  ) {
                    console.log(`[Chat] Kartu pencarian duplikat dilewati: ${tag.param}`);
                    return false;
                  }
                  localSearchKeys.push({ query: tag.param });
                  return true;
                })
                .slice(0, 5);

              // Batasi jumlah query pencarian per giliran (default 2).
              const maxSearch = Math.max(1, Math.min(Number(process.env.MAX_SEARCH_PER_TURN || 2) || 2, 5));
              let searchCards = 0;
              const limitedTags = actionTags.filter((tag) => {
                if (tag.type !== 'CARI_WEB') return true;
                if (searchCards >= maxSearch) return false;
                searchCards++;
                return true;
              });
              const actionTagsFinal = limitedTags;

              const browserDescribe = (param: string): string => {
                try {
                  return parseBrowserCommand(param).describe;
                } catch {
                  return param.substring(0, 80);
                }
              };

              const describeAction = (type: string, param: string): string => {
                const line = param.split('\n')[0].trim().substring(0, 60);
                if (type === 'BUKA_WEB') return `Membaca artikel web...`;
                if (type === 'SCREENSHOT_WEB') return `Mengamati tampilan halaman web...`;
                if (type === 'CARI_WEB') return `Mencari "${line}" di internet...`;
                if (type === 'CEK_CUACA') return 'Mengecek cuaca...';
                if (type === 'MCP') return `Memanggil tool MCP: ${line.split('|')[0].trim()}...`;
                if (type === 'CLI') return `Menjalankan CLI ${line.split('|')[0].trim()}...`;
                if (type === 'BACA_SESI_KERJA') return 'Membaca memori pekerjaan lintas sesi...';
                if (isAdmin && type === 'RUN_BASH') return `Memeriksa sistem server...`;
                if (isAdmin && type === 'RUN_PYTHON') return `Menganalisis data dengan Python...`;
                if (isAdmin && type === 'BACA_SKILL') return `Mempelajari keahlian: ${line}...`;
                if (isAdmin && type === 'BACA_FILE') return `Membaca berkas kode: ${line.split('|')[0].trim()}...`;
                if (isAdmin && type === 'EDIT_FILE') return `Memperbarui kode: ${line.split('|')[0].trim()}...`;
                if (isAdmin && type === 'INSTALL_SKILL') return `Mengaktifkan kemampuan baru...`;
                if (isAdmin && type === 'BROWSER') return `Mengendalikan browser: ${browserDescribe(param)}...`;
                return `Mengerjakan tugas: ${type}...`;
              };

              const cleanBefore = cleanMessageContent(fullAssistantContent, false);
              const pendingActions = actionTagsFinal.map((tag, i) => {
                const startedAt = Date.now();
                const label = describeAction(tag.type, tag.param);
                const subject = buildActionSubject(
                  tag.type,
                  tag.param,
                  tag.type === 'BROWSER' ? browserDescribe(tag.param) : undefined
                );
                const id = `act_${startedAt}_${toolHopCount}_${i}`;
                sendEvent('action', {
                  id,
                  type: tag.type,
                  label,
                  subject,
                  startedAt,
                  status: 'running',
                  details: tag.param ? tag.param.substring(0, 15000) : undefined,
                  command:
                    tag.type === 'RUN_BASH' || tag.type === 'RUN_PYTHON'
                      ? tag.param
                      : undefined,
                  url:
                    tag.type === 'BUKA_WEB' || tag.type === 'SCREENSHOT_WEB'
                      ? tag.param
                      : undefined,
                  textBefore: i === 0 ? cleanBefore : undefined,
                });
                return { id, type: tag.type, param: tag.param, label, subject, startedAt };
              });

              let actionType = pendingActions[0]?.type || 'TOOL';
              if (
                pendingActions.length === 0 &&
                /\[BACA_SESI_KERJA\s*\]/i.test(fullAssistantContent)
              ) {
                actionType = 'BACA_SESI_KERJA';
                const bareStartedAt = Date.now();
                const bareLabel = 'Membaca memori pekerjaan lintas sesi...';
                const bareId = `act_${bareStartedAt}_${toolHopCount}_memori`;
                sendEvent('action', {
                  id: bareId,
                  type: actionType,
                  label: bareLabel,
                  startedAt: bareStartedAt,
                  status: 'running',
                  textBefore: cleanBefore,
                });
                pendingActions.push({
                  id: bareId,
                  type: actionType,
                  param: '',
                  label: bareLabel,
                  subject: '',
                  startedAt: bareStartedAt,
                });
              }

              const toolResult = await executeTools(fullAssistantContent, {
                isAdmin,
                userId: user.id,
                browserSession: convId || 'default',
                conversationId: convId || undefined,
                temporary,
                otpApproved,
                searchQuota,
                executedCommands,
                executedSearches,
                loadedSkills,
              });

              if (toolResult.stagedPaths && toolResult.stagedPaths.length > 0) {
                for (const p of toolResult.stagedPaths) {
                  if (!accumulatedStagedPaths.includes(p)) {
                    accumulatedStagedPaths.push(p);
                  }
                }
              }

              // Cocokkan tiap kartu dengan hasil per-panggilan dari eksekutor.
              // === AGEN REVIEWER: menilai aksi berisiko sebelum hasilnya dipakai ===
              const reviewTarget = pendingActions.find((p) => shouldReview(p.type, p.param));
              let review: Awaited<ReturnType<typeof reviewAction>> = null;
              if (reviewTarget) {
                review = await reviewAction({
                  type: reviewTarget.type,
                  param: reviewTarget.param,
                  output: toolResult.output || toolResult.observation || '',
                  providerId,
                  modelId,
                });
                if (review && review.verdict !== 'allow') {
                  console.log(`[Reviewer] ${review.verdict}: ${review.reason}`);
                  toolResult.observation = `${toolResult.observation || ''}\n\n[REVIEWER ${review.verdict.toUpperCase()}]: ${review.reason}`.trim();
                  if (review.verdict === 'block') {
                    toolResult.observation +=
                      '\nJANGAN mengulang aksi ini. Laporkan ke pengguna dan tawarkan alternatif yang aman.';
                  }
                }
              }

              const steps = toolResult.steps || [];
              const usedSteps = new Set<number>();
              const normParam = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
              let legacyConsumed = false;

              const finishedActions: import('@/types/chat').ActionInfo[] =
                pendingActions.map((p, i) => {
                  let si = steps.findIndex(
                    (s, idx) => !usedSteps.has(idx) && normParam(s.param) === normParam(p.param)
                  );
                  if (si === -1) {
                    si = steps.findIndex(
                      (s, idx) =>
                        !usedSteps.has(idx) &&
                        normParam(s.param).startsWith(normParam(p.param).substring(0, 30))
                    );
                  }
                  const step = si >= 0 ? steps[si] : undefined;
                  if (si >= 0) usedSteps.add(si);
                  // Kartu tanpa hasil sendiri membawa observasi agregat (satu kali saja).
                  const useLegacy = !step && !legacyConsumed;
                  if (useLegacy) legacyConsumed = true;

                  const cardSources = step?.sources ?? (useLegacy ? toolResult.sources : undefined);
                  const cardOutput =
                    step?.output ??
                    (useLegacy
                      ? toolResult.output ||
                        (toolResult.observation
                          ? toolResult.observation.substring(0, 60000)
                          : undefined)
                      : undefined);

                  return {
                    id: p.id,
                    type: p.type,
                    label:
                      p.type === 'CARI_WEB' && cardSources?.length
                        ? `Menelusuri ${cardSources.length} sumber web untuk "${normParam(p.param).substring(0, 45)}"`
                        : p.label,
                    status: 'done',
                    review: review && i === 0 ? { verdict: review.verdict, reason: review.reason } : undefined,
                    subject:
                      p.subject || buildActionSubject(p.type, step?.param || p.param),
                    startedAt: p.startedAt,
                    durationMs: step?.durationMs ?? Date.now() - p.startedAt,
                    isError: step
                      ? !step.ok
                      : useLegacy
                        ? isActionFailure(toolResult.observation, toolResult.output)
                        : false,
                    details: step
                      ? step.output
                      : useLegacy
                        ? toolResult.observation
                          ? toolResult.observation.substring(0, 60000)
                          : p.param || 'Selesai dieksekusi'
                        : p.param || 'Selesai dieksekusi',
                    textBefore: i === 0 ? cleanBefore : undefined,
                    sources: cardSources,
                    command:
                      p.type === 'RUN_BASH' || p.type === 'RUN_PYTHON'
                        ? p.param
                        : useLegacy
                          ? toolResult.command
                          : undefined,
                    output: cardOutput,
                    url:
                      p.type === 'BUKA_WEB' || p.type === 'SCREENSHOT_WEB'
                        ? p.param
                        : useLegacy
                          ? toolResult.url
                          : undefined,
                    screenshotUrl: useLegacy ? toolResult.screenshotUrl : undefined,
                    videoUrl: useLegacy ? toolResult.videoUrl : undefined,
                    embedUrl: useLegacy ? toolResult.embedUrl : undefined,
                  };
                });

              // Semua kartu punya hasil sendiri: media agregat menempel di kartu terakhir.
              if (!legacyConsumed && finishedActions.length > 0) {
                const lastCard = finishedActions[finishedActions.length - 1];
                if (toolResult.videoUrl) lastCard.videoUrl = toolResult.videoUrl;
                if (toolResult.screenshotUrl) lastCard.screenshotUrl = toolResult.screenshotUrl;
                if (toolResult.embedUrl) lastCard.embedUrl = toolResult.embedUrl;
                if (toolResult.url && !lastCard.url) lastCard.url = toolResult.url;
              }

              for (const finishedAction of finishedActions) {
                executedActions.push(finishedAction);
                sendEvent('action', finishedAction);
              }

              // === AGEN REPORTER: perbarui papan tugas live dari tag tugas ===
              liveTasks = mergeTaskList(liveTasks, fullAssistantContent);
              if (liveTasks.length > 0) {
                sendEvent('task_update', { tasks: liveTasks });
              }
              if (toolResult.hasAction && toolResult.observation) {
                // Directive escalating: dorong model ke jawaban final, bukan
                // eksplorasi tanpa akhir.
                const hopDirective =
                  toolHopCount >= 90
                    ? '\n\n[URUTAN SISTEM - WAJIB] Ini mendekati batas 100 langkah. Tulis JAWABAN FINAL sekarang: ringkas, tegas, sebutkan hasil yang sudah diperoleh dan apa yang belum terverifikasi. Jangan panggil tool apa lagi.'
                    : toolHopCount >= 70
                      ? `\n\n[URUTAN SISTEM] Kamu sudah memakai ${toolHopCount} tool call pada permintaan ini (maksimal ${TOOL_LOOP_MAX_HOPS}). Gabungkan sisa pemeriksaan yang masih perlu ke SATU perintah, lalu pada langkah berikutnya tulis jawaban final untuk pengguna.`
                      : '';

                // Build a follow-up request with tool results injected
                const toolInjectedMessages: import('@/lib/ai/provider-interface').ChatMessage[] = [
                  ...currentMessages.slice(0, -1), // all except the last user message
                  {
                    role: 'user' as const,
                    content: currentMessages[currentMessages.length - 1]?.content || userContent,
                  },
                  {
                    role: 'assistant' as const,
                    content: fullAssistantContent, // Only send the previous round's output to context
                  },
                  {
                    role: 'user' as const,
                    content: `[TOOL RESULTS]:\n${toolResult.observation}${hopDirective}\n\nJangan ulangi penjelasan umum yang sudah ditulis sebelum tool. Tulis SATU jawaban final yang ringkas dan langsung memuat hasil tool di atas untuk pengguna.`,
                  },
                ];

                const toolChatRequest: import('@/lib/ai/provider-interface').ChatRequest = {
                  ...chatRequest,
                  messages: toolInjectedMessages,
                  stream: true,
                  abortSignal: genSignal,
                };

                // Reset content for next round.
                // Teks pra-tool BUKAN jawaban final: sudah tersimpan di
                // action.textBefore. Pesan final hanya berisi jawaban akhir.
                fullAssistantContent = '';
                accumulatedDbContent = '';

                sendEvent('reset', { reason: 'tool' });

                // Rute harness (oc/*) dan beberapa upstream gratis kadang
                // membalas kosong / 429 saat giliran lanjutan. Coba lagi
                // sekali sebelum menyerah.
                let followUpOk = false;
                for (let attempt = 1; attempt <= 2 && !genSignal.aborted; attempt++) {
                  fullAssistantContent = '';
                  const toolAiStream = AIRouter.streamChat(providerId, toolChatRequest);
                  for await (const chunk of toolAiStream) {
                    if (genSignal.aborted) break;
                    if (chunk.type === 'token' && chunk.content) {
                      fullAssistantContent += chunk.content;
                      accumulatedDbContent += chunk.content;
                      sendEvent('token', { content: stripEndMarker(chunk.content) });
                    } else if (chunk.type === 'tool_calls' && chunk.toolCalls?.length) {
                      // Sengaja tidak masuk accumulatedDbContent: tag hasil konversi
                      // adalah instruksi kerja, bukan jawaban untuk pengguna.
                      fullAssistantContent += nativeCallsToTags(chunk.toolCalls);
                    } else if (chunk.type === 'reasoning' && chunk.reasoning) {
                      fullReasoningContent += chunk.reasoning;
                      sendEvent('reasoning', { reasoning: chunk.reasoning });
                    } else if (chunk.type === 'usage' && chunk.usage) {
                      tokenUsage = chunk.usage;
                      sendEvent('usage', chunk.usage);
                    }
                  }
                  if (fullAssistantContent) {
                    followUpOk = true;
                    break;
                  }
                  console.warn(
                    `[Chat] Giliran lanjutan kosong (percobaan ${attempt}/2) untuk model ${modelId}.`
                  );
                  if (attempt < 2) {
                    await new Promise((r) => setTimeout(r, 900));
                  }
                }

                // Model berhenti tanpa jawaban: jangan diamkan. Tampilkan
                // hasil tool supaya pengguna tetap mendapat informasi.
                if (!followUpOk) {
                  const toolOut = String(toolResult.output || toolResult.observation || '')
                    .replace(/^\[[^\]]+\]:\s*/i, '')
                    .trim()
                    .slice(0, 2000);
                  const note =
                    `\n\n⚠️ Model berhenti setelah menjalankan tool (**${actionType}**) dan tidak menulis jawaban lanjutan. ` +
                    (toolOut
                      ? `Berikut hasil tool:\n\n\`\`\`text\n${toolOut}\n\`\`\`\n\n_Silakan tulis ulang pertanyaan agar saya jawab langsung._`
                      : `_Silakan tulis ulang pertanyaan agar saya jawab langsung._`);
                  fullAssistantContent = note;
                  accumulatedDbContent = note;
                  sendEvent('token', { content: note });
                  break;
                }
                
                // Update context for next iteration
                currentMessages = toolInjectedMessages;
              } else {
                break; // No action taken, stop hopping
              }
            } catch (toolErr: any) {
              console.error('[Tool Execution Error]', toolErr);
              break; // Don't crash — just stop hopping
            }
          }

          if (!toolLoopStopReason && toolHopCount >= TOOL_LOOP_MAX_HOPS) {
            toolLoopStopReason = 'hop';
          }

          if (toolLoopStopReason) {
            const reasonText =
              toolLoopStopReason === 'waktu'
                ? `batas waktu eksekusi tool (${Math.round(TOOL_LOOP_MAX_MS / 60000)} menit) tercapai`
                : `batas ${TOOL_LOOP_MAX_HOPS} langkah tool tercapai`;
            const note = `\n\n_(Catatan sistem: eksekusi tool dihentikan karena ${reasonText}. Hasil di atas adalah hasil terakhir.)_`;
            accumulatedDbContent += note;
            fullAssistantContent += note;
            sendEvent('token', { content: note });
          }

          // Simpan tag [SIMPAN_MEMORI: ...] ke memori pengguna dan bersihkan
          // tag dari konten final. Tag sudah tidak terlihat di UI karena
          // cleanMessageContent juga menyaringnya.
          const rawBeforeCleanup = accumulatedDbContent;
          let memorySavedCount = 0;
          try {
            const memoryResult = MemoryRepository.consumeMemoryTags(
              user.id,
              accumulatedDbContent,
              !temporary
            );
            accumulatedDbContent = memoryResult.text;
            memorySavedCount = memoryResult.saved.length;
          } catch (memErr) {
            console.warn('[Memory] Gagal memproses tag memori:', memErr);
          }

          // Simpan tag [CATAT_TUGAS]/[SELESAI_TUGAS] ke memori kerja lintas
          // sesi, lalu bersihkan tag dari jawaban final.
          let taskUpdatedCount = 0;
          if (!temporary && convId) {
            try {
              const taskResult = WorkSessionRepository.consumeTaskTags(
                user.id,
                convId,
                accumulatedDbContent,
                true
              );
              accumulatedDbContent = taskResult.text;
              taskUpdatedCount = taskResult.updated;
            } catch (taskErr) {
              console.warn('[WorkSession] Gagal memproses tag tugas:', taskErr);
            }
          } else {
            const taskResult = WorkSessionRepository.consumeTaskTags(
              user.id,
              convId || undefined,
              accumulatedDbContent,
              false
            );
            accumulatedDbContent = taskResult.text;
          }

          // Jika balasan hanya berisi tag memori/tugas, beri konfirmasi singkat.
          if ((memorySavedCount > 0 || taskUpdatedCount > 0) && !cleanMessageContent(accumulatedDbContent, false).trim()) {
            const confirmation = taskUpdatedCount > 0
              ? 'Baik, sesi pekerjaan sudah saya catat.'
              : 'Baik, saya sudah mengingat itu.';
            accumulatedDbContent = confirmation;
            fullAssistantContent = confirmation;
            sendEvent('token', { content: confirmation });
          }

          // Stage & kanonikalisasi path media pada tag [KIRIM_FILE: ...] di balasan akhir
          // (termasuk resolusi fuzzy spasi vs underscore agar kartu pemutar tidak pernah 404).
          const finalStagedMedia = stageMediaTagsInReply(accumulatedDbContent);
          if (finalStagedMedia.rewrittenText !== accumulatedDbContent) {
            accumulatedDbContent = finalStagedMedia.rewrittenText;
            fullAssistantContent = finalStagedMedia.rewrittenText;
          }
          for (const sp of finalStagedMedia.stagedPaths) {
            if (!accumulatedStagedPaths.includes(sp)) {
              accumulatedStagedPaths.push(sp);
            }
          }

          // Auto-inject missing media tags jika tool (atau putaran tengah) berhasil menyiapkan berkas media
          // tetapi model lupa menyertakan tag [KIRIM_FILE] dalam jawaban final.
          if (accumulatedStagedPaths.length > 0) {
            const existingInline = extractInlineMedia(accumulatedDbContent);
            const existingFilenames = new Set(existingInline.map((im) => im.filename.toLowerCase()));
            const missingPaths = Array.from(new Set(accumulatedStagedPaths))
              .filter((p) => !existingFilenames.has(path.basename(p).toLowerCase()))
              .slice(0, 5);

            if (missingPaths.length > 0) {
              const autoMediaTags = missingPaths
                .map((p) => {
                  const customCap = accumulatedMediaCaptions.get(p);
                  if (customCap) return `[KIRIM_FILE: ${p} | ${customCap}]`;
                  const ext = path.extname(p).toLowerCase();
                  const isVid = ['.mp4', '.webm', '.mov', '.mkv'].includes(ext);
                  const isAud = ['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac'].includes(ext);
                  const label = isVid ? `Video (${path.basename(p)})` : isAud ? `Audio (${path.basename(p)})` : path.basename(p);
                  return `[KIRIM_FILE: ${p} | ${label}]`;
                })
                .join('\n');
              accumulatedDbContent += `\n\n${autoMediaTags}`;
              fullAssistantContent += `\n\n${autoMediaTags}`;
              sendEvent('token', { content: `\n\n${autoMediaTags}` });
            }
          }

          // Jika model tidak menulis teks akhir (baik setelah tool maupun sama
          // sekali), jangan biarkan gelembung balasan kosong.
          const hasAnyMediaCard = extractInlineMedia(accumulatedDbContent).length > 0;
          if (!cleanMessageContent(accumulatedDbContent, false).trim() && !hasAnyMediaCard) {
            let fallbackSummary = '';
            if (executedActions.length > 0) {
              const lastAct = executedActions[executedActions.length - 1];
              const snippet = (lastAct.output || lastAct.details || '')
                .replace(/^\[[^\]]+\]:\s*/i, '')
                .trim()
                .substring(0, 1800);
              fallbackSummary = snippet
                ? `\n\nBerikut hasil eksekusi dari **${lastAct.label}**:\n\n\`\`\`text\n${snippet}\n\`\`\``
                : `\n\nTindakan **${lastAct.label}** telah selesai dijalankan.`;
            } else {
              fallbackSummary =
                `⚠️ Model **${modelId}** tidak menghasilkan teks jawaban (seluruh kuota outputnya habis untuk proses berpikir internal). ` +
                (isOpenCodeRoute
                  ? `Rute harness OpenCode (oc/*) sering gagal karena endpoint upstream-nya bermasalah (429 / 410 / model deprecated) — sudah dicoba 3×. Silakan kirim ulang, atau pindah ke model yang stabil seperti **kios/glm-5.3-flash-free** atau **oc/glm-5.3-flash-free**.`
                  : `Ini kendala pada rute model gratis. Silakan kirim ulang, atau ganti ke model lain seperti **kios/glm-5.3-flash-free** (sedang aktif).`);
            }
            fullAssistantContent += fallbackSummary;
            accumulatedDbContent += fallbackSummary;
            sendEvent('token', { content: fallbackSummary });
          }

          // Bersihkan sisa tag tool eksekusi/tugas internal dari jawaban final
          // TANPA menghapus tag kartu UI ([KIRIM_FILE], [KIRIM_AUDIO], [KIRIM_VIDEO],
          // [KIRIM_GAMBAR], [KIRIM_DOKUMEN], [IZIN], [PILIHAN], [QUEST]) agar
          // komponen MessageItem di frontend dapat merender kartu interaktifnya.
          const cleanedFinal = cleanServerFinalContent(accumulatedDbContent);
          const needsFinalReset = Boolean(
            cleanedFinal &&
            (
              cleanedFinal !== accumulatedDbContent.trim() ||
              rawBeforeCleanup.trim() !== accumulatedDbContent.trim()
            )
          );
          if (needsFinalReset) {
            accumulatedDbContent = cleanedFinal;
            fullAssistantContent = cleanedFinal;
            sendEvent('reset', { reason: 'final-cleanup' });
            sendEvent('token', { content: cleanedFinal });
          }
        } catch (streamErr: any) {

          console.error('[SSE Stream Error]', streamErr);
          sendEvent('error', { error: streamErr.message || 'Stream connection error' });
          finishReason = 'error';
        } finally {
          if (keepAliveTimer) {
            clearInterval(keepAliveTimer);
            keepAliveTimer = null;
          }
          const latencyMs = Date.now() - startTime;

          // Save partial or complete assistant response into database if not temporary
          if (!temporary && (fullAssistantContent.trim().length > 0 || fullReasoningContent.trim().length > 0)) {
            try {
              const stagedDb = stageMediaTagsInReply(
                accumulatedDbContent.replace(/\[\/?BALASAN_AKHIR\]/gi, '').trim()
              );
              const cleanDbContent = stagedDb.rewrittenText;

              MessageRepository.createMessage({
                id: assistantMsgId,
                conversationId: convId!,
                role: 'assistant',
                content: cleanDbContent,
                reasoningContent: fullReasoningContent || null,
                model: modelId,
                provider: providerId,
                tokenInput: tokenUsage.promptTokens,
                tokenOutput: tokenUsage.completionTokens,
                latencyMs,
                finishReason,
                metadata: {
                  totalTokens: tokenUsage.totalTokens,
                  interrupted: genSignal.aborted,
                  actions: executedActions,
                  tasks: liveTasks,
                },
              });
              ConversationRepository.touchConversation(convId!);
            } catch (dbErr) {
              console.error('[Failed saving assistant message]', dbErr);
            }
          }

          // Buang sisa penanda yang masih tertahan, lalu tutup aliran.
          const endMarkerRest = stripEndMarker('', true);
          if (endMarkerRest) sendEvent('token', { content: endMarkerRest });

          sendEvent('done', {
            conversationId: convId,
            messageId: assistantMsgId,
            finishReason,
            latencyMs,
          });

          activeGens.delete(convId!);
          clearActiveGen(convId!);
          try {
            controller.close();
          } catch {}
        }
      },
      cancel() {
        // Klien (browser/edge) memutus koneksi: hentikan keep-alive.
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable Nginx reverse proxy buffering (Section 61)
      },
    });
  } catch (err: any) {
    console.error('[Chat API Error]', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}