'use client';

import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  ArrowUp,
  Square,
  SlidersHorizontal,
  X,
  FileText,
  Image as ImageIcon,
  Camera,
  Plus,
  Mic,
  MicOff,
  MapPin,
  MapPinOff,
  Loader2,
  Terminal,
  BookOpen,
  Plug,
  Globe,
} from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { useUIStore } from '@/stores/ui-store';
import { useSettingsStore } from '@/stores/settings-store';
import { PersonaSelector } from './persona-selector';

interface SlashCommandItem {
  id: string;
  command: string;
  label: string;
  description: string;
  insertText?: string;
}

const CORE_SLASH_COMMANDS: SlashCommandItem[] = [
  {
    id: 'konektor',
    command: '/connectors',
    label: 'Buka Konektor AI & Integrasi',
    description: 'Atur konektor server, GitHub, WA-Bot, dan integrasi alat.',
  },
  {
    id: 'terminal-live',
    command: '/cli',
    label: 'Buka Terminal CLI & Web Aktif',
    description: 'Buka panel eksekusi bash interaktif dan inspektor Chrome live.',
  },
  {
    id: 'katalog-skill',
    command: '/skills',
    label: 'Buka Katalog Modul Skill',
    description: 'Lihat, cari, baca, atau edit 70+ modul keahlian di server.',
  },
  {
    id: 'cari-web',
    command: '/web',
    label: 'Pencarian Web Multi-Sumber ([CARI_WEB])',
    description: 'Cari sumber berita & referensi web terbaru lengkap dengan logo situs.',
    insertText: '[CARI_WEB: ',
  },
  {
    id: 'buka-web',
    command: '/buka',
    label: 'Baca Halaman via Chrome ([BUKA_WEB])',
    description: 'Buka URL menggunakan Google Chrome headless dan ekstrak teks DOM.',
    insertText: '[BUKA_WEB: https://',
  },
  {
    id: 'run-bash',
    command: '/bash',
    label: 'Jalankan Perintah Server ([RUN_BASH])',
    description: 'Eksekusi perintah Linux bash di server VPS (khusus Admin).',
    insertText: '[RUN_BASH: ',
  },
  {
    id: 'baca-skill',
    command: '/skill',
    label: 'Panggil Modul Skill ([BACA_SKILL])',
    description: 'Baca dokumentasi SOP dari folder /root/ai-chat/skills.',
    insertText: '[BACA_SKILL: ',
  },
  {
    id: 'cek-cuaca',
    command: '/cuaca',
    label: 'Prakiraan Cuaca Real-Time ([CEK_CUACA])',
    description: 'Ambil cuaca terkini dari Open-Meteo berdasarkan kota atau GPS.',
    insertText: '[CEK_CUACA: ',
  },
  {
    id: 'ig-download',
    command: '/ig',
    label: 'Unduh Video Instagram Reels/Postingan',
    description: 'Tempel tautan Instagram (Reels/Post) lalu sistem mengunduh videonya.',
    insertText: '/ig https://www.instagram.com/reel/',
  },
  {
    id: 'tavily-cari',
    command: '/tavily',
    label: 'Pencarian Web Tavily (Skill)',
    description: 'Cari web lewat skill Tavily: hasil bersih, filter domain, rentang waktu.',
    insertText: '[BACA_SKILL: tavily-search] ',
  },
  {
    id: 'tavily-extract',
    command: '/extract',
    label: 'Ekstrak Isi Halaman (Tavily Extract)',
    description: 'Ambil teks/markdown bersih dari URL, termasuk halaman ber-JavaScript.',
    insertText: '[BACA_SKILL: tavily-extract] ',
  },
  {
    id: 'tavily-research',
    command: '/research',
    label: 'Riset Mendalam Bersitasi (Tavily Research)',
    description: 'Riset multi-sumber dengan sitasi; cocok untuk analisis & perbandingan.',
    insertText: '[BACA_SKILL: tavily-research] ',
  },
];

