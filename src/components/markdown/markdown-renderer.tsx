'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './code-block';

interface MarkdownRendererProps {
  content: string;
  showLineNumbers?: boolean;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  showLineNumbers = true,
}) => {
  return (
    <div className="prose prose-zinc dark:prose-invert max-w-none break-words text-[15px] leading-7">
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

            return (
              <CodeBlock
                language={match ? match[1] : 'text'}
                value={String(children).replace(/\n$/, '')}
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
            return <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>;
          },
          h1({ children }) {
            return <h1 className="text-2xl font-bold tracking-tight mt-6 mb-3 text-foreground">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-xl font-bold tracking-tight mt-5 mb-2.5 text-foreground">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-lg font-semibold mt-4 mb-2 text-foreground">{children}</h3>;
          },
          p({ children }) {
            return <p className="my-2.5 leading-relaxed">{children}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
