'use client';

import React, { useRef, useState, useEffect } from 'react';
import {
  Paperclip,
  ArrowUp,
  Square,
  SlidersHorizontal,
  X,
  FileText,
  Image as ImageIcon,
  Camera,
  AlertTriangle,
  Brain,
  Sparkles,
  Globe,
  Wrench,
  Plus,
  Mic,
  AudioWaveform,
} from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useUIStore } from '@/stores/ui-store';
import { Attachment } from '@/types/chat';

export const Composer: React.FC = () => {
  const {
    sendMessage,
    stopGeneration,
    isGenerating,
    activeModelId,
    activeProviderId,
    models,
    attachments,
    addAttachment,
    removeAttachment,
    temperature,
    topP,
    maxTokens,
    reasoningEffort,
    messages,
    systemPrompt,
    setParameters,
    setSystemPrompt,
  } = useChatStore();

  const { settings } = useSettingsStore();
  const { addToast } = useUIStore();

  const [input, setInput] = useState('');
  const [paramsOpen, setParamsOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  const activeModel = models.find(m => m.modelId === activeModelId || m.id === activeModelId);

  const getModelDisplayName = (): string => {
    const raw = activeModel?.displayName || activeModel?.name || activeModelId || 'AI';
    let name = raw;
    if (name.includes(':')) name = name.split(':').pop() || name;
    if (name.includes('/')) name = name.split('/').pop() || name;
    name = name.replace(/:free$/i, '').trim();

    if (/qwen/i.test(name)) {
      if (/3\.8/i.test(name)) return 'Qwen 3.8';
      if (/3\.7/i.test(name)) return 'Qwen 3.7';
      if (/3\.5/i.test(name)) return 'Qwen 3.5';
      return 'Qwen';
    }
    if (/claude/i.test(name)) {
      if (/sonnet/i.test(name)) return 'Claude Sonnet';
      if (/opus/i.test(name)) return 'Claude Opus';
      if (/haiku/i.test(name)) return 'Claude Haiku';
      return 'Claude';
    }
    if (/deepseek/i.test(name)) {
      if (/r1/i.test(name)) return 'DeepSeek R1';
      if (/v4/i.test(name)) return 'DeepSeek V4';
      return 'DeepSeek';
    }
    if (/gemini/i.test(name)) {
      if (/flash/i.test(name)) return 'Gemini Flash';
      if (/pro/i.test(name)) return 'Gemini Pro';
      return 'Gemini';
    }
    if (/gpt/i.test(name)) {
      const match = name.match(/gpt-[\w.]+/i);
      return match ? match[0].toUpperCase() : 'GPT';
    }
    if (/grok/i.test(name)) return 'Grok';
    if (/mistral|codestral/i.test(name)) return 'Mistral';
    if (/kimi/i.test(name)) return 'Kimi';
    if (/minimax/i.test(name)) return 'MiniMax';

    return activeModel?.displayName || name;
  };

  const isVisionCapable = (model?: any, modelId?: string): boolean => {
    if (!model && !modelId) return true;
    if (model?.capabilities?.vision) return true;
    const id = (model?.modelId || model?.name || modelId || '').toLowerCase();
    return (
      id.includes('vision') ||
      id.includes('claude') ||
      id.includes('gpt-4') ||
      id.includes('gpt-5') ||
      id.includes('gemini') ||
      id.includes('qwen') ||
      id.includes('vl') ||
      id.includes('grok') ||
      id.includes('minimax') ||
      id.includes('sensenova')
    );
  };

  // Close attachment dropdown when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAttachMenuOpen(false);
    };

    if (attachMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [attachMenuOpen]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(Math.max(scrollHeight, 44), 200)}px`;
    }
  }, [input]);

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || isGenerating) return;
    sendMessage(input.trim());
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Regular Enter now only adds a new line (does NOT send).
    // Ctrl+Enter or Cmd+Enter can be used to send from physical keyboard.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  // Upload handler
  const handleFileUpload = async (files: FileList | File[]) => {
    setIsUploading(true);
    for (const file of Array.from(files)) {
      const isImg = file.type.startsWith('image/');
      if (isImg && !isVisionCapable(activeModel, activeModelId)) {
        addToast(`Perhatian: Model "${activeModel?.displayName || activeModelId}" mungkin kurang optimal untuk analisis visual/mata. Disarankan gunakan Claude Sonnet atau GPT-4o.`, 'info');
      }

      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Upload failed');
        }

        const data = await res.json();
        const processed = data.file;

        let dataUrl: string | undefined;
        if (isImg) {
          // Convert to base64 dataUrl for direct multi-modal vision prompt
          dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
        }

        addAttachment({
          id: processed.id,
          name: processed.name,
          mimeType: processed.mimeType,
          size: processed.size,
          url: processed.url,
          dataUrl,
        });

        addToast(`Attached: ${processed.name}`, 'info');
      } catch (err: any) {
        addToast(err.message, 'error');
      }
    }
    setIsUploading(false);
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  // Paste image handler
  const handlePaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      handleFileUpload(e.clipboardData.files);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative w-full max-w-3xl mx-auto px-3 sm:px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-5 transition-all ${
        isDragging ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
      }`}
    >
      {/* Hidden file inputs for Gallery, Camera, and Documents */}
      <input
        type="file"
        ref={galleryInputRef}
        accept="image/*"
        onChange={(e) => {
          if (e.target.files) handleFileUpload(e.target.files);
          e.target.value = '';
        }}
        multiple
        className="hidden"
      />
      <input
        type="file"
        ref={cameraInputRef}
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          if (e.target.files) handleFileUpload(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files) handleFileUpload(e.target.files);
          e.target.value = '';
        }}
        multiple
        className="hidden"
      />

      {/* Parameter drawer modal */}
      {paramsOpen && (
        <div className="mb-2 p-3 sm:p-4 rounded-xl border border-border bg-card shadow-lg text-xs space-y-3 animate-slide-in-up max-h-[60vh] overflow-y-auto">
          <div className="flex items-center justify-between font-semibold text-foreground border-b border-border/50 pb-2">
            <span>Model Parameters & System Prompt</span>
            <button
              onClick={() => setParamsOpen(false)}
              className="text-muted-foreground hover:text-foreground p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-muted-foreground mb-1 font-medium">System Instructions</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="e.g. You are an expert TypeScript architect..."
              className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-xs h-16 resize-y focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Temperature */}
            <div>
              <div className="flex justify-between text-muted-foreground mb-1">
                <span>Temperature</span>
                <span>{temperature}</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={temperature}
                onChange={(e) => setParameters({ temperature: parseFloat(e.target.value) })}
                className="w-full accent-primary"
              />
            </div>

            {/* Top P */}
            <div>
              <div className="flex justify-between text-muted-foreground mb-1">
                <span>Top P</span>
                <span>{topP}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={topP}
                onChange={(e) => setParameters({ topP: parseFloat(e.target.value) })}
                className="w-full accent-primary"
              />
            </div>

            {/* Max Output Tokens */}
            <div>
              <div className="flex justify-between text-muted-foreground mb-1">
                <span>Max Tokens</span>
                <span>{maxTokens || 'Default'}</span>
              </div>
              <input
                type="number"
                placeholder="e.g. 4096"
                value={maxTokens || ''}
                onChange={(e) => setParameters({ maxTokens: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                className="w-full p-1.5 rounded border border-border bg-background text-foreground text-xs"
              />
            </div>
          </div>
        </div>
      )}

      {/* Main Composer Box */}
      <div className="relative flex flex-col rounded-2xl border border-border/60 bg-card/75 backdrop-blur-xl shadow-md hover:border-border focus-within:border-foreground/30 focus-within:shadow-xl transition-all">
        {/* Attachment preview pills */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 p-3 pb-0">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-lg border border-border bg-muted/60 text-xs text-foreground group"
              >
                {att.mimeType.startsWith('image/') || att.url.match(/\.(png|jpg|jpeg|webp)$/i) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={att.dataUrl || att.url} alt={att.name} className="w-7 h-7 rounded-md object-cover border border-border/50 shadow-xs" />
                ) : (
                  <FileText className="w-4 h-4 text-primary shrink-0" />
                )}
                <span className="truncate max-w-[140px] font-medium">{att.name}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {(att.size / 1024).toFixed(0)}KB
                </span>
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Text Input */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={messages.length > 0 ? `Balas ${getModelDisplayName()}...` : `Tanya apa saja ke ${getModelDisplayName()}...`}
          rows={1}
          className="w-full px-4 pt-3.5 pb-2 bg-transparent text-foreground placeholder:text-muted-foreground/60 text-base sm:text-[15px] resize-none focus:outline-none leading-relaxed"
        />

        {/* Composer Toolbar - Claude Style */}
        <div className="flex items-center justify-between px-3 py-2 text-muted-foreground">
          {/* Left tools: Circular Plus & Model pill */}
          <div className="flex items-center gap-2">
            {/* Attachment Button & Popup Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setAttachMenuOpen(!attachMenuOpen)}
                disabled={isUploading}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all touch-manipulation ${
                  attachMenuOpen
                    ? 'bg-foreground text-background shadow-md'
                    : 'bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground'
                }`}
                title="Lampirkan foto atau dokumen"
                aria-label="Lampirkan foto atau dokumen"
              >
                <Plus className={`w-4 h-4 transition-transform duration-200 ${attachMenuOpen ? 'rotate-45' : ''}`} />
              </button>

              {/* Elegant Dropdown / Floating Card for Gallery, Camera & Files */}
              {attachMenuOpen && (
                <div
                  ref={attachMenuRef}
                  className="absolute bottom-11 left-0 z-40 flex flex-col gap-1 p-1.5 rounded-2xl border border-border/80 bg-card/95 backdrop-blur-2xl shadow-2xl min-w-[210px] animate-in fade-in zoom-in-95 duration-150 text-foreground"
                >
                  {/* Option 1: Galeri Foto (Direct Photo Gallery Picker) */}
                  <button
                    type="button"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      galleryInputRef.current?.click();
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-muted text-foreground text-xs font-medium transition-colors text-left group touch-manipulation"
                  >
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <ImageIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-foreground">Galeri Foto</div>
                      <div className="text-[10px] text-muted-foreground">Album & galeri perangkat</div>
                    </div>
                  </button>

                  {/* Option 2: Kamera Langsung (Direct Camera Snap) */}
                  <button
                    type="button"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      cameraInputRef.current?.click();
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-muted text-foreground text-xs font-medium transition-colors text-left group touch-manipulation"
                  >
                    <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <Camera className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-foreground">Ambil Foto (Kamera)</div>
                      <div className="text-[10px] text-muted-foreground">Potret langsung</div>
                    </div>
                  </button>

                  {/* Option 3: Dokumen & File */}
                  <button
                    type="button"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-muted text-foreground text-xs font-medium transition-colors text-left group touch-manipulation"
                  >
                    <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-foreground">Dokumen & File</div>
                      <div className="text-[10px] text-muted-foreground">PDF, TXT, kode, arsip</div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Claude Model Selector Pill */}
            <button
              onClick={() => useUIStore.getState().setModelSelectorOpen(true)}
              className="px-3 py-1.5 rounded-full bg-muted/60 hover:bg-muted text-foreground text-xs font-medium flex items-center gap-1.5 transition-colors max-w-[180px] sm:max-w-xs truncate touch-manipulation"
              title="Pilih Model"
            >
              <span className="truncate">{activeModel?.displayName || activeModelId || 'Claude'}</span>
            </button>

            <button
              onClick={() => setParamsOpen(!paramsOpen)}
              className={`p-1.5 rounded-lg transition-colors touch-manipulation ${
                paramsOpen ? 'text-primary bg-primary/10' : 'text-muted-foreground/70 hover:text-foreground'
              }`}
              title="Parameter AI"
              aria-label="Parameter AI"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Right tool: Voice/Waveform icons or Send/Stop button */}
          <div className="flex items-center gap-1">
            {isGenerating ? (
              <button
                onClick={stopGeneration}
                className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center hover:opacity-90 active:scale-95 transition-all touch-manipulation"
                title="Hentikan"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : input.trim() || attachments.length > 0 ? (
              <button
                onClick={handleSend}
                className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 active:scale-95 transition-all shadow-sm touch-manipulation"
                title="Kirim pesan"
                aria-label="Kirim pesan"
              >
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              </button>
            ) : (
              <div className="flex items-center gap-1 text-muted-foreground/70">
                <button
                  type="button"
                  onClick={() => useUIStore.getState().addToast('Voice input siap digunakan', 'info')}
                  className="p-1.5 rounded-full hover:text-foreground hover:bg-muted/40 transition-colors touch-manipulation"
                  title="Voice input"
                >
                  <Mic className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => useUIStore.getState().addToast('Voice mode siap digunakan', 'info')}
                  className="p-1.5 rounded-full hover:text-foreground hover:bg-muted/40 transition-colors touch-manipulation"
                  title="Audio mode"
                >
                  <AudioWaveform className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
