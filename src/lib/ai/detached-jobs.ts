/**
 * Pelaporan tugas yang dijalankan terpisah (detached).
 *
 * MASALAH LAMA: perintah yang me-restart aplikasi ini (npm run deploy, pm2 restart
 * ai-chat, restart provider) dijadwalkan jalan sendiri, lalu model disuruh
 * "JANGAN menunggu". Akibatnya hasil build tidak pernah dilaporkan dan pengguna
 * harus cek server manually.
 *
 * KENAPA TIDAK BISA SEKALIGUS DI DALAM PROSES: deploy.sh me-restart ai-chat di
 * tengah kerjanya, jadi proses yang menjadwalkan mati sebelum pekerjaan selesai.
 * Sebaliknya, jalur build-gagal keluar SEBELUM restart, jadi proses lama juga harus
 * bisa melapor. Karena itu state disimpan di luar memori (berkas) dan diperiksa oleh
 * pemangkas berkala plus pemindaian saat proses baru start.
 *
 * KENAPA BERKAS, BUKAN TABEL DB: yang menulis HASIL adalah bash, bukan Node. Menulis
 * SQLite dari shell tepat saat aplikasi mid-restart (WAL aktif) adalah risiko yang tidak
 * perlu. Laporan akhir tetap masuk ke DB sebagai pesan biasa oleh proses yang sehat —
 * persis pola active-gen-store.ts.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import { MessageRepository } from '@/lib/db/repositories/message-repo';
import { ConversationRepository } from '@/lib/db/repositories/conversation-repo';

export type DetachedJobKind = 'self-restart-deploy' | 'provider-restart' | 'detached-cmd';

export interface DetachedJobIntent {
  jobId: string;
  conversationId: string;
  userId?: string;
  kind: DetachedJobKind;
  command: string;
  scheduledAt: number;
  deferSec: number;
  deadlineAt: number;
  capturePath: string;
  resultPath: string;
  status: 'pending' | 'reported' | 'dropped';
  reportedAt?: number;
  outcomeMessageId?: string;
  summaryAttempted?: boolean;
}

export interface DetachedJobResult {
  jobId?: string;
  status:
    | 'success'
    | 'build_failed'
    | 'swap_failed'
    | 'rolled_back'
    | 'rollback_failed'
    | 'skipped_locked'
    | 'exited'
    | 'lost';
  ok: boolean;
  buildId?: string;
  elapsedSec?: number;
  onlineInSec?: number | string;
  exitCode?: number | string;
  tail?: string;
  finishedAt?: number;
}

const DIR = path.join(process.cwd(), 'data', 'detached-jobs');
const LOG_PATH = '/root/ai-chat/detached-restart.log';
const SWEEP_MS = 8000;
const MAX_JOB_MS = 15 * 60 * 1000;
const REPORT_TTL_MS = 10 * 60 * 1000;

function deferSeconds(): number {
  return Math.min(Math.max(Number(process.env.DEFER_RESTART_SEC || 30) || 30, 10), 180);
}

function intentPath(jobId: string): string {
  return path.join(DIR, `${jobId}.json`);
}
function resultPathFor(jobId: string): string {
  return path.join(DIR, `${jobId}.result.json`);
}
function capturePathFor(jobId: string): string {
  return path.join(DIR, `${jobId}.out`);
}

function ensureDir(): void {
  try {
    fs.mkdirSync(DIR, { recursive: true });
  } catch {}
}

function writeJsonAtomic(file: string, data: unknown): void {
  try {
    ensureDir();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  } catch (err: any) {
    console.warn('[detached-jobs] gagal menulis', file, err?.message || err);
  }
}

function readJsonSafe<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Skrip pembungkus: tidur sejenak (agar jawaban saat ini sempat terkirim), jalankan
 * perintah ke berkas capture, lalu JAMIN ada berkas hasil — kalau deploy.sh tidak
 * menulisnya (perintah bukan deploy, atau deploy.sh versi lama), tulis fallback
 * dari exit code. Laporan karena itu tidak pernah hilang diam-diam.
 */
