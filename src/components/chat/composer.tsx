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
  AlertTriangle,
  Brain,
  Sparkles,
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
    models,
    attachments,
    addAttachment,
    removeAttachment,
    temperature,
    topP,
    maxTokens,
    reasoningEffort,
    systemPrompt,
    setParameters,
    setSystemPrompt,
  } = useChatStore();

  const { settings } = useSettingsStore();
  const { addToast } = useUIStore();

  const [input, setInput] = useState('');
  const [paramsOpen, setParamsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeModel = models.find(m => m.modelId === activeModelId || m.id === activeModelId);
  const supportsVision = activeModel?.capabilities?.vision ?? false;

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
    if (e.key === 'Enter' && !e.shiftKey && settings.sendOnEnter) {
      e.preventDefault();
      handleSend();
    }
  };

  // Upload handler
  const handleFileUpload = async (files: FileList | File[]) => {
    setIsUploading(true);
    for (const file of Array.from(files)) {
      const isImg = file.type.startsWith('image/');
      if (isImg && !supportsVision) {
        addToast(`Model "${activeModel?.displayName || activeModelId}" does not support vision/image input.`, 'error');
        continue;
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
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
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
      <div className="relative flex flex-col rounded-2xl border border-border bg-card shadow-sm hover:border-border/80 focus-within:border-primary/50 transition-all">
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
                  <img src={att.url} alt={att.name} className="w-5 h-5 rounded object-cover" />
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
          placeholder="Message AI assistant... (Shift+Enter for new line)"
          rows={1}
          className="w-full px-4 pt-3.5 pb-2 rounded-t-2xl bg-transparent text-foreground placeholder:text-muted-foreground/60 text-base sm:text-[15px] resize-none focus:outline-none leading-relaxed"
        />

        {/* Composer Toolbar */}
        <div className="flex items-center justify-between px-3 py-2 text-muted-foreground">
          {/* Left tools: Attachment, Parameters, Model info */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="p-2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg hover:text-foreground hover:bg-muted transition-colors text-xs font-medium touch-manipulation"
              title="Attach File or Image"
              aria-label="Attach File"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <button
              onClick={() => setParamsOpen(!paramsOpen)}
              className={`p-2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg transition-colors touch-manipulation ${
                paramsOpen ? 'text-primary bg-primary/10' : 'hover:text-foreground hover:bg-muted'
              }`}
              title="Parameters & System Prompt"
              aria-label="Parameters"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>

            {/* Vision status badge */}
            {!supportsVision && (
              <span
                className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-muted-foreground/80 bg-muted/40"
                title="This model does not support image input"
              >
                <AlertTriangle className="w-3 h-3 text-amber-500/80" />
                <span>Text only</span>
              </span>
            )}
          </div>

          {/* Right tool: Send or Stop */}
          <div className="flex items-center gap-2">
            {isGenerating ? (
              <button
                onClick={stopGeneration}
                className="flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 font-medium text-xs transition-all shadow-xs active:scale-95 touch-manipulation"
                title="Hentikan pembuatan respon (Esc)"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Hentikan</span>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() && attachments.length === 0}
                className="flex items-center gap-1.5 min-h-[38px] px-4 py-1.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover disabled:opacity-30 disabled:pointer-events-none font-semibold text-xs transition-all shadow-xs active:scale-95 touch-manipulation"
                title="Kirim pesan (Enter)"
                aria-label="Kirim pesan"
              >
                <span>Kirim</span>
                <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Subtle keyboard hint */}
      <div className="text-center mt-1.5 text-[11px] text-muted-foreground/60 hidden sm:block">
        Press <kbd className="font-mono bg-muted/60 px-1 py-0.5 rounded text-[10px]">Enter</kbd> to send, <kbd className="font-mono bg-muted/60 px-1 py-0.5 rounded text-[10px]">Shift + Enter</kbd> for new line
      </div>
    </div>
  );
};
