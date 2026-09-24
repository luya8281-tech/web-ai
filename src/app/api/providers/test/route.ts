import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AIRouter } from '@/lib/ai/router';
import { OpenAICompatibleAdapter } from '@/lib/ai/adapters/openai-adapter';
import { AnthropicAdapter } from '@/lib/ai/adapters/anthropic-adapter';
import { MockDevAdapter } from '@/lib/ai/adapters/mock-adapter';
import { AntigravityAgentAdapter } from '@/lib/ai/adapters/antigravity-adapter';
import { ProviderRepository } from '@/lib/db/repositories/provider-repo';

export const dynamic = 'force-dynamic';

const TestSchema = z.object({
  providerId: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  protocol: z.enum(['openai-compatible', 'anthropic-compatible', 'mock', 'antigravity-agent']).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = TestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.format() }, { status: 400 });
    }

    const { providerId, baseUrl, apiKey, protocol } = parsed.data;

    let adapter: any;

    if (baseUrl) {
      // Test dynamic ad-hoc configuration
      const effectiveProtocol = protocol || 'openai-compatible';
      if (effectiveProtocol === 'antigravity-agent') {
        adapter = new AntigravityAgentAdapter();
      } else if (effectiveProtocol === 'anthropic-compatible') {
        adapter = new AnthropicAdapter({ id: 'test', name: 'Test', baseUrl, apiKey });
      } else if (effectiveProtocol === 'mock') {
        adapter = new MockDevAdapter();
      } else {
        adapter = new OpenAICompatibleAdapter({ id: 'test', name: 'Test', baseUrl, apiKey });
      }
    } else if (providerId) {
      // Test existing provider
      adapter = AIRouter.getProviderInstance(providerId);
    } else {
      return NextResponse.json({ error: 'Either providerId or baseUrl is required' }, { status: 400 });
    }

    const result = await adapter.testConnection();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      message: `Connection test error: ${err.message || 'Unknown error'}`,
    }, { status: 200 }); // Return 200 with ok: false so frontend displays the nice error UI
  }
}
