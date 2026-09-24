import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { ConversationRepository } from '@/lib/db/repositories/conversation-repo';

export const dynamic = 'force-dynamic';

const CreateConvSchema = z.object({
  title: z.string().optional(),
  providerId: z.string(),
  modelId: z.string(),
  projectId: z.string().nullable().optional(),
  systemPrompt: z.string().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  maxTokens: z.number().optional(),
  reasoningEffort: z.string().optional(),
  temporary: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const user = getCurrentUser(req);
    const { searchParams } = new URL(req.url);

    const search = searchParams.get('search') || undefined;
    const projectId = searchParams.get('projectId');
    const archived = searchParams.has('archived') ? searchParams.get('archived') === 'true' : false;
    const pinned = searchParams.has('pinned') ? searchParams.get('pinned') === 'true' : undefined;
    const limit = searchParams.has('limit') ? parseInt(searchParams.get('limit')!, 10) : 50;
    const offset = searchParams.has('offset') ? parseInt(searchParams.get('offset')!, 10) : 0;

    const result = ConversationRepository.listConversations({
      userId: user.id,
      projectId: projectId !== null ? projectId : undefined,
      search,
      archived,
      pinned,
      limit,
      offset,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getCurrentUser(req);
    const body = await req.json();
    const parsed = CreateConvSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data', details: parsed.error.format() }, { status: 400 });
    }

    const id = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const conversation = ConversationRepository.createConversation({
      id,
      userId: user.id,
      ...parsed.data,
    });

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
