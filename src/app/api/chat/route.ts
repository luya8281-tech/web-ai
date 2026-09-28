import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { ConversationRepository } from '@/lib/db/repositories/conversation-repo';
import { MessageRepository } from '@/lib/db/repositories/message-repo';
import { ProviderRepository } from '@/lib/db/repositories/provider-repo';
import { ProjectRepository } from '@/lib/db/repositories/project-repo';
import { SettingsRepository } from '@/lib/db/repositories/settings-repo';
import { AIRouter } from '@/lib/ai/router';
import { ChatMessage, ChatRequest } from '@/lib/ai/provider-interface';
import { hasToolTags, executeTools } from '@/lib/tools/tool-executor';

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
});

export async function POST(req: NextRequest) {
  try {
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

    // Dynamic Skills Catalog from Server (/root/wa-bot/skills & /root/.gemini/config/skills)
    const { getAvailableSkillsCatalog } = await import('@/lib/tools/tool-executor');
    const skillsList = getAvailableSkillsCatalog();
    const skillsText = skillsList.length > 0 ? skillsList.join('\n') : '  - Tidak ada skill eksternal.';

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
    if (detectedUrls.length > 0) {
      urlTriggerPrompt = `\n\n==================================================\n[PERINTAH WAJIB DETEKSI TAUTAN / URL]:\nPengguna meminta membuka tautan: ${detectedUrls.join(', ')}.\nServer Anda telah dilengkapi browser Google Chrome asli (/usr/bin/google-chrome) dengan Playwright.\nAnda WAJIB LANGSUNG mengeksekusi: [BUKA_WEB: ${detectedUrls[0]}] sekarang juga pada respons ini!\nDILARANG KERAS berhalusinasi atau pura-pura memproses tanpa benar-benar memanggil tag [BUKA_WEB: ${detectedUrls[0]}].\nDILARANG KERAS menolak atau beralasan tidak bisa membuka tautan luar. Panggil [BUKA_WEB: ${detectedUrls[0]}] sekarang!\n==================================================`;
    }

    // Comprehensive Executive AI Automation Tools & Environment Prompt
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
- **Katalog Skill Khusus (/root/wa-bot/skills):** Anda memiliki akses ke modul keahlian (SOP) spesifik:
${skillsText}
- **Penggunaan Skill:** Jika pengguna menanyakan atau meminta tugas yang relevan dengan salah satu skill di atas, Anda BISA memanggil \`[BACA_SKILL: nama_skill]\` untuk membaca SOP lengkapnya.
- **Instalasi Skill Baru:** Jika diminta membuat atau menginstal skill baru, gunakan \`[INSTALL_SKILL: nama_skill | isi_markdown_sop]\`. Sistem akan otomatis menyimpannya ke \`/root/wa-bot/skills/\` dan mendaftarkannya secara permanen.

## 3. DAFTAR ALAT OTOMASI LENGKAP:
1. \`[BUKA_WEB: url]\` -> Buka halaman web via browser Google Chrome asli (Playwright) dan baca isinya.
2. \`[SCREENSHOT_WEB: url]\` -> Buka halaman web dan ambil tangkapan layar antarmuka via Google Chrome.
3. \`[CARI_WEB: query]\` -> Mencari info atau berita terbaru di internet via search engine.
4. \`[RUN_BASH: command]\` -> Eksekusi perintah Linux Bash di server VPS (pm2, curl, git, df, free, dll).
5. \`[BACA_SKILL: nama_skill]\` -> Membaca SOP keahlian khusus dari direktori skills.
6. \`[INSTALL_SKILL: nama_skill | isi_markdown]\` -> Menginstal / membuat skill baru di server.
7. \`[RUN_PYTHON: code]\` -> Menjalankan skrip Python di server (analisis data, perhitungan, otomatisasi).
8. \`[SIMPAN_MEMORI: fakta]\` -> Simpan fakta penting pengguna ke memori global jangka panjang.
9. \`[RINGKAS_YOUTUBE: url]\` -> Ambil metadata dan transkrip video YouTube.
10. \`[BACA_OCR: path]\` -> Scan teks dari gambar menggunakan OCR.
11. \`[BUAT_PDF: html | file]\` -> Render dokumen PDF berstandar A4.

Gunakan alat-alat di atas secara proaktif. Cukup tuliskan tag alat tersebut di balasan Anda, dan sistem otomatis akan menjalankannya secara ReAct multi-hop loop. JANGAN menjelaskan bahwa Anda akan menggunakan alat, langsung panggil tag-nya!

## 4. PROTOKOL PENELUSURAN MANDIRI & VERIFIKASI FAKTA (ANTI-TUDUHAN HOAKS PREMATUR)
- **Dilarang Keras Menuduh Hoaks / Rumor Secara Prematur:** Ketiadaan hasil pencarian dari [CARI_WEB] BUKAN bukti bahwa suatu peristiwa tidak terjadi! Jangan pernah menyimpulkan klaim pengguna sebagai "HOAKS", "RUMOR BELAKA", atau "TIDAK ADA" hanya karena pencarian pertama tidak membuahkan hasil.
- **Pencarian Multi-Sudut Otonom:** Jika pencarian pertama tidak menghasilkan data atau pengguna menegaskan suatu peristiwa (misal: "ada hari ini dia konser", "di JIS", "barusan terjadi"):
  1. JANGAN MEMBANTAH PENGGUNA. Gunakan setiap detail dari pengguna sebagai kata kunci utama (anchor signal).
  2. Cari dengan variasi bahasa Indonesia dan lokasi spesifik (contoh: "[CARI_WEB: The Weeknd Jakarta International Stadium 2026]", "[CARI_WEB: konser The Weeknd JIS September 2026]").
  3. Telusuri portal berita terkemuka lokal (Kompas, Detik, Kumparan, Tirto, Tribunnews) atau situs tiket resmi (Live Nation Asia, Tiket.com).
  4. Jika tetap belum menemukan data setelah beberapa sudut pencarian, jawablah dengan objektif dan rendah hati: "Saya belum menemukan rilis resmi mengenai jadwal tersebut di penelusuran web saat ini. Apakah ada detail spesifik lain yang bisa saya periksa?". DILARANG menyebutnya hoaks.
- **Verifikasi Tautan Media Sosial:** Acara konser atau berita viral sering kali pertama kali beredar di Instagram, Twitter/X, atau TikTok. Jika pengguna menyertakan link, WAJIB LANGSUNG buka dan baca teksnya menggunakan [BUKA_WEB: url].
- **Zero-Excuses:** Jangan membuat alasan defensif mengenai "keterbatasan model" atau "anti-bot". Kerahkan alat [CARI_WEB] dan [BUKA_WEB] secara mandiri dan gigih.`;

    let externalSystemMd = '';
    try {
      const sysMdPath = '/root/wa-bot/SYSTEM.md';
      if (fs.existsSync(sysMdPath)) {
        externalSystemMd = '\n\n' + fs.readFileSync(sysMdPath, 'utf8');
      }
    } catch (e) {}

    const webAiPromptNotice = `\n\n[CATATAN FORMAT WEB AI]: Anda beroperasi melalui Web AI Interface. Tampilkan balasan Anda secara langsung sebagai Markdown yang rapi dan bersih. JANGAN PERNAH membungkus balasan dengan tag [BALASAN_AKHIR] atau [/BALASAN_AKHIR] karena antarmuka web langsung merender teks Anda secara visual.`;

    effectiveSystemPrompt = (effectiveSystemPrompt || 'Anda adalah AI Asisten canggih yang siap membantu pengguna.') + temporalContext + toolInstructions + externalSystemMd + webAiPromptNotice + urlTriggerPrompt;

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
    const chatMessages: ChatMessage[] = history.map(m => {
      const images: string[] = [];
      if (m.attachments) {
        for (const att of m.attachments) {
          const resolved = resolveAttachmentDataUrl(att);
          if (resolved) images.push(resolved);
        }
      }
      return {
        role: m.role as any,
        content: m.content,
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
        content: userContent,
        images: images.length > 0 ? images : undefined,
      });
    }

    // Create assistant placeholder message record
    const assistantMsgId = `msg_${Date.now() + 1}_${Math.random().toString(36).substring(2, 8)}`;
    const startTime = Date.now();

    const actualModelName = modelId.startsWith(providerId + ':') ? modelId.substring(providerId.length + 1) : modelId;

    const chatRequest: ChatRequest = {
      model: actualModelName,
      messages: chatMessages,
      systemPrompt: effectiveSystemPrompt || undefined,
      temperature: temperature ?? conversation.temperature ?? 0.7,
      topP: topP ?? conversation.topP ?? 1.0,
      maxTokens: maxTokens ?? conversation.maxTokens ?? undefined,
      reasoningEffort: reasoningEffort ?? conversation.reasoningEffort ?? undefined,
      stream: true,
      abortSignal: req.signal,
    };

    // Prepare SSE Response Stream
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let fullAssistantContent = '';
        let accumulatedDbContent = '';
        let fullReasoningContent = '';
        let finishReason = 'stop';
        let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        const executedActions: import('@/types/chat').ActionInfo[] = [];

        // Helper to push SSE event
        const sendEvent = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        // Notify client of metadata
        sendEvent('meta', {
          conversationId: convId,
          userMessageId: userMsgId,
          assistantMessageId: assistantMsgId,
          model: modelId,
          provider: providerId,
        });

        try {
          const aiStream = AIRouter.streamChat(providerId, chatRequest);

          for await (const chunk of aiStream) {
            if (req.signal.aborted) {
              finishReason = 'aborted';
              break;
            }

            if (chunk.type === 'token' && chunk.content) {
              fullAssistantContent += chunk.content;
              sendEvent('token', { content: chunk.content });
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

          let toolHopCount = 0;
          let currentMessages = chatMessages;
          accumulatedDbContent = fullAssistantContent;
          
          while (fullAssistantContent && hasToolTags(fullAssistantContent) && !req.signal.aborted && toolHopCount < 100) {
            toolHopCount++;
            try {
              // Real-time Action Progress event for live collapsible UI card
              const actionMatch = fullAssistantContent.match(/\[([A-Z_]+):\s*([\s\S]*?)(?:\]|(?=\s*\[[A-Z_]+:)|$)/i);
              let actionName = 'Menjalankan aksi server...';
              let actionType = 'TOOL';
              let actionParam = '';
              if (actionMatch) {
                actionType = actionMatch[1].toUpperCase();
                actionParam = actionMatch[2].trim();
                const firstParamLine = actionParam.split('\n')[0].trim().substring(0, 60);
                if (actionType === 'BUKA_WEB') actionName = `Membuka halaman web via Google Chrome`;
                else if (actionType === 'SCREENSHOT_WEB') actionName = `Mengambil tangkapan layar web via Google Chrome`;
                else if (actionType === 'CARI_WEB') actionName = `Mencari informasi di internet: "${firstParamLine}"`;
                else if (actionType === 'RUN_BASH') actionName = `Mengeksekusi perintah server: ${firstParamLine}`;
                else if (actionType === 'RUN_PYTHON') actionName = `Menjalankan analisis Python di server`;
                else if (actionType === 'BACA_SKILL') actionName = `Membaca modul keahlian: ${firstParamLine}`;
                else if (actionType === 'INSTALL_SKILL') actionName = `Menginstal modul keahlian baru`;
                else actionName = `Menjalankan aksi server: ${actionType}`;
              }

              const actionId = `act_${Date.now()}_${toolHopCount}`;
              sendEvent('action', {
                id: actionId,
                type: actionType,
                label: actionName,
                status: 'running',
                details: actionParam ? actionParam.substring(0, 300) : undefined,
              });

              const toolResult = await executeTools(fullAssistantContent);

              const finishedAction: import('@/types/chat').ActionInfo = {
                id: actionId,
                type: actionType,
                label: actionName,
                status: 'done',
                details: toolResult.observation ? toolResult.observation.substring(0, 1500) : (actionParam || 'Selesai dieksekusi'),
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
                  abortSignal: req.signal,
                };

                // Reset content for next round
                const prevContent = fullAssistantContent;
                fullAssistantContent = '';

                sendEvent('token', { content: '' }); // clear hint
                const toolAiStream = AIRouter.streamChat(providerId, toolChatRequest);
                for await (const chunk of toolAiStream) {
                  if (req.signal.aborted) break;
                  if (chunk.type === 'token' && chunk.content) {
                    fullAssistantContent += chunk.content;
                    accumulatedDbContent += chunk.content;
                    sendEvent('token', { content: chunk.content });
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
        } catch (streamErr: any) {

          console.error('[SSE Stream Error]', streamErr);
          sendEvent('error', { error: streamErr.message || 'Stream connection error' });
          finishReason = 'error';
        } finally {
          const latencyMs = Date.now() - startTime;

          // Save partial or complete assistant response into database if not temporary
          if (!temporary && (fullAssistantContent.trim().length > 0 || fullReasoningContent.trim().length > 0)) {
            try {
              const cleanDbContent = accumulatedDbContent
                .replace(/\[\/?BALASAN_AKHIR\]/gi, '')
                .trim();

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
                  interrupted: req.signal.aborted,
                  actions: executedActions,
                },
              });
              ConversationRepository.touchConversation(convId!);
            } catch (dbErr) {
              console.error('[Failed saving assistant message]', dbErr);
            }
          }

          sendEvent('done', {
            conversationId: convId,
            messageId: assistantMsgId,
            finishReason,
            latencyMs,
          });

          controller.close();
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
