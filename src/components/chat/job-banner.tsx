'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Rocket, AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';

type JobInfo = {
  jobId: string;
  kind: 'self-restart-deploy' | 'provider-restart' | 'detached-cmd';
  status: 'pending' | 'reported' | 'dropped';
  command: string;
  scheduledAt: number;
  reportedAt?: number;
  outcome?: string;
  ok?: boolean;
};

const KIND_LABEL: Record<JobInfo['kind'], string> = {
  'self-restart-deploy': 'Deploy ai-chat',
  'provider-restart': 'Restart provider',
  'detached-cmd': 'Perintah latar belakang',
};

const POLL_ACTIVE_MS = 5000;
const POLL_IDLE_MS = 30000;
const DONE_HIDE_MS = 10000;

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export const JobBanner: React.FC = () => {
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const isGenerating = useChatStore((s) => s.isGenerating);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const prevJobsRef = useRef<JobInfo[]>([]);
  const isGeneratingRef = useRef(isGenerating);
  isGeneratingRef.current = isGenerating;

  const poll = useCallback(async () => {
    const convId = useChatStore.getState().activeConversationId;
    if (!convId) return;
    try {
      const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(convId)}&t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      const next: JobInfo[] = Array.isArray(data.jobs) ? data.jobs : [];

      // Ada job yang baru selesai dilaporkan? Muat ulang pesan agar laporan
      // (pesan msg_job_*) langsung tampil, selama tidak menyela streaming aktif.
      const prev = prevJobsRef.current;
      const justReported = next.some(
        (j) => j.status === 'reported' && !prev.find((p) => p.jobId === j.jobId && p.status === 'reported')
      );
      if (justReported && !isGeneratingRef.current) {
        await useChatStore.getState().selectConversation(convId);
      }

      prevJobsRef.current = next;
      setJobs(next);
    } catch {
      // jaringan belum siap — coba lagi pada tick berikutnya
    }
  }, []);

  useEffect(() => {
    setDismissed({});
    prevJobsRef.current = [];
    setJobs([]);
    if (!activeConversationId) return;
    void poll();
  }, [activeConversationId, poll]);

  const hasPending = jobs.some((j) => j.status === 'pending');
  useEffect(() => {
    if (!activeConversationId) return;
    const ms = hasPending ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const t = setInterval(() => void poll(), ms);
    return () => clearInterval(t);
  }, [activeConversationId, hasPending, poll]);

  // Sembunyikan otomatis status selesai setelah beberapa saat.
  useEffect(() => {
    const done = jobs.filter((j) => j.status === 'reported');
    if (!done.length) return;
    const oldest = Math.min(...done.map((j) => j.reportedAt || 0));
    if (!oldest) return;
    const remaining = oldest + DONE_HIDE_MS - Date.now();
    if (remaining <= 0) {
      setDismissed((d) => {
        const next = { ...d };
        done.forEach((j) => (next[j.jobId] = true));
        return next;
      });
    } else {
      const t = setTimeout(() => {
        setDismissed((d) => {
          const next = { ...d };
          done.forEach((j) => (next[j.jobId] = true));
          return next;
        });
      }, remaining);
      return () => clearTimeout(t);
    }
  }, [jobs]);

  const visible = jobs.filter((j) => j.status !== 'dropped' && !dismissed[j.jobId]);
  if (!visible.length) return null;

  return (
    <div className="px-3 sm:px-6 pt-2 flex justify-center">
      <div className="w-full max-w-3xl space-y-1.5">
        {visible.map((job) => {
          const pending = job.status === 'pending';
          const ok = job.outcome ? job.outcome === 'success' : true;
          return (
            <div
              key={job.jobId}
              className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-xs backdrop-blur-md shadow-sm transition-colors ${
                pending
                  ? 'border-primary/30 bg-primary/10 text-foreground'
                  : ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-foreground'
                  : 'border-amber-500/40 bg-amber-500/10 text-foreground'
              }`}
            >
              {pending ? (
                <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-primary" />
              ) : ok ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
              )}
              <Rocket className="w-3.5 h-3.5 shrink-0 text-muted-foreground hidden sm:block" />
              <span className="font-medium">{KIND_LABEL[job.kind]}</span>
              <span className="text-muted-foreground truncate max-w-[40vw]">
                {pending ? `berjalan sejak ${timeLabel(job.scheduledAt)}…` : `selesai ${timeLabel(job.reportedAt || job.scheduledAt)}`}
              </span>
              {pending && <span className="text-muted-foreground italic ml-auto shrink-0">laporan otomatis menyusul</span>}
              {!pending && (
                <button
                  onClick={() => setDismissed((d) => ({ ...d, [job.jobId]: true }))}
                  className="ml-auto shrink-0 p-0.5 rounded-md hover:bg-muted text-muted-foreground"
                  title="Tutup"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
