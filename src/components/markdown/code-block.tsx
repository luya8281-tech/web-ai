'use client';

import React, { useState } from 'react';
import { Check, Copy, Download, Play, Eye, Code2 } from 'lucide-react';
import { copyToClipboard } from '@/lib/utils/clipboard';
import { useUIStore } from '@/stores/ui-store';
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

const CLI_LANGUAGES = new Set(['bash', 'sh', 'shell', 'zsh', 'console']);
const PREVIEW_LANGUAGES = new Set(['html', 'svg', 'xml']);

export const CodeBlock: React.FC<CodeBlockProps> = ({
  language = 'text',
  value,
  showLineNumbers = true,
}) => {
  const [copied, setCopied] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const { runInWorkspaceCli } = useUIStore();

  const cleanLanguage = language ? language.replace(/^language-/, '').toLowerCase() : 'text';
  const isRunnableCli = CLI_LANGUAGES.has(cleanLanguage) && value.trim().length > 0;
  const isPreviewableHtml =
    (PREVIEW_LANGUAGES.has(cleanLanguage) ||
      (cleanLanguage === 'text' && /^\s*(<!doctype html|<html|<svg)/i.test(value))) &&
    value.trim().length > 0;

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

  const handleRunInCli = () => {
    const cleanCmd = value
      .split('\n')
      .map((line) => line.replace(/^\s*\$\s+/, ''))
      .filter((line) => line.trim() && !line.trim().startsWith('#'))
      .join(' && ');
    runInWorkspaceCli(cleanCmd || value.trim());
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
      svg: 'svg',
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
  } catch {
    highlightedHtml = value;
  }

  const lines = value.split('\n');

  return (
    <div className="relative my-3.5 rounded-xl overflow-hidden border border-border bg-[#161619] text-zinc-100 font-mono text-[13px] shadow-xs">
      {/* Code Header */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#1f1f24] border-b border-border/80 text-xs text-zinc-400 font-sans">
        <span className="font-mono text-[11px] font-semibold tracking-wider uppercase text-zinc-300">
          {cleanLanguage}
        </span>

        <div className="flex items-center gap-1">
          {isRunnableCli && (
            <button
              type="button"
              onClick={handleRunInCli}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 transition-colors text-[11px] font-medium"
              title="Jalankan perintah ini langsung di panel Terminal CLI di bawah chat"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Jalankan di CLI</span>
            </button>
          )}

          {isPreviewableHtml && (
            <button
              type="button"
              onClick={() => setPreviewMode(!previewMode)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-colors text-[11px] font-medium ${
                previewMode
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700'
              }`}
              title="Beralih antara Pratinjau Visual Live dan Kode Sumber"
            >
              {previewMode ? (
                <>
                  <Code2 className="w-3 h-3" />
                  <span>Kode</span>
                </>
              ) : (
                <>
                  <Eye className="w-3 h-3 text-primary" />
                  <span>Pratinjau Live</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-700/60 hover:text-white transition-colors text-[11px]"
            title="Salin kode"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-primary" />
                <span className="text-primary font-medium">Tersalin</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Salin</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md hover:bg-zinc-700/60 hover:text-white transition-colors text-[11px]"
            title="Unduh berkas kode"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Unduh</span>
          </button>
        </div>
      </div>

      {/* Live HTML / SVG Artifact Preview or Code Body */}
      {previewMode && isPreviewableHtml ? (
        <div className="bg-white text-black w-full">
          <iframe
            srcDoc={value}
            title="Pratinjau Live HTML/SVG"
            className="w-full h-[320px] border-0"
            sandbox="allow-scripts"
          />
        </div>
      ) : (
        <div className="overflow-x-auto p-3.5 flex">
          {showLineNumbers && (
            <div className="select-none pr-3.5 text-right text-zinc-600 font-mono text-[12.5px] border-r border-zinc-800">
              {lines.map((_, i) => (
                <div key={i} className="leading-6">
                  {i + 1}
                </div>
              ))}
            </div>
          )}
          <pre className="pl-3.5 flex-1 overflow-x-auto leading-6 font-mono text-[12.5px] text-zinc-200">
            <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
          </pre>
        </div>
      )}
    </div>
  );
};