function buildWrapperScript(intent: DetachedJobIntent, command: string): string {
  const q = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  return [
    '#!/bin/bash',
    `CAP=${q(intent.capturePath)}`,
    `RES=${q(intent.resultPath)}`,
    `export AICHAT_DEPLOY_RESULT=${q(intent.resultPath)}`,
    `export AICHAT_JOB_ID=${q(intent.jobId)}`,
    `sleep ${intent.deferSec}`,
    `cd /root/ai-chat || exit 97`,
    // Grup { ... } supaya perintah multi-baris dari model utuh dan seluruh
    // outputnya (termasuk stderr) tertangkap ke capture.
    '{',
    command,
    '} >"$CAP" 2>&1',
    'code=$?',
    `cat "$CAP" >> ${q(LOG_PATH)} 2>/dev/null`,
    `if [ ! -f "$RES" ]; then`,
    `  tail_txt="$(tail -n 20 "$CAP" | tr '\\n' '~' | sed 's/"/\\\\\\"/g')"`,
    `  st=exited; ok=false`,
    `  [ "$code" -eq 0 ] && { st=success; ok=true; }`,
    `  printf '{"status":"%s","ok":%s,"exitCode":%s,"tail":"%s","finishedAt":%s}\\n' \\`,
    `    "$st" "$ok" "$code" "$tail_txt" "$(date +%s%3N)" > "$RES.tmp" && mv "$RES.tmp" "$RES"`,
    `fi`,
  ].join('\n');
}

export interface DetachedJobContext {
  conversationId?: string;
  userId?: string;
  temporary?: boolean;
}

export type ScheduleOutcome =
  | { scheduled: true; jobId: string; deferSec: number }
  | { scheduled: false; error: string };

/**
 * Jadwalkan perintah agar jalan sendiri DAN dilaporkan hasilnya ke percakapan.
 * Memerlukan percakapan persisten: percakapan temporary tidak punya tempat untuk
 * melaporkan, jadi callers harus jatuh ke perilaku lama.
 */
export function scheduleDetachedJob(
  command: string,
  ctx: DetachedJobContext,
  kind: DetachedJobKind
): ScheduleOutcome {
  if (!ctx.conversationId) return { scheduled: false, error: 'tanpa conversationId' };
  if (ctx.temporary) return { scheduled: false, error: 'percakapan temporary' };

  const jobId = `dj_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const deferSec = kind === 'detached-cmd' ? 0 : deferSeconds();
  const now = Date.now();

  const intent: DetachedJobIntent = {
    jobId,
    conversationId: ctx.conversationId,
    userId: ctx.userId,
    kind,
    command: String(command).slice(0, 200),
    scheduledAt: now,
    deferSec,
    deadlineAt: now + deferSec * 1000 + MAX_JOB_MS,
    capturePath: capturePathFor(jobId),
    resultPath: resultPathFor(jobId),
    status: 'pending',
  };

  writeJsonAtomic(intentPath(jobId), intent);

  const scriptPath = path.join(DIR, `${jobId}.sh`);
  try {
    ensureDir();
    fs.writeFileSync(scriptPath, buildWrapperScript(intent, command), { mode: 0o755 });
  } catch (err: any) {
    return { scheduled: false, error: err?.message || String(err) };
  }

  // Path di sini kita generate sendiri, tapi tetap dikutip gaya shell (bukan
  // JSON.stringify, yang escapenya tidak setara untuk bash).
  const quotedScript = `'${scriptPath.replace(/'/g, `'\\''`)}'`;

  try {
    exec(
      `setsid bash ${quotedScript} < /dev/null > /dev/null 2>&1 &`,
      { shell: '/bin/bash' },
      () => {
        try {
          fs.unlinkSync(scriptPath);
        } catch {}
      }
    );
  } catch (err: any) {
    try {
      fs.unlinkSync(scriptPath);
    } catch {}
    return { scheduled: false, error: err?.message || String(err) };
  }

  console.log(`[detached-jobs] dijadwalkan ${jobId} (${kind}, +${deferSec}s) -> percakapan ${ctx.conversationId}`);
  return { scheduled: true, jobId, deferSec };
}

const OUTCOME_LABEL: Record<DetachedJobResult['status'], string> = {
  success: '✅ Selesai',
  build_failed: '❌ BUILD GAGAL — server lama tidak disentuh',
  swap_failed: '❌ Gagal menukar folder build',
  rolled_back: '⏪ ROLLBACK — build lama dipulihkan',
  rollback_failed: '🚨 Rollback GAGAL — perlu cek manual',
  skipped_locked: '⏭️ Dilewati: deploy lain sedang berjalan',
  exited: '⚠️ Perintah selesai dengan error',
  lost: '⚠️ Tidak ada laporan',
};

function kindHeading(kind: DetachedJobKind): string {
  if (kind === 'self-restart-deploy') return 'Deploy ai-chat';
  if (kind === 'provider-restart') return 'Restart provider model';
  return 'Perintah latar belakang';
}

