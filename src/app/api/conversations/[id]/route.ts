import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ConversationRepository } from '@/lib/db/repositories/conversation-repo';
import { MessageRepository } from '@/lib/db/repositories/message-repo';

export const dynamic = 'force-dynamic';

const UpdateConvSchema = z.object({
  title: z.string().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  temporary: z.boolean().optional(),
  systemPrompt: z.string().nullable().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  maxTokens: z.number().nullable().optional(),
  reasoningEffort: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const conversation = ConversationRepository.getConversation(params.id);
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const messages = MessageRepository.listMessages(params.id);

    return NextResponse.json({
      conversation: {
        ...conversation,
        messages,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const parsed = UpdateConvSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
    }

    const updated = ConversationRepository.updateConversation(params.id, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    return NextResponse.json({ conversation: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const success = ConversationRepository.deleteConversation(params.id);
    if (!success) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: 'Conversation deleted' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
