import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MessageRepository } from '@/lib/db/repositories/message-repo';

export const dynamic = 'force-dynamic';

const MessageCreateSchema = z.object({
  id: z.string().optional(),
  conversationId: z.string(),
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  reasoningContent: z.string().nullable().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  attachments: z.array(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = MessageCreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
    }

    const id = parsed.data.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const msg = MessageRepository.createMessage({
      ...parsed.data,
      id,
    });

    return NextResponse.json({ message: msg }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
