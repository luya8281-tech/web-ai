import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MessageRepository } from '@/lib/db/repositories/message-repo';

export const dynamic = 'force-dynamic';

const MessageUpdateSchema = z.object({
  content: z.string().optional(),
  reasoningContent: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const parsed = MessageUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
    }

    const updated = MessageRepository.updateMessage(params.id, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    return NextResponse.json({ message: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ok = MessageRepository.deleteMessage(params.id);
    if (!ok) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: 'Message deleted' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
