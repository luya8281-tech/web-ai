'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './code-block';
import { ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';

const ToolDropdown = ({ toolName, toolArg }: { toolName: string, toolArg: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  // Only display web search line like Claude, hide all other backend tools completely
  if (toolName !== 'CARI_WEB' && toolName !== 'BUKA_WEB') {
    return null;
  }

  const cleanArg = toolArg.trim().replace(/^["']|["']$/g, '');
  const displayText = cleanArg.length > 34 ? cleanArg.slice(0, 34) + '...' : cleanArg;
  const label = toolName === 'CARI_WEB' ? `Mencari "${displayText}"` : `Membuka "${displayText}"`;

  return (
    <div className="my-2">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground/80 hover:text-foreground transition-colors group cursor-pointer"
      >
        <span className="text-xs opacity-75">🌐</span>
        <span className="font-normal">{label}</span>
        <ChevronRight className={`w-3 h-3 opacity-40 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>
      {isOpen && (
        <div className="mt-1 p-2 rounded-lg border border-border/40 bg-card/60 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all max-w-lg">
          {toolArg}
        </div>
      )}
    </div>
  );
};

interface MarkdownRendererProps {
  content: string;
  showLineNumbers?: boolean;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = React.memo(({
  content,
  showLineNumbers = true,
}) => {
  return (
    <div className="prose prose-neutral dark:prose-invert max-w-none break-words text-[15.5px] leading-[1.65] text-foreground font-sans">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const isInline = !match && !String(children).includes('\n');

            if (isInline) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded bg-muted/80 text-foreground font-mono text-[13.5px] border border-border/50"
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
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline font-medium inline-flex items-center gap-0.5"
              >
                {children}
              </a>
            );
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
            return <h1 className="text-xl font-semibold tracking-tight !mt-4 !mb-2 text-foreground">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-lg font-semibold tracking-tight !mt-3.5 !mb-1.5 text-foreground">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-base font-semibold tracking-tight !mt-3 !mb-1 text-foreground">{children}</h3>;
          },
          p({ children }) {
            return <p className="!mt-0 !mb-3 last:!mb-0 leading-[1.65] text-foreground">{children}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

MarkdownRenderer.displayName = 'MarkdownRenderer';