export const Composer: React.FC = () => {
  const {
    sendMessage,
    stopGeneration,
    isGenerating,
    attachments,
    addAttachment,
    removeAttachment,
    activeConversationId,
    activeModelId,
    models,
    systemPrompt,
    setSystemPrompt,
    temperature,
    topP,
    setParameters,
    userLocation,
    locationStatus,
    requestUserLocation,
    setUserLocation,
    setLocationStatus,
  } = useChatStore();

  const {
    addToast,
    composerInsertText,
    clearComposerInsert,
    setSkillsDialogOpen,
    setConnectorsDialogOpen,
    setWorkspaceOpen,
    workspaceOpen,
  } = useUIStore();

  const { settings } = useSettingsStore();

  const [input, setInput] = useState('');
  const [showParams, setShowParams] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const draftKey = `antigravity_draft_${activeConversationId || 'new'}`;

  // Restore saved draft when switching conversations or reloading
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const savedDraft = localStorage.getItem(draftKey);
      setInput(savedDraft || '');
    } catch {}
  }, [draftKey]);

  // Persist draft automatically as user types
  const updateInputWithDraft = (nextVal: string | ((prev: string) => string)) => {
    setInput((prev) => {
      const resolved = typeof nextVal === 'function' ? nextVal(prev) : nextVal;
      if (typeof window !== 'undefined') {
        try {
          if (resolved.trim()) {
            localStorage.setItem(draftKey, resolved);
          } else {
            localStorage.removeItem(draftKey);
          }
        } catch {}
      }
      return resolved;
    });
  };

  const activeModel = models.find(
    (m) => m.modelId === activeModelId || m.id === activeModelId
  );

  const slashQuery = useMemo(() => {
    const trimmed = input.trimStart();
    if (!trimmed.startsWith('/')) return null;
    if (trimmed.includes(' ') || trimmed.includes('\n')) return null;
    return trimmed.slice(1).toLowerCase();
  }, [input]);

  const filteredSlashCommands = useMemo(() => {
    if (slashQuery === null) return [];
    if (!slashQuery) return CORE_SLASH_COMMANDS;
    return CORE_SLASH_COMMANDS.filter(
      (item) =>
        item.command.slice(1).includes(slashQuery) ||
        item.label.toLowerCase().includes(slashQuery)
    );
  }, [slashQuery]);

  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery]);

  const executeSlashCommand = (item: SlashCommandItem) => {
    if (item.id === 'konektor') {
      updateInputWithDraft('');
      setConnectorsDialogOpen(true);
      return;
    }
    if (item.id === 'terminal-live') {
      updateInputWithDraft('');
      setWorkspaceOpen(true, 'terminal');
      return;
    }
    if (item.id === 'katalog-skill') {
      updateInputWithDraft('');
      setSkillsDialogOpen(true);
      return;
    }
    if (item.insertText) {
      updateInputWithDraft(item.insertText);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 20);
    }
  };

  useEffect(() => {
    if (composerInsertText) {
      updateInputWithDraft((prev) => {
        const prefix = prev.trim() ? prev + '\n\n' : '';
        return prefix + composerInsertText;
      });
      clearComposerInsert();
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerInsertText, clearComposerInsert]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, 160);
    textarea.style.height = `${Math.max(32, nextHeight)}px`;
  }, [input]);

  const toggleVoiceInput = () => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      addToast('Browser ini belum mendukung fitur Speech-to-Text.', 'error');
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'id-ID';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          updateInputWithDraft((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      };

      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  const handleToggleLocation = async () => {
    if (locationStatus === 'granted' && userLocation) {
      setUserLocation(null);
      setLocationStatus('idle');
      return;
    }
    const loc = await requestUserLocation({ ipFallback: true });
    if (!loc) {
      addToast('Gagal mengakses lokasi.', 'error');
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isGenerating) return;
    if (!input.trim() && attachments.length === 0) return;

    // Minta izin notifikasi sistem HP secara halus agar bisa memberi tahu saat tugas latar belakang selesai
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      Notification.requestPermission().catch(() => {});
    }

    const currentText = input;
    updateInputWithDraft('');
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(draftKey);
        localStorage.removeItem('antigravity_draft_new');
      } catch {}
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = '32px';
    }
    await sendMessage(currentText);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((prev) => (prev + 1) % filteredSlashCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex(
          (prev) => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length
        );
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        executeSlashCommand(filteredSlashCommands[slashIndex]);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && settings.sendOnEnter !== false) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const processFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) {
        addToast(`Ukuran berkas ${file.name} melebihi batas 20MB`, 'error');
        continue;
      }

      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload gagal');
        const att = data.attachment || data.file;
        if (att) {
          addAttachment(att);
          addToast(`Berkas ${file.name} siap dilampirkan`, 'success');
        }
      } catch (err: any) {
        addToast(err.message || 'Gagal mengunggah berkas', 'error');
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      await processFiles(imageFiles);
    }
  };

  return (
    <div
      className="w-full px-3 sm:px-6 pb-3 pt-1 bg-background/95 backdrop-blur-md z-10 font-sans"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          await processFiles(e.dataTransfer.files);
        }
      }}
    >
      <div className="max-w-3xl mx-auto relative">
        {/* Slash Command Menu Popover */}
        {filteredSlashCommands.length > 0 && (
          <div className="mb-2 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
            <div className="px-3 py-1.5 border-b border-border bg-secondary/60 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
              <span>Perintah & Konektor Cepat</span>
              <span>↑↓ Pilih · Enter Pasang</span>
            </div>
            <div className="divide-y divide-border/50 max-h-56 overflow-y-auto">
              {filteredSlashCommands.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => executeSlashCommand(item)}
                  className={`w-full px-3.5 py-2 text-left flex items-center justify-between gap-3 transition-colors ${
                    idx === slashIndex ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/60'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-primary">
                        {item.command}
                      </span>
                      <span className="text-xs font-medium text-foreground">{item.label}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {item.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quick Model Parameters Drawer */}
        {showParams && (
          <div className="mb-2 p-3.5 rounded-xl border border-border bg-card shadow-lg space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="font-semibold text-foreground">
                Parameter Sesi ({activeModel?.displayName || activeModelId})
              </span>
              <button
                type="button"
                onClick={() => setShowParams(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between mb-1">
                  <label htmlFor="param-temp" className="text-muted-foreground">
                    Temperature
                  </label>
                  <span className="font-mono font-semibold text-foreground">{temperature}</span>
                </div>
                <input
                  id="param-temp"
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setParameters({ temperature: parseFloat(e.target.value) })}
                  className="w-full accent-primary cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <label htmlFor="param-top-p" className="text-muted-foreground">
                    Top P
                  </label>
                  <span className="font-mono font-semibold text-foreground">{topP}</span>
                </div>
                <input
                  id="param-top-p"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={topP}
                  onChange={(e) => setParameters({ topP: parseFloat(e.target.value) })}
                  className="w-full accent-primary cursor-pointer"
                />
              </div>
            </div>

            <div>
              <label htmlFor="param-sys-prompt" className="block text-muted-foreground mb-1">
                System Prompt Khusus Sesi Ini
              </label>
              <textarea
                id="param-sys-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Instruksi khusus untuk sesi percakapan ini..."
                rows={2}
                className="w-full p-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>
          </div>
        )}

        {/* Composer Box */}
        <form
          onSubmit={handleSubmit}
          className={`relative rounded-2xl border transition-colors bg-card shadow-xs ${
            isDragging
              ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
              : 'border-border focus-within:border-primary/60'
          }`}
        >
          {/* Attachments Preview Bar */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-2.5 pb-1 border-b border-border/60">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-lg bg-secondary border border-border text-xs group"
                >
                  {att.mimeType?.startsWith('image/') ? (
                    <ImageIcon className="w-3.5 h-3.5 text-primary shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                  )}
                  <span className="truncate max-w-[150px] text-foreground font-medium">
                    {att.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    className="text-muted-foreground hover:text-destructive p-0.5 rounded"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Main Textarea (Compact) */}
          <div className="px-3.5 pt-2.5 pb-1">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => updateInputWithDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={`Kirim instruksi ke ${activeModel?.displayName || 'Asisten'} (ketik / untuk alat)...`}
              rows={1}
              className="w-full bg-transparent text-foreground placeholder:text-muted-foreground/60 text-sm focus:outline-none resize-none max-h-[160px] leading-relaxed"
            />
          </div>

          {/* Bottom Controls Toolbar */}
          <div className="flex items-center justify-between px-2.5 pb-2 pt-0.5">
            <div className="flex items-center gap-1 flex-wrap">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                multiple
                className="hidden"
              />
              <input
                type="file"
                ref={galleryInputRef}
                onChange={handleFileChange}
                accept="image/*,video/*"
                multiple
                className="hidden"
              />
              <input
                type="file"
                ref={cameraInputRef}
                onChange={handleFileChange}
                accept="image/*"
                capture="environment"
                className="hidden"
              />

              {/* Plus / Attachment Menu */}
              <div className="relative" ref={attachMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowAttachMenu((v) => !v)}
                  className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${
                    showAttachMenu
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                  }`}
                  title="Lampirkan berkas atau foto"
                >
                  <Plus
                    className={`w-4 h-4 transition-transform duration-150 ${
                      showAttachMenu ? 'rotate-45' : ''
                    }`}
                  />
                </button>

                {showAttachMenu && (
                  <div className="absolute bottom-9 left-0 w-52 rounded-xl border border-border bg-card shadow-xl py-1.5 z-30 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachMenu(false);
                        galleryInputRef.current?.click();
                      }}
                      className="w-full px-3 py-2 text-left flex items-center gap-2.5 hover:bg-muted transition-colors text-foreground"
                    >
                      <ImageIcon className="w-4 h-4 text-primary" />
                      <span>Galeri Foto / Video</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachMenu(false);
                        fileInputRef.current?.click();
                      }}
                      className="w-full px-3 py-2 text-left flex items-center gap-2.5 hover:bg-muted transition-colors text-foreground"
                    >
                      <FileText className="w-4 h-4 text-primary" />
                      <span>Dokumen / Berkas</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachMenu(false);
                        cameraInputRef.current?.click();
                      }}
                      className="w-full px-3 py-2 text-left flex items-center gap-2.5 hover:bg-muted transition-colors text-foreground"
                    >
                      <Camera className="w-4 h-4 text-primary" />
                      <span>Ambil Foto Kamera</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachMenu(false);
                        setConnectorsDialogOpen(true);
                      }}
                      className="w-full px-3 py-2 text-left flex items-center gap-2.5 hover:bg-muted transition-colors text-foreground border-t border-border mt-1 pt-2"
                    >
                      <Plug className="w-4 h-4 text-primary" />
                      <span>Konektor AI & Integrasi</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachMenu(false);
                        setSkillsDialogOpen(true);
                      }}
                      className="w-full px-3 py-2 text-left flex items-center gap-2.5 hover:bg-muted transition-colors text-foreground"
                    >
                      <BookOpen className="w-4 h-4 text-primary" />
                      <span>Katalog Skill Server</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Persona picker — mobile only; desktop uses the header picker */}
              <div className="md:hidden">
                <PersonaSelector variant="composer" />
              </div>

              {/* Connectors Pill Button */}
              <button
                type="button"
                onClick={() => setConnectorsDialogOpen(true)}
                className="h-7 px-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 flex items-center gap-1 text-[11px] font-medium transition-colors"
                title="Buka Konektor AI Modern"
              >
                <Plug className="w-3.5 h-3.5 text-primary" />
                <span className="hidden sm:inline">Konektor</span>
              </button>

              {/* Live CLI / Web Workspace Quick Open */}
              <button
                type="button"
                onClick={() => setWorkspaceOpen(!workspaceOpen, 'browser')}
                className={`h-7 px-2 rounded-lg flex items-center gap-1 text-[11px] font-medium transition-colors ${
                  workspaceOpen
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
                title="Buka Terminal CLI & Web Aktif di bawah chat"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span className="hidden md:inline">CLI/Web</span>
              </button>

              {/* GPS Location Button */}
              <button
                type="button"
                onClick={handleToggleLocation}
                disabled={locationStatus === 'requesting'}
                className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${
                  locationStatus === 'granted' && userLocation
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
                title={
                  locationStatus === 'granted' && userLocation
                    ? `Lokasi aktif: ${userLocation.label || `${userLocation.lat.toFixed(2)}, ${userLocation.lon.toFixed(2)}`}`
                    : 'Aktifkan lokasi GPS'
                }
              >
                {locationStatus === 'requesting' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                ) : locationStatus === 'granted' && userLocation ? (
                  <MapPin className="w-3.5 h-3.5" />
                ) : (
                  <MapPinOff className="w-3.5 h-3.5" />
                )}
              </button>

              {/* Session Parameters Toggle */}
              <button
                type="button"
                onClick={() => setShowParams(!showParams)}
                className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${
                  showParams
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
                title="Parameter sesi (Temperature & Prompt)"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Right: Voice Input & Send / Stop Button */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleVoiceInput}
                className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${
                  isListening
                    ? 'bg-destructive/15 text-destructive animate-pulse'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
                title={isListening ? 'Hentikan rekaman suara' : 'ikte suara'}
              >
                {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              </button>

              {isGenerating ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="h-7 px-2.5 rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors flex items-center gap-1 text-xs font-medium"
                  title="Hentikan generasi (Esc)"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Hentikan</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() && attachments.length === 0}
                  className="h-7 w-7 rounded-lg bg-primary text-primary-foreground hover:bg-primary-hover disabled:opacity-30 disabled:pointer-events-none transition-colors flex items-center justify-center"
                  title="Kirim pesan (Enter)"
                >
                  <ArrowUp className="w-4 h-4 stroke-[2.4]" />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
