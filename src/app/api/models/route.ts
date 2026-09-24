import { NextRequest, NextResponse } from 'next/server';
import { ModelRegistry } from '@/lib/ai/registry';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const providerId = searchParams.get('providerId') || undefined;
    const refresh = searchParams.get('refresh') === 'true';

    if (refresh && providerId) {
      try {
        const discovered = await ModelRegistry.discoverAndSync(providerId);
        return NextResponse.json({ models: discovered, refreshed: true });
      } catch (err: any) {
        console.warn(`[Models] Refresh failed for ${providerId}:`, err.message);
      }
    }

    const models = ModelRegistry.getModels(providerId);
    return NextResponse.json({ models });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
