import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ProviderRepository } from '@/lib/db/repositories/provider-repo';

export const dynamic = 'force-dynamic';

const UpdateProviderSchema = z.object({
  name: z.string().optional(),
  baseUrl: z.string().url().optional(),
  protocol: z.enum(['openai-compatible', 'anthropic-compatible', 'mock']).optional(),
  apiKey: z.string().optional(),
  isDefault: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const parsed = UpdateProviderSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
    }

    const updated = ProviderRepository.updateProvider(params.id, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }

    return NextResponse.json({ provider: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const success = ProviderRepository.deleteProvider(params.id);
    if (!success) {
      return NextResponse.json({ error: 'Provider could not be deleted (may be system provider or not found)' }, { status: 400 });
    }
    return NextResponse.json({ success: true, message: 'Provider deleted' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
