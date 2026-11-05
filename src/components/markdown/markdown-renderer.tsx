'use client';

import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './code-block';
import { ChevronRight, ExternalLink, Globe } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';

const ToolDropdown = ({ toolName, toolArg }: { toolName: string; toolArg: string }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (toolName !== 'CARI_WEB' && toolName !== 'BUKA_WEB') {
    return null;
  }

  const cleanArg = toolArg.trim().replace(/^["']|["']$/g, '');
  const displayText = cleanArg.length > 42 ? cleanArg.slice(0, 42) + '...' : cleanArg;
  const label = toolName === 'CARI_WEB' ? `Mencari "${displayText}"` : `Membuka "${displayText}"`;

  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground/80 hover:text-foreground transition-colors group cursor-pointer"
      >
        <Globe className="w-3.5 h-3.5 text-primary" />
        <span className="font-normal">{label}</span>
        <ChevronRight
          className={`w-3 h-3 opacity-40 transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
      </button>
      {isOpen && (
        <div className="mt-1 p-2 rounded-lg border border-border/40 bg-card/60 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all max-w-lg">
          {toolArg}
        </div>
      )}
    </div>
  );
};

const InteractiveSourceChip: React.FC<{
  href?: string;
  children: React.ReactNode;
}> = ({ href, children }) => {
  const [openPopover, setOpenPopover] = useState(false);
  const { setWorkspaceOpen } = useUIStore();

  if (!href || (!href.startsWith('http://') && !href.startsWith('https://'))) {
    return (
      <a href={href} className="text-primary hover:underline font-medium">
        {children}
      </a>
    );
  }

  let domain = 'web';
  try {
    domain = new URL(href).hostname.replace(/^www\./i, '');
  } catch {}

  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  const rawChildText = String(children || '').trim();
  // If child text is a raw URL, replace it with the clean domain name so no ugly hardcoded URLs appear
  const isRawUrl = /^https?:\/\//i.test(rawChildText);
  const displayLabel = isRawUrl ? domain : rawChildText.length > 38 ? rawChildText.slice(0, 38) + '…' : rawChildText;

  return (
    <span className="relative inline-block align-baseline mx-0.5">
      <button
        type="button"
        onClick={() => setOpenPopover(!openPopover)}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-secondary/80 hover:bg-muted hover:border-primary/50 text-[11.5px] font-sans font-medium text-foreground transition-colors align-baseline"
        title={`Sumber: ${domain} (Ketuk untuk melihat detail)`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={faviconUrl}
          alt={domain}
          className="w-3.5 h-3.5 rounded-xs object-contain shrink-0"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
        <span className="truncate max-w-[180px]">{displayLabel || domain}</span>
      </button>

      {openPopover && (
        <span className="absolute bottom-full left-0 mb-1.5 z-50 w-72 p-3 rounded-xl border border-border bg-card text-foreground shadow-xl font-sans block text-left">
          <span className="flex items-center justify-between gap-2 mb-1.5">
            <span className="flex items-center gap-1.5 min-w-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={faviconUrl}
                alt={domain}
                className="w-4 h-4 rounded-xs object-contain shrink-0"
              />
              <span className="text-xs font-semibold text-foreground truncate">{domain}</span>
            </span>
            <button
              type="button"
              onClick={() => setOpenPopover(false)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Tutup
            </button>
          </span>

          {!isRawUrl && (
            <span className="block text-xs font-medium text-foreground/90 mb-1 line-clamp-2">
              {rawChildText}
            </span>
          )}

          <span className="block text-[10px] font-mono text-muted-foreground truncate mb-2.5">
            {href}
          </span>

          <span className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setOpenPopover(false);
                setWorkspaceOpen(true, 'browser', {
                  type: 'BUKA_WEB',
                  label: displayLabel || domain,
                  status: 'done',
                  url: href,
                });
              }}
              className="px-2 py-1 rounded-md border border-border bg-secondary hover:bg-muted text-[11px] font-medium text-foreground inline-flex items-center gap-1"
            >
              <Globe className="w-3 h-3 text-primary" />
              <span>Web Aktif</span>
            </button>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpenPopover(false)}
              className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary-hover text-[11px] font-semibold inline-flex items-center gap-1"
            >
              <span>Buka Sumber</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </span>
        </span>
      )}
    </span>
  );
};

interface MarkdownRendererProps {
  content: string;
  showLineNumbers?: boolean;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = React.memo(
  ({ content, showLineNumbers = true }) => {
    const sanitizedContent = useMemo(() => {
      if (!content) return '';
      return content.replace(/\[\/?BALASAN_AKHIR\]/gi, '');
    }, [content]);

    return (
      <div className="prose prose-neutral dark:prose-invert max-w-none break-words text-[15px] leading-[1.65] text-foreground">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const isInline = !match && !String(children).includes('\n');

              if (isInline) {
                return (
                  <code
                    className="px-1.5 py-0.5 rounded bg-muted/80 text-foreground font-mono text-[13px] border border-border/50"
                    {...props}
                  >
                    {children}
                  </code>
                );
              }

              const language = match ? match[1] : 'text';
              const value = String(children).replace(/\n$/, '');

              if (language === 'tool') {
                const lines = value.split('\n');
                const toolName = lines[0] || 'UNKNOWN_TOOL';
                const toolArg = lines.slice(1).join('\n') || '...';

                return <ToolDropdown toolName={toolName} toolArg={toolArg} />;
              }

              return (
                <CodeBlock
                  language={language}
                  value={value}
                  showLineNumbers={showLineNumbers}
                />
              );
            },
            table({ children }) {
              return (
                <div className="my-4 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-left text-sm border-collapse divide-y divide-border">
                    {children}
                  </table>
                </div>
              );
            },
            thead({ children }) {
              return <thead className="bg-muted/60 text-foreground font-semibold">{children}</thead>;
            },
            th({ children }) {
              return <th className="px-4 py-2.5 text-xs uppercase tracking-wider">{children}</th>;
            },
            td({ children }) {
              return <td className="px-4 py-2.5 text-sm border-t border-border/40">{children}</td>;
            },
            tr({ children }) {
              return <tr className="hover:bg-muted/30 transition-colors">{children}</tr>;
            },
            blockquote({ children }) {
              return (
                <blockquote className="my-3 border-l-4 border-primary/50 pl-4 py-0.5 italic text-muted-foreground bg-muted/20 rounded-r">
                  {children}
                </blockquote>
              );
            },
            a({ href, children }) {
              return <InteractiveSourceChip href={href}>{children}</InteractiveSourceChip>;
            },
            ul({ children }) {
              return <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>;
            },
            ol({ children }) {
              return <ol className="list-decimal pl-5 my-1 space-y-0.5">{children}</ol>;
            },
            li({ children }) {
              return <li className="pl-0.5 my-1 leading-[1.65] text-foreground">{children}</li>;
            },
            h1({ children }) {
              return (
                <h1 className="text-xl font-semibold tracking-tight !mt-4 !mb-2 text-foreground">
                  {children}
                </h1>
              );
            },
            h2({ children }) {
              return (
                <h2 className="text-lg font-semibold tracking-tight !mt-3.5 !mb-1.5 text-foreground">
                  {children}
                </h2>
              );
            },
            h3({ children }) {
              return (
                <h3 className="text-base font-semibold tracking-tight !mt-3 !mb-1 text-foreground">
                  {children}
                </h3>
              );
            },
            p({ children }) {
              return (
                <p className="!mt-0 !mb-3 last:!mb-0 leading-[1.65] text-foreground">{children}</p>
              );
            },
          }}
        >
          {sanitizedContent}
        </ReactMarkdown>
      </div>
    );
  }
);

MarkdownRenderer.displayName = 'MarkdownRenderer';
