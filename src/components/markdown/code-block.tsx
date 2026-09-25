'use client';

import React, { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { copyToClipboard } from '@/lib/utils/clipboard';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-markdown';

interface CodeBlockProps {
  language?: string;
  value: string;
  showLineNumbers?: boolean;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  language = 'text',
  value,
  showLineNumbers = true,
}) => {
  const [copied, setCopied] = useState(false);

  const cleanLanguage = language ? language.replace(/^language-/, '').toLowerCase() : 'text';

  const handleCopy = async () => {
    try {
      const ok = await copyToClipboard(value);
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (e) {
      console.error('Failed to copy', e);
    }
  };

  const handleDownload = () => {
    const extMap: Record<string, string> = {
      javascript: 'js',
      typescript: 'ts',
      python: 'py',
      bash: 'sh',
      shell: 'sh',
      json: 'json',
      css: 'css',
      sql: 'sql',
      html: 'html',
      markdown: 'md',
    };
    const ext = extMap[cleanLanguage] || 'txt';
    const blob = new Blob([value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `code_${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Syntax highlight
  let highlightedHtml = value;
  try {
    const grammar = Prism.languages[cleanLanguage] || Prism.languages.javascript;
    if (grammar) {
      highlightedHtml = Prism.highlight(value, grammar, cleanLanguage);
    }
  } catch (e) {
    highlightedHtml = value;
  }

  const lines = value.split('\n');

  return (
    <div className="relative my-4 rounded-lg overflow-hidden border border-border bg-[#18181b] text-zinc-100 font-mono text-[13px] shadow-sm">
      {/* Code Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#202024] border-b border-border text-xs text-zinc-400">
        <span className="font-medium tracking-wide uppercase text-zinc-300">
          {cleanLanguage}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-zinc-700/60 hover:text-white transition-colors text-xs"
            title="Copy code"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded hover:bg-zinc-700/60 hover:text-white transition-colors text-xs"
            title="Download file"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>
        </div>
      </div>

      {/* Code Body */}
      <div className="overflow-x-auto p-4 flex">
        {showLineNumbers && (
          <div className="select-none pr-4 text-right text-zinc-600 font-mono text-[13px] border-r border-zinc-800">
            {lines.map((_, i) => (
              <div key={i} className="leading-6">
                {i + 1}
              </div>
            ))}
          </div>
        )}
        <pre className="pl-4 flex-1 overflow-x-auto leading-6 font-mono text-[13px] text-zinc-200">
          <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        </pre>
      </div>
    </div>
  );
};
