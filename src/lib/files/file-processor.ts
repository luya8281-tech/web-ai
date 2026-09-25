import fs from 'fs';
import path from 'path';

export interface ProcessedFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  localPath: string;
  isImage: boolean;
  extractedText?: string;
}

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export class FileProcessor {
  static readonly MAX_SIZE_BYTES = parseInt(process.env.MAX_UPLOAD_SIZE || '20971520', 10); // 20 MB

  static isImageMime(mime: string): boolean {
    return mime.startsWith('image/') || /^image\/(jpeg|png|webp|gif|svg\+xml|heic|heif)/.test(mime);
  }

  static isTextMime(mime: string, ext: string): boolean {
    if (mime.startsWith('text/')) return true;
    const textExts = ['.txt', '.md', '.json', '.csv', '.js', '.ts', '.py', '.html', '.css', '.xml', '.yml', '.yaml'];
    return textExts.includes(ext.toLowerCase());
  }

  static async processUploadedFile(file: File): Promise<ProcessedFile> {
    if (file.size > this.MAX_SIZE_BYTES) {
      throw new Error(`File size ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds maximum allowed ${(this.MAX_SIZE_BYTES / 1024 / 1024).toFixed(0)}MB.`);
    }

    const id = `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const ext = path.extname(file.name);
    const safeFilename = `${id}${ext}`;
    const localPath = path.join(UPLOAD_DIR, safeFilename);

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(localPath, buffer);

    const url = `/api/upload?file=${safeFilename}`;
    const isImage = this.isImageMime(file.type);
    let extractedText: string | undefined;

    if (this.isTextMime(file.type, ext)) {
      try {
        extractedText = buffer.toString('utf-8');
      } catch (e) {}
    }

    return {
      id,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      url,
      localPath,
      isImage,
      extractedText,
    };
  }
}
