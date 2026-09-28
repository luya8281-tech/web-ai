'use client';

import React, { useMemo } from 'react';
import { ActionInfo } from '@/types/chat';
import { MarkdownRenderer } from '../markdown/markdown-renderer';
import { LiveActionCard } from './live-action-card';

const TOOL_NAMES = 'CARI_WEB|BUKA_WEB|SCREENSHOT_WEB|RUN_BASH|BACA_SKILL|RUN_PYTHON|INSTALL_SKILL|SIMPAN_MEMORI|RINGKAS_YOUTUBE|BUAT_PDF|BACA_OCR';
const ACTION_TAG_REGEX = new RegExp(`\\[(${TOOL_NAMES}):\\s*([\\s\\S]*?)(?:\\]|(?=\\s*\\[(?:${TOOL_NAMES}):)|$)`, 'gi');

function cleanMarkdownText(text: string, isLive = false): string {
  let cleaned = text
    .replace(/\[\/?BALASAN_AKHIR\]/gi, '')
    .replace(new RegExp(`\\[(?:${TOOL_NAMES}):[\\s\\S]*?(?:\\]|(?=\\s*\\[(?:${TOOL_NAMES}):)|$)`, 'gi'), '')
    .replace(/\[TOOL RESULTS\]:[\s\S]*?(?=\n\n|\n[A-Z]|$)/gi, '')
    .replace(/(?:TOOL OUTPUT|BASH OUTPUT|SKILL CONTENT|PYTHON OUTPUT):?[\s\S]*?(?=\n\n|$)/gi, '')
    .replace(/\*⚡ Executing tools\.\.\.\*/gi, '')
    .replace(/\n{3,}/g, '\n\n');

  if (isLive) {
    // Hide trailing partial tag during live streaming (e.g. "[RUN_BASH" or "[CARI_")
    cleaned = cleaned.replace(/\s*\[\/?(?:BALASAN_AKHIR|RUN_BASH|RUN_PYTHON|CARI_WEB|BUKA_WEB|BACA_SKILL|[A-Z_]+)[^\]]*$/i, '');
  }

  return cleaned.trim();
}

function getActionLabel(type: string, param: string): string {
  const t = (type || '').toUpperCase();
  const cleanParam = param.trim();
  const firstLine = cleanParam.split('\n')[0].trim();
  if (t === 'BUKA_WEB') return `Membuka halaman web: ${firstLine.substring(0, 50)}`;
  if (t === 'SCREENSHOT_WEB') return `Tangkapan layar: ${firstLine.substring(0, 50)}`;
  if (t === 'CARI_WEB') return `Mencari informasi: "${firstLine.substring(0, 45)}"`;
  if (t === 'RUN_BASH') return `Perintah server: ${firstLine.substring(0, 45)}`;
  if (t === 'RUN_PYTHON') return `Analisis Python: ${firstLine.substring(0, 45)}`;
  if (t === 'BACA_SKILL') return `Membaca skill: ${firstLine}`;
  if (t === 'INSTALL_SKILL') return `Menginstal skill: ${firstLine}`;
  return `Aksi sistem: ${firstLine || t}`;
}

interface ActionContentRendererProps {
  content: string;
  actions?: ActionInfo[];
  isLive?: boolean;
}

export const ActionContentRenderer: React.FC<ActionContentRendererProps> = ({
  content,
  actions = [],
  isLive = false,
}) => {
  const renderedElements = useMemo(() => {
    if (!content) return [];

    const elements: React.ReactNode[] = [];
    const usedActionIds = new Set<string>();
    let actionCursor = 0;
    let lastIndex = 0;

    // Reset regex index
    ACTION_TAG_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = ACTION_TAG_REGEX.exec(content)) !== null) {
      const matchIndex = match.index;
      const fullMatch = match[0];
      const actionType = match[1].toUpperCase();
      const actionParam = match[2].trim();

      // 1. Text segment before this action
      const textBefore = content.substring(lastIndex, matchIndex);
      const cleanedBefore = cleanMarkdownText(textBefore, isLive);
      if (cleanedBefore) {
        elements.push(
          <div key={`text_${lastIndex}`} className="text-foreground text-[15px] sm:text-[15.5px] leading-relaxed text-left break-words my-1">
            <MarkdownRenderer content={cleanedBefore} />
          </div>
        );
      }

      // 2. Resolve matching action
      let matchedAction: ActionInfo | undefined;

      // Try matching by type and matching detail
      for (const act of actions) {
        if (!usedActionIds.has(act.id || '') && act.type.toUpperCase() === actionType) {
          matchedAction = act;
          break;
        }
      }

      // If not matched, try matching by sequential index
      if (!matchedAction && actionCursor < actions.length) {
        const candidate = actions[actionCursor];
        if (!usedActionIds.has(candidate.id || '')) {
          matchedAction = candidate;
        }
      }

      if (matchedAction) {
        usedActionIds.add(matchedAction.id || '');
        actionCursor++;
      } else {
        // Synthesize action from tag
        const isRunning = isLive && matchIndex + fullMatch.length >= content.length - 20;
        matchedAction = {
          id: `tag_act_${matchIndex}`,
          type: actionType,
          label: getActionLabel(actionType, actionParam),
          status: isRunning ? 'running' : 'done',
          details: actionParam,
        };
      }

      // 3. Render Live Action Card inline at this exact spot!
      elements.push(
        <div key={`action_${matchedAction.id || matchIndex}`} className="my-2.5">
          <LiveActionCard action={matchedAction} />
        </div>
      );

      lastIndex = matchIndex + fullMatch.length;
    }

    // 4. Trailing text after the last action
    const textAfter = content.substring(lastIndex);
    const cleanedAfter = cleanMarkdownText(textAfter, isLive);
    if (cleanedAfter) {
      elements.push(
        <div key={`text_end_${lastIndex}`} className="text-foreground text-[15px] sm:text-[15.5px] leading-relaxed text-left break-words my-1">
          <MarkdownRenderer content={cleanedAfter} />
        </div>
      );
    }

    // 5. If there are any remaining running actions during live streaming, render them at the current bottom
    const remainingActions = actions.filter((act) => !usedActionIds.has(act.id || ''));
    if (remainingActions.length > 0) {
      elements.push(
        <div key="remaining_actions" className="flex flex-col gap-1.5 my-2.5">
          {remainingActions.map((act, idx) => (
            <LiveActionCard key={act.id || `remain_${idx}`} action={act} />
          ))}
        </div>
      );
    }

    return elements;
  }, [content, actions, isLive]);

  if (!content && actions.length === 0) return null;

  return <div className="space-y-1">{renderedElements}</div>;
};
