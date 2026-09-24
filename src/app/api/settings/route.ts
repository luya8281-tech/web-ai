import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { SettingsRepository } from '@/lib/db/repositories/settings-repo';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = getCurrentUser(req);
    const settings = SettingsRepository.getUserSettings(user.id);
    return NextResponse.json({ settings });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = getCurrentUser(req);
    const body = await req.json();
    const updated = SettingsRepository.updateUserSettings(user.id, body);
    return NextResponse.json({ settings: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
