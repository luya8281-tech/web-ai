import { NextRequest, NextResponse } from 'next/server';
import { MessageRepository } from '@/lib/db/repositories/message-repo';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { conversationId, newContent } = await req.json();

    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
    }

    // 1. Truncate all messages after this message
    const deletedCount = MessageRepository.truncateAfterMessage(conversationId, params.id);

    // 2. If new content is provided, update the message itself
    if (newContent !== undefined) {
      MessageRepository.updateMessage(params.id, { content: newContent });
    }

    return NextResponse.json({
      success: true,
      messageId: params.id,
      truncatedCount: deletedCount,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
