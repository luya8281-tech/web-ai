import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { ConversationRepository } from '@/lib/db/repositories/conversation-repo';
import { MessageRepository } from '@/lib/db/repositories/message-repo';
import { ProviderRepository } from '@/lib/db/repositories/provider-repo';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = getCurrentUser(req);
    const body = await req.json();

    let title = 'Imported Conversation';
    let messages: Array<{ role: string; content: string; reasoningContent?: string }> = [];
    let providerId = 'xkiro';
    let modelId = 'qwen/qwen3.7-plus:free';

    // Verify existing default model
    const defaultProvider = ProviderRepository.listProviders().find(p => p.isDefault) || ProviderRepository.listProviders()[0];
    if (defaultProvider) {
      providerId = defaultProvider.id;
      const models = ProviderRepository.listModels(defaultProvider.id);
      if (models.length > 0) modelId = models[0].modelId;
    }

    if (body.title) title = String(body.title).substring(0, 100);
    if (body.provider) providerId = body.provider;
    if (body.model) modelId = body.model;

    if (Array.isArray(body.messages)) {
      messages = body.messages
        .filter((m: any) => m && typeof m.content === 'string')
        .map((m: any) => ({
          role: ['user', 'assistant', 'system'].includes(m.role) ? m.role : 'user',
          content: m.content,
          reasoningContent: m.reasoningContent || undefined,
        }));
    } else if (typeof body.rawText === 'string') {
      // Basic raw markdown / text import
      messages = [
        { role: 'user', content: body.rawText },
      ];
    }

    if (messages.length === 0) {
      return NextResponse.json({ error: 'No valid messages found in imported data' }, { status: 400 });
    }

    const convId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const conv = ConversationRepository.createConversation({
      id: convId,
      userId: user.id,
      title,
      providerId,
      modelId,
    });

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      MessageRepository.createMessage({
        id: `msg_${Date.now() + i}_${Math.random().toString(36).substring(2, 8)}`,
        conversationId: convId,
        role: msg.role,
        content: msg.content,
        reasoningContent: msg.reasoningContent,
        model: modelId,
        provider: providerId,
      });
    }

    return NextResponse.json({
      success: true,
      conversationId: convId,
      conversation: ConversationRepository.getConversation(convId),
      messageCount: messages.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
