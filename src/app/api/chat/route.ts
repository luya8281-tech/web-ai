import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { ConversationRepository } from '@/lib/db/repositories/conversation-repo';
import { MessageRepository } from '@/lib/db/repositories/message-repo';
import { ProviderRepository } from '@/lib/db/repositories/provider-repo';
import { ProjectRepository } from '@/lib/db/repositories/project-repo';
import { SettingsRepository } from '@/lib/db/repositories/settings-repo';
import { MemoryRepository } from '@/lib/db/repositories/memory-repo';
import { AIRouter } from '@/lib/ai/router';
import { ChatMessage, ChatRequest } from '@/lib/ai/provider-interface';
import { hasToolTags, executeTools, stageMediaTagsInReply } from '@/lib/tools/tool-executor';
import { parseBrowserCommand } from '@/lib/tools/browser-agent';
import { cleanMessageContent, parseToolTags } from '@/lib/utils/clean-content';
import { persistActiveGen, clearActiveGen, recoverStaleGens } from '@/lib/ai/active-gen-store';

import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
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
  const convId = req.nextUrl.searchParams.get('conversationId') || '';
  const gen = convId ? activeGens.get(convId) : undefined;
  return new Response(
    JSON.stringify({
      running: Boolean(gen),
      startedAt: gen?.startedAt || null,
      content: gen?.content || '',
      reasoning: gen?.reasoning || '',
      actions: gen?.actions || [],
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
    } = parsed.data;

    let convId = incomingConvId;
    let conversation = convId ? ConversationRepository.getConversation(convId) : null;

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

    // Auto-inject current date and time to fix knowledge cutoff hallucinations
    const currentDateStr = new Intl.DateTimeFormat('id-ID', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
    }).format(new Date());

    const temporalContext = `\n\n[Waktu Sistem Saat Ini: ${currentDateStr}].\nPERHATIAN KRITIKAL: Tahun ini adalah 2026. Anda WAJIB menyisipkan "2026" dan bulan saat ini ke dalam parameter [CARI_WEB] jika pengguna menanyakan berita, harga saham, kurs, atau update "terbaru/hari ini" (contoh: [CARI_WEB: harga emas hari ini September 2026]). JANGAN PERNAH berasumsi ini tahun 2023-2025.`;

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

    // Gerbang izin transkripsi/unduh audio ([AMBIL_SUBTITEL]): video pihak lain
    // hanya boleh diunduh/di-transkrip setelah pengguna menyatakan setuju
    // (kepemilikan/hak), pada giliran terakhir. Sama polanya dengan OTP.
    const mediaApproved = otpApproved;

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
        igPrompt = `\n\n==================================================\n[PERINTAH SLASH /ig — WAJIB DIEKSEKUSI SEKARANG]:\nPengguna mengetik perintah /ig untuk tautan: ${igUrl}\nJANGAN membahas menu pop-up, autocomplete, atau cara memakai perintah. JANGAN memanggil [BUKA_WEB] untuk tautan ini.\nLangkah wajib pada respons ini:\n1. Panggil [BACA_SKILL: ig] lalu ikuti SOP-nya.\n2. Jalankan [RUN_BASH: node /root/ai-chat/scripts/download_instagram.js "${igUrl}"]\n3. Baca JSON hasilnya. Jika "ok":true, panggil [KIRIM_FILE: <path dari JSON> | Video Instagram].\n4. Jika "ok":false, sampaikan error singkat; jangan mengarang hasil.\n==================================================`;
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

      // Comprehensive Executive AI Automation Tools & Environment Prompt for Admin (Vee)
      const toolInstructions = `
\n\n---
# AI AUTOMATION SYSTEM & SERVER CAPABILITIES (ANTIGRAVITY WEB AI)
Anda adalah Asisten AI Utama berintegritas tinggi dengan kapabilitas otomasi penuh di server Linux Ubuntu.
Pengguna utama Anda adalah **Vee** (pemilik & pengembang sistem).

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

## 3. DAFTAR ALAT OTOMASI LENGKAP:
1. \`[BUKA_WEB: url]\` -> Buka halaman web via browser Google Chrome asli (Playwright) dan baca isinya secara utuh. Gunakan ini jika ringkasan dari hasil pencarian terpotong atau kosong.
2. \`[SCREENSHOT_WEB: url]\` -> Buka halaman web dan ambil tangkapan layar antarmuka via Google Chrome.
3. \`[CARI_WEB: query]\` -> Mencari info di internet via search engine. **PENTING: \`query\` WAJIB berupa 2-4 kata kunci singkat (contoh: "hasil final indonesia thailand", bukan kalimat lengkap "berapa skor hasil final indonesia thailand").**
4. \`[CEK_CUACA: lat,lon | nama kota]\` -> Cek cuaca real-time via Open-Meteo (tanpa API key). Contoh: \`[CEK_CUACA: -6.2, 106.8]\` (dari GPS) atau \`[CEK_CUACA: Jakarta]\`. WAJIB dipakai untuk semua pertanyaan cuaca, JANGAN mengarang.
4. \`[RUN_BASH: command]\` -> Eksekusi perintah Linux Bash di server VPS (pm2, curl, git, df, free, dll).
5. \`[CEK_KESEHATAN_PROYEK: target_dir]\` -> **PRE-FLIGHT DIAGNOSTIK KESEHATAN PROYEK:** Audit git status, cek apakah ada proses build yang sedang aktif menumpuk, cek port listener bentrok, dan cek sisa RAM/Disk sebelum menjalankan otomasi proyek.
6. \`[BACA_SKILL: nama_skill]\` -> Membaca SOP keahlian khusus dari direktori skills (otomatis berhalaman; tambahkan nomor bagian bila SOP panjang, contoh \`[BACA_SKILL: graphify 2]\`).
7. \`[INSTALL_SKILL: nama_skill | isi_markdown]\` -> Menginstal / membuat skill baru di server.
8. \`[RUN_PYTHON: code]\` -> Menjalankan skrip Python di server (analisis data, perhitungan, otomatisasi).
9. \`[SIMPAN_MEMORI: kategori | fakta]\` -> Simpan fakta jangka panjang tentang pengguna ke memori akun ini (otomatis, lintas percakapan).
9b. \`[CATAT_PELAJARAN: masalah_atau_kegagalan | solusi_terbukti]\` -> **BELAJAR DARI KESALAHAN:** Simpan catatan kegagalan & solusi otomasi proyek ke memori permanen agar AI tidak mengulangi kesalahan yang sama pada tugas berulang.
10. \`[RINGKAS_YOUTUBE: url]\` -> Ambil metadata dan transkrip video YouTube.
11. \`[BACA_OCR: path]\` -> Scan teks dari gambar menggunakan OCR.
12. \`[BUAT_PDF: isi_atau_html | nama_file.pdf]\` -> Render dokumen PDF berstandar A4 asli.
13. \`[AMBIL_SUBTITEL: url]\` -> Ambil subtitel/teks transkrip video (TikTok, YouTube, dan situs video lain) via transkripsi lokal Whisper di server.
    - **WAJIB IZIN DULU:** JANGAN panggil tag ini atas inisiatif sendiri. Tanyakan lebih dulu apakah pengguna pemilik video atau berhak/berizin atasnya (bukan konten pihak lain tanpa izin). Tag ini hanya akan berjalan pada giliran setelah pengguna menjawab setuju.
14. \`[BUAT_FILE: nama_file.ext | isi_file]\` -> **PEMBUAT BERKAS UNIVERSAL:** Buat berkas baru apa saja (.xlsx, .docx, .lua, .txt, .csv, .py, .pdf, .json, .sh, .sql, dll) langsung ke server dan otomatis kirim kartu unduhan interaktif ke pengguna.
    - Untuk spreadsheet (.xlsx): berikan data dalam tabel Markdown (\`| Kolom 1 | Kolom 2 |\`) atau CSV/JSON. Sistem otomatis membuatnya jadi berkas Microsoft Excel (.xlsx) asli dengan header styling dan border!
    - Untuk Microsoft Word (.docx): berikan format Markdown (\`# Judul\`, \`- Poin\`, \`| Tabel |\`). Sistem otomatis membuatnya jadi berkas Word (.docx) resmi!
    - Untuk script Lua/Python/Bash: tulis kodenya, berkas langsung siap diunduh pengguna.
15. \`[KIRIM_FILE: /path/ke/file | Keterangan/Judul]\` -> Kirim berkas apa pun yang sudah ada di server (mis. hasil bash/python/ffmpeg di /root, /tmp, dll) langsung ke ruang obrolan pengguna.

Gunakan alat-alat di atas secara proaktif. Cukup tuliskan tag alat tersebut di balasan Anda, dan sistem otomatis akan menjalankannya secara ReAct multi-hop loop. JANGAN menjelaskan bahwa Anda akan menggunakan alat, langsung panggil tag-nya! DILARANG MENGARANG SKOR ATAU BERITA JIKA RINGKASAN KOSONG, GUNAKAN [BUKA_WEB]!

## 3b. OTOMASI BROWSER INTERAKTIF (TAG \`[BROWSER]\`) — KHUSUS ADMIN
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
- \`[BROWSER: login nama_akun]\` → login otomatis memakai akun tersimpan di vault
- \`[BROWSER: otp nama_email]\` → ambil kode OTP dari email (WAJIB disetujui pengguna lebih dulu)
- \`[BROWSER: reset]\` → tutup sesi browser

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
        const sysMdPath = '/root/wa-bot/SYSTEM.md';
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
3. KARTU IZIN INTERAKTIF: Jika suatu tindakan memerlukan persetujuan pengguna (seperti akses OTP email, restart layanan kritis, penghapusan data, atau konfirmasi eksekusi), sertakan tag \`[IZIN: Judul Izin | Penjelasan singkat tindakan | Ya, saya izinkan jalankan tindakan tersebut]\` agar muncul kartu persetujuan yang bisa langsung diklik pengguna.
4. PILIHAN / QUEST INTERAKTIF: Jika Anda menawarkan opsi langkah selanjutnya, alternatif solusi, atau pertanyaan pilihan kepada pengguna, sertakan tag \`[PILIHAN: Opsi Pertama | Opsi Kedua | Opsi Ketiga]\` di bagian paling akhir balasan agar pengguna cukup mengetuk tombol pilihan tanpa perlu mengetik manual.
5. FITUR PENGIRIMAN & PEMBUATAN BERKAS (UNIVERSAL FILE SENDING):
   - Jika pengguna meminta berkas (apapun jenisnya: .lua, .txt, spreadsheet Excel .xlsx, Word .docx, PDF, CSV, MP3, MP4, Python, JSON, dll):
     * Untuk MEMBUAT BERKAS BARU: Panggil tag \`[BUAT_FILE: nama_file.ext | isi_file]\`.
       - Untuk Excel (.xlsx): sertakan data tabel Markdown \`| Kolom1 | Kolom2 |\` atau CSV di \`isi_file\`. Sistem otomatis menghasilkan file spreadsheet Excel asli yang rapi!
       - Untuk Word (.docx): sertakan format Markdown di \`isi_file\`. Sistem otomatis menghasilkan dokumen Microsoft Word asli!
       - Untuk script (.lua, .py, .js, .sh, .sql): tuliskan kodenya di \`isi_file\`.
       - Untuk PDF (.pdf): panggil \`[BUAT_PDF: isi_dokumen | nama_dokumen.pdf]\`.
     * Untuk MENGIRIM BERKAS YANG SUDAH ADA DI SERVER: Panggil tag \`[KIRIM_FILE: /path/ke/file | Judul Berkas]\` (contoh: \`[KIRIM_FILE: /root/wa-bot/media/sent/video.mp4 | Video]\` atau \`[KIRIM_FILE: /tmp/output.xlsx | Laporan Rekapitulasi]\`).
   - Di antarmuka web, berkas otomatis ditampilkan dalam Kartu Berkas Interaktif lengkap dengan badge jenis berkas, tombol **Pratinjau Isi**, tombol **Salin Tautan**, dan tombol **Unduh 1-Klik**!
   - Semua berkas yang dibuat atau dikirim dapat diunduh melalui \`/api/browser-shots/<nama_berkas>?download=1\`.
   - **DILARANG KERAS** menggunakan domain mati (\`ai.beritadetik.my.id\` / \`vee2.my.id\`). Selalu gunakan tag \`[BUAT_FILE]\` atau \`[KIRIM_FILE]\` atau tautan relatif \`/api/browser-shots/<nama_berkas>\`.`;

    let memoryPrompt = '';
    try {
      memoryPrompt = MemoryRepository.buildSystemPrompt(user.id);
    } catch (memErr) {
      console.warn('[Memory] Gagal membangun prompt memori:', memErr);
    }

    effectiveSystemPrompt = (effectiveSystemPrompt || 'Anda adalah AI bernama Vee.') + temporalContext + roleSpecificPrompt + memoryPrompt + webAiPromptNotice + urlTriggerPrompt + locationPrompt + igPrompt;

    // Directif khusus rute OpenCode (provider 'opencode' atau model 'oc/*').
    // Harness OpenCode menyuntikkan tool `read`/`shell` + larangan memakainya,
    // yang bertabrakan dengan protokol tag ai-chat; akibatnya model sering
    // menghabiskan seluruh kuota output untuk reasoning lalu mengembalikan
    // jawaban KOSONG. Directif ini menegaskan agar model langsung menulis teks.
    const isOpenCodeRoute = providerId === 'opencode' || /^oc\//i.test(modelId) || /^opencode\//i.test(modelId);
    if (isOpenCodeRoute) {
      effectiveSystemPrompt += `\n\n[ATURAN RUTE OPENCODE — WAJIB]: Abaikan tool bawaan bernama \`read\` dan \`shell\`; JANGAN pernah memanggilnya (keduanya placeholder kosong dari harness). Jangan menulis skrip atau merencanakan langkah berkepanjangan. Segera tulis jawaban akhir untuk pengguna sebagai teks biasa. Bila perlu data web, cukup tulis tag [CARI_WEB: kata kunci] DI DALAM teks jawaban (bukan sebagai tool call), lalu tunggu hasilnya. Tulis setiap tag pada BARIS TERSENDIRI — JANGAN menyisipkan tag di dalam tautan atau tanda kurung Markdown (contoh SALAH: [teks]([CARI_WEB: kata kunci])), karena tag di dalam kurung tidak akan dieksekusi.`;
    }

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
      return {
        role: m.role as any,
        content:
          m.role === 'user'
            ? formatMessageContentWithAttachments(m.content, m.attachments)
            : m.content,
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
          
          while (fullAssistantContent && hasToolTags(fullAssistantContent, isAdmin) && !genSignal.aborted && toolHopCount < 100) {
            toolHopCount++;
            try {
              // Real-time Action Progress event for live collapsible UI card
              const firstTag = parseToolTags(fullAssistantContent, '[A-Z_]+').find(
                (tag) => tag.type !== 'SIMPAN_MEMORI'
              );
              let actionName = 'Mencari informasi...';
              let actionType = 'TOOL';
              let actionParam = '';
              if (firstTag) {
                actionType = firstTag.type;
                actionParam = firstTag.param;
                const firstParamLine = actionParam.split('\n')[0].trim().substring(0, 60);
                if (actionType === 'BUKA_WEB') actionName = `Membaca artikel web...`;
                else if (actionType === 'SCREENSHOT_WEB') actionName = `Mengamati tampilan halaman web...`;
                else if (actionType === 'CARI_WEB') actionName = `Mencari "${firstParamLine}" di internet...`;
                else if (actionType === 'CEK_CUACA') actionName = 'Mengecek cuaca...';
                else if (isAdmin && actionType === 'RUN_BASH') actionName = `Memeriksa sistem server...`;
                else if (isAdmin && actionType === 'RUN_PYTHON') actionName = `Menganalisis data dengan Python...`;
                else if (isAdmin && actionType === 'BACA_SKILL') actionName = `Mempelajari keahlian: ${firstParamLine}...`;
                else if (isAdmin && actionType === 'INSTALL_SKILL') actionName = `Mengaktifkan kemampuan baru...`;
                else if (isAdmin && actionType === 'BROWSER') {
                  const bc = parseBrowserCommand(firstTag.param);
                  actionName = `Mengendalikan browser: ${bc.describe}...`;
                }
                else actionName = `Mengerjakan tugas: ${actionType}...`;
              }

              const cleanBefore = cleanMessageContent(fullAssistantContent, false);
              const actionId = `act_${Date.now()}_${toolHopCount}`;
              sendEvent('action', {
                id: actionId,
                type: actionType,
                label: actionName,
                status: 'running',
                details: actionParam ? actionParam.substring(0, 15000) : undefined,
                command: actionType === 'RUN_BASH' || actionType === 'RUN_PYTHON' ? actionParam : undefined,
                url: actionType === 'BUKA_WEB' || actionType === 'SCREENSHOT_WEB' ? actionParam : undefined,
                textBefore: cleanBefore,
              });

              const toolResult = await executeTools(fullAssistantContent, {
                isAdmin,
                userId: user.id,
                browserSession: convId || 'default',
                otpApproved,
                mediaApproved,
                searchQuota,
              });

              const finishedAction: import('@/types/chat').ActionInfo = {
                id: actionId,
                type: actionType,
                label:
                  actionType === 'CARI_WEB' && toolResult.sources?.length
                    ? `Menelusuri ${toolResult.sources.length} sumber web untuk "${actionParam.split('|')[0].trim().substring(0, 45)}"`
                    : actionName,
                status: 'done',
                details: toolResult.observation ? toolResult.observation.substring(0, 60000) : (actionParam || 'Selesai dieksekusi'),
                textBefore: cleanBefore,
                sources: toolResult.sources,
                command: toolResult.command || (actionType === 'RUN_BASH' || actionType === 'RUN_PYTHON' ? actionParam : undefined),
                output: toolResult.output || (toolResult.observation ? toolResult.observation.substring(0, 60000) : undefined),
                url: toolResult.url || (actionType === 'BUKA_WEB' || actionType === 'SCREENSHOT_WEB' ? actionParam : undefined),
                screenshotUrl: toolResult.screenshotUrl,
                videoUrl: toolResult.videoUrl,
                embedUrl: toolResult.embedUrl,
              };
              executedActions.push(finishedAction);

              sendEvent('action', finishedAction);
              if (toolResult.hasAction && toolResult.observation) {
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
                    content: `[TOOL RESULTS]:\n${toolResult.observation}\n\nBased on the above tool results, provide your final comprehensive answer to the user.`,
                  },
                ];

                const toolChatRequest: import('@/lib/ai/provider-interface').ChatRequest = {
                  ...chatRequest,
                  messages: toolInjectedMessages,
                  stream: true,
                  abortSignal: genSignal,
                };

                // Reset content for next round
                const prevContent = fullAssistantContent;
                fullAssistantContent = '';

                sendEvent('token', { content: '' }); // clear hint
                const toolAiStream = AIRouter.streamChat(providerId, toolChatRequest);
                for await (const chunk of toolAiStream) {
                  if (genSignal.aborted) break;
                  if (chunk.type === 'token' && chunk.content) {
                    fullAssistantContent += chunk.content;
                    accumulatedDbContent += chunk.content;
                    sendEvent('token', { content: stripEndMarker(chunk.content) });
                  } else if (chunk.type === 'reasoning' && chunk.reasoning) {
                    fullReasoningContent += chunk.reasoning;
                    sendEvent('reasoning', { reasoning: chunk.reasoning });
                  } else if (chunk.type === 'usage' && chunk.usage) {
                    tokenUsage = chunk.usage;
                    sendEvent('usage', chunk.usage);
                  }
                }
                
                // If it failed to generate any tokens, fallback and break
                if (!fullAssistantContent) {
                  fullAssistantContent = prevContent;
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

          // Simpan tag [SIMPAN_MEMORI: ...] ke memori pengguna dan bersihkan
          // tag dari konten final. Tag sudah tidak terlihat di UI karena
          // cleanMessageContent juga menyaringnya.
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

          // Jika balasan hanya berisi tag memori, beri konfirmasi singkat.
          if (memorySavedCount > 0 && !cleanMessageContent(accumulatedDbContent, false).trim()) {
            const confirmation = 'Baik, saya sudah mengingat itu.';
            accumulatedDbContent = confirmation;
            fullAssistantContent = confirmation;
            sendEvent('token', { content: confirmation });
          }

          // Jika model tidak menulis teks akhir (baik setelah tool maupun sama
          // sekali), jangan biarkan gelembung balasan kosong.
          if (!cleanMessageContent(accumulatedDbContent, false).trim()) {
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
                `Ini kendala pada rute model gratis lewat gateway OpenCode. Silakan kirim ulang, atau ganti ke model lain seperti **ag/gemini-3.8-flash-high**.`;
            }
            fullAssistantContent += fallbackSummary;
            accumulatedDbContent += fallbackSummary;
            sendEvent('token', { content: fallbackSummary });
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
              const cleanDbContent = accumulatedDbContent
                .replace(/\[\/?BALASAN_AKHIR\]/gi, '')
                .trim();

              stageMediaTagsInReply(cleanDbContent);

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