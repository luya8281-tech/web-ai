import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ProviderRepository } from '@/lib/db/repositories/provider-repo';
import { ModelRegistry } from '@/lib/ai/registry';

export const dynamic = 'force-dynamic';

const CreateProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  protocol: z.enum(['openai-compatible', 'anthropic-compatible', 'mock']).default('openai-compatible'),
  apiKey: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export async function GET() {
  try {
    const providers = ProviderRepository.listProviders();
    return NextResponse.json({ providers });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateProviderSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
    }

    const provider = ProviderRepository.createProvider(parsed.data);

    // Auto-discover models upon provider creation
    try {
      await ModelRegistry.discoverAndSync(provider.id);
    } catch (e: any) {
      console.warn(`[Provider] Initial model discovery warning for ${provider.id}:`, e.message);
    }

    return NextResponse.json({ provider, message: 'Provider created successfully' }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
