import { NextRequest, NextResponse } from 'next/server';
import { ConversationRepository } from '@/lib/db/repositories/conversation-repo';
import { MessageRepository } from '@/lib/db/repositories/message-repo';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { format = 'markdown' } = await req.json().catch(() => ({}));
    const conv = ConversationRepository.getConversation(params.id);
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const messages = MessageRepository.listMessages(params.id);

    if (format === 'json') {
      const exportData = {
        title: conv.title,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        provider: conv.providerId,
        model: conv.modelId,
        systemPrompt: conv.systemPrompt,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          reasoningContent: m.reasoningContent,
          model: m.model,
          createdAt: m.createdAt,
        })),
      };

      return new Response(JSON.stringify(exportData, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(conv.title)}.json"`,
        },
      });
    }

    if (format === 'txt') {
      let text = `Conversation: ${conv.title}\nDate: ${conv.createdAt}\nModel: ${conv.modelId} (${conv.providerId})\n\n`;
      text += '==================================================\n\n';
      for (const m of messages) {
        text += `[${m.role.toUpperCase()}] (${m.createdAt}):\n${m.content}\n\n--------------------------------------------------\n\n`;
      }
      return new Response(text, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(conv.title)}.txt"`,
        },
      });
    }

    // Default: Markdown
    let md = `# ${conv.title}\n\n`;
    md += `- **Date:** ${new Date(conv.createdAt).toLocaleString()}\n`;
    md += `- **Model:** \`${conv.modelId}\` (${conv.providerId})\n\n---\n\n`;

    for (const m of messages) {
      const roleName = m.role === 'user' ? '🧑 User' : m.role === 'assistant' ? '🤖 Assistant' : '⚙️ System';
      md += `### ${roleName}\n\n`;
      if (m.reasoningContent) {
        md += `<details>\n<summary>Thinking Process</summary>\n\n${m.reasoningContent}\n\n</details>\n\n`;
      }
      md += `${m.content}\n\n`;
    }

    return new Response(md, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(conv.title)}.md"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
