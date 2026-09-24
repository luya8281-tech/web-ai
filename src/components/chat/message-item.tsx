'use client';

import React, { useState } from 'react';
import {
  Copy,
  Check,
  RotateCw,
  Edit2,
  Trash2,
  Brain,
  ChevronDown,
  ChevronUp,
  FileText,
  Clock,
  Sparkles,
} from 'lucide-react';
import { Message } from '@/types/chat';
import { MarkdownRenderer } from '../markdown/markdown-renderer';
import { useChatStore } from '@/stores/chat-store';
import { useUIStore } from '@/stores/ui-store';

interface MessageItemProps {
  message: Message;
  isLastAssistant?: boolean;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message, isLastAssistant }) => {
  const { regenerateMessage, editMessage, deleteMessage, isGenerating } = useChatStore();
  const { addToast } = useUIStore();

  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [reasoningOpen, setReasoningOpen] = useState(false);

  const isUser = message.role === 'user';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      addToast('Copied to clipboard', 'info');
    } catch (e) {
      addToast('Failed to copy', 'error');
    }
  };

  const handleSaveEdit = async () => {
    if (!editContent.trim()) return;
    setIsEditing(false);
    await editMessage(message.id, editContent.trim());
  };

  return (
    <div
      className={`group w-full py-4 sm:py-6 px-3 sm:px-6 transition-colors ${
        isUser ? 'bg-transparent' : 'bg-muted/15 border-y border-border/30'
      }`}
    >
      <div className="max-w-3xl mx-auto flex gap-3 sm:gap-4">
        {/* Avatar */}
        <div className="shrink-0 pt-0.5">
          {isUser ? (
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-xs shadow-sm">
              V
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-semibold text-xs shadow-sm">
              <Sparkles className="w-4 h-4" />
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between mb-1.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">
                {isUser ? 'You' : message.model || 'Assistant'}
              </span>
              {message.provider && !isUser && (
                <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground uppercase font-medium">
                  {message.provider}
                </span>
              )}
            </div>
            {message.createdAt && (
              <span className="text-[11px] opacity-70">
                {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>

          {/* User Attachments (if any) */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {message.attachments.map((att, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-card text-xs font-medium text-foreground max-w-xs truncate"
                >
                  {att.mimeType?.startsWith('image/') || att.url?.match(/\.(png|jpg|jpeg|webp)$/i) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={att.url} alt={att.name} className="w-7 h-7 object-cover rounded" />
                  ) : (
                    <FileText className="w-4 h-4 text-primary shrink-0" />
                  )}
                  <span className="truncate">{att.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {(att.size / 1024).toFixed(0)}KB
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* User Message Edit Mode */}
          {isUser && isEditing ? (
            <div className="mt-2 space-y-2">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full p-3 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary min-h-[90px] resize-y"
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary-hover transition-colors"
                >
                  Save & Submit
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Reasoning Block (if present) */}
              {!isUser && message.reasoningContent && (
                <div className="my-2.5 rounded-lg border border-purple-500/20 bg-purple-950/10 text-xs">
                  <button
                    onClick={() => setReasoningOpen(!reasoningOpen)}
                    className="w-full flex items-center justify-between px-3 py-2 text-purple-400 hover:text-purple-300 transition-colors font-medium"
                  >
                    <div className="flex items-center gap-1.5">
                      <Brain className="w-3.5 h-3.5" />
                      <span>Thinking Process</span>
                    </div>
                    {reasoningOpen ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                  {reasoningOpen && (
                    <div className="px-3 pb-3 text-muted-foreground border-t border-purple-500/10 whitespace-pre-wrap font-mono text-[12px] leading-relaxed max-h-60 overflow-y-auto">
                      {message.reasoningContent}
                    </div>
                  )}
                </div>
              )}

              {/* Message Content */}
              <div className="text-foreground">
                <MarkdownRenderer content={message.content} />
              </div>
            </>
          )}

          {/* Action Toolbar */}
          {!isEditing && (
            <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground text-xs">
              <button
                onClick={handleCopy}
                className="p-1 rounded hover:text-foreground hover:bg-muted transition-colors"
                title="Copy message"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>

              {isUser ? (
                <>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="p-1 rounded hover:text-foreground hover:bg-muted transition-colors"
                    title="Edit message"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteMessage(message.id)}
                    className="p-1 rounded hover:text-destructive hover:bg-muted transition-colors"
                    title="Delete message"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => regenerateMessage(message.id)}
                    disabled={isGenerating}
                    className="p-1 rounded hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                    title="Regenerate response"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>

                  {/* Token stats badge */}
                  {message.metadata?.tokenInput !== undefined && (
                    <span className="text-[10px] text-muted-foreground/70 ml-2">
                      {message.metadata.tokenInput} in / {message.metadata.tokenOutput} out
                      {message.metadata.latencyMs ? ` · ${(message.metadata.latencyMs / 1000).toFixed(1)}s` : ''}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
