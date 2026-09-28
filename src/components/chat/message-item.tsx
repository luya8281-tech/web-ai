'use client';

import React, { useState } from 'react';
import {
  Copy,
  Check,
  RotateCw,
  Edit2,
  Trash2,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { Message } from '@/types/chat';
import { MarkdownRenderer } from '../markdown/markdown-renderer';
import { useChatStore } from '@/stores/chat-store';
import { useUIStore } from '@/stores/ui-store';
import { copyToClipboard } from '@/lib/utils/clipboard';
import { LiveThinkingAccordion } from './live-thinking-accordion';
import { LiveActionCard } from './live-action-card';
import { cleanMessageContent, extractActionsFromText } from '@/lib/utils/clean-content';
import { ActionInfo } from '@/types/chat';

interface MessageItemProps {
  message: Message;
  isLastAssistant?: boolean;
}

export const MessageItem: React.FC<MessageItemProps> = React.memo(({ message, isLastAssistant }) => {
  const regenerateMessage = useChatStore((state) => state.regenerateMessage);
  const editMessage = useChatStore((state) => state.editMessage);
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const isGenerating = useChatStore((state) => state.isGenerating);
  
  const { addToast } = useUIStore();

  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);

  const isUser = message.role === 'user';

  const handleCopy = async () => {
    try {
      const cleanText = isUser ? message.content : cleanMessageContent(message.content, false);
      const ok = await copyToClipboard(cleanText || message.content);
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        addToast('Teks berhasil disalin', 'success');
      } else {
        addToast('Gagal menyalin teks', 'error');
      }
    } catch {
      addToast('Gagal menyalin teks', 'error');
    }
  };

  const handleSaveEdit = async () => {
    if (!editContent.trim()) return;
    await editMessage(message.id, editContent.trim());
    setIsEditing(false);
  };

  const actions: ActionInfo[] = (message.metadata?.actions && message.metadata.actions.length > 0)
    ? message.metadata.actions
    : extractActionsFromText(message.content);

  return (
    <div
      className={`w-full py-3 sm:py-4 px-3 sm:px-6 flex justify-center transition-colors ${
        isUser ? 'bg-transparent' : 'bg-transparent'
      }`}
    >
      <div className={`w-full max-w-3xl flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Attachments Preview */}
        {message.attachments && message.attachments.length > 0 && (
          <div className={`flex flex-wrap gap-2 mb-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {message.attachments.map((att) => (
              <div
                key={att.id}
                className="relative rounded-xl overflow-hidden border border-border bg-card shadow-xs max-w-xs"
              >
                {att.mimeType?.startsWith('image/') || att.url?.startsWith('data:image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={att.dataUrl || att.url}
                    alt={att.name}
                    className="max-h-60 max-w-full object-contain rounded-xl"
                  />
                ) : (
                  <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground truncate">{att.name}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {isEditing ? (
          <div className="w-full space-y-2">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full p-3 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[100px] resize-y"
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 text-xs rounded-md bg-muted hover:bg-muted/80 text-foreground transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
              >
                Simpan & Kirim
              </button>
            </div>
          </div>
        ) : (
          <div className={`group min-w-0 ${
            isUser 
              ? 'user-bubble max-w-[90%] sm:max-w-2xl bg-secondary/80 border border-border/60 px-4 py-3 sm:px-5 sm:py-3.5 rounded-2xl shadow-xs text-left' 
              : 'w-full text-left'
          }`}>
            {/* Reasoning Block (Collapsible Accordion) */}
            {!isUser && message.reasoningContent && (
              <LiveThinkingAccordion reasoning={message.reasoningContent} isLive={false} />
            )}

            {/* Persistent Historical Action Dropdown Cards */}
            {!isUser && actions.length > 0 && (
              <div className="flex flex-col gap-1.5 mb-2.5">
                {actions.map((act, idx) => (
                  <LiveActionCard key={act.id || idx} action={act} />
                ))}
              </div>
            )}

            {/* Message Content with Markdown & Syntax Highlighting */}
            <div className="text-foreground text-[15px] sm:text-[15.5px] leading-relaxed text-left break-words">
              <MarkdownRenderer content={isUser ? message.content : cleanMessageContent(message.content, false)} />
            </div>
          </div>
        )}

        {/* Timestamp */}
        {message.createdAt && !isEditing && (
          <div className={`flex items-center mt-1.5 text-[11px] text-muted-foreground transition-all duration-200 pt-1.5 border-t border-border/40 font-medium ${isUser ? 'justify-end pr-1' : 'justify-start pl-1'}`}>
            {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}

        {/* Action Toolbar */}
        {!isEditing && (
          <div className={`flex items-center gap-1.5 mt-1 text-muted-foreground transition-all duration-200 pt-1.5 border-t border-border/40 ${isUser ? 'justify-end pr-1' : 'justify-start pl-1'}`}>
            {isUser ? (
              <div className="flex items-center gap-1 opacity-100 transition-opacity">
                <button
                  onClick={handleCopy}
                  className="p-1 rounded hover:text-foreground hover:bg-muted/40 transition-colors"
                  title="Salin pesan"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-1 rounded hover:text-foreground hover:bg-muted/40 transition-colors"
                  title="Edit pesan"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => deleteMessage(message.id)}
                  className="p-1 rounded hover:text-foreground hover:bg-muted/40 transition-colors"
                  title="Hapus pesan"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={handleCopy}
                  className="p-1 rounded hover:text-foreground hover:bg-muted/40 transition-colors"
                  title="Salin tanggapan"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>

                <button
                  onClick={() => regenerateMessage(message.id)}
                  disabled={isGenerating}
                  className="p-1 rounded hover:text-foreground hover:bg-muted/40 disabled:opacity-30 transition-colors"
                  title="Buat ulang"
                >
                  <RotateCw className="w-4 h-4" />
                </button>

                <button
                  onClick={() => addToast('Feedback recorded', 'info')}
                  className="p-1 rounded hover:text-foreground hover:bg-muted/40 transition-colors"
                  title="Tanggapan bagus"
                >
                  <ThumbsUp className="w-4 h-4" />
                </button>

                <button
                  onClick={() => addToast('Feedback recorded', 'info')}
                  className="p-1 rounded hover:text-foreground hover:bg-muted/40 transition-colors"
                  title="Tanggapan kurang tepat"
                >
                  <ThumbsDown className="w-4 h-4" />
                </button>

                {/* Token stats */}
                {message.metadata?.tokenInput !== undefined && (
                  <span className="text-[10px] text-muted-foreground/50 ml-2">
                    {message.metadata.tokenInput} in / {message.metadata.tokenOutput} out
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

MessageItem.displayName = 'MessageItem';