function formatOutcome(intent: DetachedJobIntent, result: DetachedJobResult): string {
  const head = `${kindHeading(intent.kind)} — ${OUTCOME_LABEL[result.status] || result.status}`;
  const bits: string[] = [];
  if (typeof result.elapsedSec === 'number') bits.push(`lama ${result.elapsedSec}s`);
  if (result.buildId) bits.push(`build \`${result.buildId}\``);
  if (result.status === 'success' && result.onlineInSec !== undefined && result.onlineInSec !== '')
    bits.push(`online dalam ${result.onlineInSec}s`);
  if (result.exitCode !== undefined && result.exitCode !== 0 && result.exitCode !== '0')
    bits.push(`exit ${result.exitCode}`);

  let body = bits.length ? `${head} (${bits.join(', ')}).` : `${head}.`;

  const tail = (result.tail || '').replace(/~/g, '\n').trim();
  if (tail && !result.ok) {
    body += `\n\n\`\`\`text\n${tail.slice(-2000)}\n\`\`\``;
  }

  if (result.status === 'lost') {
    body +=
      '\n\nProses latar belakang tidak meninggalkan laporan — kemungkinan mati di tengah jalan. ' +
      'Cek `pm2 logs ai-chat --lines 80` atau `/root/ai-chat/detached-restart.log`.';
  }

  return body;
}

/** Sisipkan pesan laporan SEKALI. Mengembalikan true bila pesan kini ada di DB. */
function insertOutcomeMessage(intent: DetachedJobIntent, result: DetachedJobResult): boolean {
  const msgId = `msg_job_${intent.jobId}`;
  if (MessageRepository.getMessage(msgId)) return true;

  try {
    ConversationRepository.getConversation(intent.conversationId);
  } catch {}

  const content = formatOutcome(intent, result);
  try {
    MessageRepository.createMessage({
      id: msgId,
      conversationId: intent.conversationId,
      role: 'assistant',
      content,
      model: 'detached-job',
      provider: 'system',
      finishReason: 'detached-job',
      metadata: {
        totalTokens: 0,
        detachedJob: {
          jobId: intent.jobId,
          kind: intent.kind,
          status: result.status,
          ok: result.ok,
          buildId: result.buildId || null,
          elapsedSec: result.elapsedSec ?? null,
        },
      },
    });
    intent.outcomeMessageId = msgId;
    return true;
  } catch (err: any) {
    // PRIMARY KEY sudah ada = proses kembar (lama & baru hidup bersamaan) sudah
    // menyisipkan lebih dulu. Itu sukses, bukan kegagalan.
    if (String(err?.message || err).includes('UNIQUE')) {
      intent.outcomeMessageId = msgId;
      return true;
    }
    console.warn('[detached-jobs] gagal menyisipkan laporan:', err?.message || err);
    return false;
  }
}

function markReported(intent: DetachedJobIntent): void {
  intent.status = 'reported';
  intent.reportedAt = Date.now();
  writeJsonAtomic(intentPath(intent.jobId), intent);
}

function dropJob(intent: DetachedJobIntent, why: string): void {
  console.log(`[detached-jobs] ${intent.jobId} dibuang: ${why}`);
  intent.status = 'dropped';
  writeJsonAtomic(intentPath(intent.jobId), intent);
}

/** Ringkasan AI best-effort di atas laporan deterministik. Tidak pernah memblokir. */
async function trySummarize(intent: DetachedJobIntent, result: DetachedJobResult): Promise<void> {
  if (intent.summaryAttempted) return;
  if (intent.kind === 'provider-restart') return; // provider-nya sedang mati
  intent.summaryAttempted = true;
  markSummaryAttempt(intent);

  try {
    const conv = ConversationRepository.getConversation(intent.conversationId);
    if (!conv) return;

    const { AIRouter } = await import('@/lib/ai/router');
    const factual = formatOutcome(intent, result).replace(/```[\s\S]*?```/g, '').trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await AIRouter.chat(conv.providerId, {
        model: conv.modelId,
        abortSignal: controller.signal,
        systemPrompt:
          'Anda merangkum hasil satu tugas latar belakang. Tulis 1-2 kalimat bahasa ' +
          'Indonesia langsung ke inti: apa yang terjadi dan apa tindakannya bila gagal. ' +
          'Jangan mengulang angka yang sudah ada, jangan basa-basi, jangan markdown heading.',
        messages: [{ role: 'user', content: factual.slice(0, 4000) }],
      });
      clearTimeout(timer);
      const text = (res.content || '').trim();
      if (!text) return;
      const msgId = intent.outcomeMessageId || `msg_job_${intent.jobId}`;
      const existing = MessageRepository.getMessage(msgId);
      if (!existing) return;
      MessageRepository.updateMessage(msgId, {
        content: `${existing.content}\n\n${text}`,
      });
    } catch {
      clearTimeout(timer);
    }
  } catch {}
}

function markSummaryAttempt(intent: DetachedJobIntent): void {
  writeJsonAtomic(intentPath(intent.jobId), intent);
}

