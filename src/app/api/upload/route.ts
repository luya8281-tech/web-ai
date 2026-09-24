import { NextRequest, NextResponse } from 'next/server';
import { FileProcessor } from '@/lib/files/file-processor';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided in form data' }, { status: 400 });
    }

    const processed = await FileProcessor.processUploadedFile(file);
    return NextResponse.json({ file: processed }, { status: 201 });
  } catch (err: any) {
    console.error('[Upload Error]', err);
    return NextResponse.json({ error: err.message || 'File upload failed' }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filename = searchParams.get('file');

    if (!filename) {
      return NextResponse.json({ error: 'Filename parameter is required' }, { status: 400 });
    }

    // Prevent directory traversal attacks
    const safeFilename = path.basename(filename);
    const filePath = path.join(process.cwd(), 'uploads', safeFilename);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(safeFilename).toLowerCase();

    let contentType = 'application/octet-stream';
    if (ext === '.png') contentType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.webp') contentType = 'image/webp';
    else if (ext === '.gif') contentType = 'image/gif';
    else if (ext === '.pdf') contentType = 'application/pdf';
    else if (ext === '.txt') contentType = 'text/plain; charset=utf-8';
    else if (ext === '.json') contentType = 'application/json';

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
