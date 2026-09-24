import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { ProjectRepository } from '@/lib/db/repositories/project-repo';

export const dynamic = 'force-dynamic';

const CreateProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  defaultProviderId: z.string().optional(),
  defaultModelId: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const user = getCurrentUser(req);
    const projects = ProjectRepository.listProjects(user.id);
    return NextResponse.json({ projects });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getCurrentUser(req);
    const body = await req.json();
    const parsed = CreateProjectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
    }

    const id = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const project = ProjectRepository.createProject({
      id,
      userId: user.id,
      ...parsed.data,
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