function listIntents(): DetachedJobIntent[] {
  try {
    if (!fs.existsSync(DIR)) return [];
    return fs
      .readdirSync(DIR)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.result.json'))
      .map((f) => readJsonSafe<DetachedJobIntent>(path.join(DIR, f)))
      .filter((x): x is DetachedJobIntent => Boolean(x?.jobId));
  } catch {
    return [];
  }
}

/** Buang berkas job yang sudah lama dilaporkan atau tidak punya induk. */
function gcJobFiles(): void {
  try {
    if (!fs.existsSync(DIR)) return;
    const files = fs.readdirSync(DIR);
    const intents = new Set(listIntents().map((i) => i.jobId));
    const now = Date.now();

    for (const name of files) {
      const full = path.join(DIR, name);
      const jobId = name.replace(/\.(json|result\.json|out|sh)$/, '');

      if (name.endsWith('.result.json') || name.endsWith('.out')) {
        if (!intents.has(jobId)) {
          try {
            fs.unlinkSync(full);
          } catch {}
        }
        continue;
      }
      if (!name.endsWith('.json') || name.endsWith('.result.json')) continue;

      const intent = readJsonSafe<DetachedJobIntent>(full);
      if (intent?.status === 'reported' && now - (intent.reportedAt || 0) > REPORT_TTL_MS) {
        for (const p of [full, resultPathFor(jobId), capturePathFor(jobId)]) {
          try {
            fs.unlinkSync(p);
          } catch {}
        }
      }
    }
  } catch {}
}

/**
 * Periksa semua job: laporkan yang sudah punya hasil, tandai yang kehilangan kontak,
 * dan buang berkas sisa. Aman dipanggil berkali-kali (idempoten).
 */
export async function recoverDetachedJobs(): Promise<string[]> {
  const reported: string[] = [];
  const now = Date.now();

  for (const intent of listIntents()) {
    if (intent.status !== 'pending') continue;

    const result = readJsonSafe<DetachedJobResult>(intent.resultPath);

    if (!result) {
      if (now > intent.deadlineAt) {
        const lost: DetachedJobResult = { status: 'lost', ok: false, finishedAt: now };
        if (insertOutcomeMessage(intent, lost)) {
          markReported(intent);
          reported.push(intent.jobId);
        }
      }
      continue;
    }

    const conversation = (() => {
      try {
        return ConversationRepository.getConversation(intent.conversationId);
      } catch {
        return null;
      }
    })();
    if (!conversation) {
      dropJob(intent, 'percakapan sudah dihapus');
      continue;
    }

    if (insertOutcomeMessage(intent, result)) {
      markReported(intent);
      reported.push(intent.jobId);
      // Sengaja tidak di-await: permintaan yang memicu pemulihan tidak boleh
      // menunggu model merangkum.
      void trySummarize(intent, result);
    }
  }

  gcJobFiles();
  return reported;
}

/** Ringkasan ringan untuk UI: job pending + job yang baru dilaporkan. */
export function listJobsForConversation(conversationId: string): Array<{
  jobId: string;
  kind: DetachedJobKind;
  status: string;
  command: string;
  scheduledAt: number;
  reportedAt?: number;
  outcome?: DetachedJobResult['status'];
  ok?: boolean;
}> {
  const now = Date.now();
  return listIntents()
    .filter(
      (i) =>
        i.conversationId === conversationId &&
        (i.status === 'pending' || now - (i.reportedAt || 0) < REPORT_TTL_MS)
    )
    .map((i) => {
      const result =
        i.status === 'pending' ? null : readJsonSafe<DetachedJobResult>(resultPathFor(i.jobId));
      return {
        jobId: i.jobId,
        kind: i.kind,
        status: i.status,
        command: i.command,
        scheduledAt: i.scheduledAt,
        reportedAt: i.reportedAt,
        outcome: result?.status,
        ok: result?.ok,
      };
    })
    .sort((a, b) => b.scheduledAt - a.scheduledAt)
    .slice(0, 10);
}

const g = globalThis as unknown as {
  __aiChatDetachedRecovered?: boolean;
  __aiChatDetachedSweeper?: ReturnType<typeof setInterval>;
};

/** Sekali per proses: laporkan job tertinggal secepatnya (dipakai GET & POST). */
export function ensureJobsRecovered(): void {
  if (g.__aiChatDetachedRecovered) return;
  g.__aiChatDetachedRecovered = true;
  void recoverDetachedJobs().catch((err) =>
    console.warn('[detached-jobs] pemulihan gagal:', err?.message || err)
  );
}

if (typeof globalThis !== 'undefined' && !g.__aiChatDetachedSweeper) {
  g.__aiChatDetachedSweeper = setInterval(() => {
    void recoverDetachedJobs().catch(() => undefined);
  }, SWEEP_MS);
  g.__aiChatDetachedSweeper.unref?.();
}
