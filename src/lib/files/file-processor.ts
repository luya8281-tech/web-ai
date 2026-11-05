import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

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
const SHARED_DIR = path.join(UPLOAD_DIR, 'shared');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(SHARED_DIR)) {
  fs.mkdirSync(SHARED_DIR, { recursive: true });
}

export class FileProcessor {
  static readonly MAX_SIZE_BYTES = parseInt(process.env.MAX_UPLOAD_SIZE || '52428800', 10); // 50 MB

  static isImageMime(mime: string): boolean {
    return mime.startsWith('image/') || /^image\/(jpeg|png|webp|gif|svg\+xml|heic|heif)/.test(mime);
  }

  static isTextMime(mime: string, ext: string): boolean {
    if (mime.startsWith('text/')) return true;
    const textExts = [
      '.txt', '.lua', '.md', '.json', '.csv', '.tsv', '.js', '.ts', '.tsx', '.jsx',
      '.py', '.html', '.css', '.xml', '.yml', '.yaml', '.sql', '.sh', '.bash',
      '.srt', '.vtt', '.ini', '.toml', '.cfg', '.conf', '.log', '.c', '.cpp',
      '.h', '.go', '.rs', '.java', '.kt', '.php', '.rb',
    ];
    return textExts.includes(ext.toLowerCase());
  }

  static extractOfficeText(localPath: string, ext: string): string | undefined {
    const low = ext.toLowerCase();
    if (low !== '.xlsx' && low !== '.docx') return undefined;
    try {
      const pyCode = `
import sys
p, ext = sys.argv[1], sys.argv[2]
if ext == '.xlsx':
    import openpyxl
    wb = openpyxl.load_workbook(p, data_only=True, read_only=True)
    out = []
    for name in wb.sheetnames[:5]:
        ws = wb[name]
        out.append(f"=== Sheet: {name} ===")
        for idx, row in enumerate(ws.iter_rows(values_only=True)):
            if idx >= 150:
                out.append("...(baris selanjutnya disingkat)")
                break
            vals = ["" if v is None else str(v) for v in row]
            if any(vals):
                out.append("\\t".join(vals))
    print("\\n".join(out)[:20000])
elif ext == '.docx':
    import docx
    doc = docx.Document(p)
    paras = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    for t in doc.tables:
        for r in t.rows:
            paras.append(" | ".join(c.text.strip() for c in r.cells))
    print("\\n".join(paras)[:20000])
`;
      const stdout = execFileSync('python3', ['-c', pyCode, localPath, low], {
        timeout: 8000,
        encoding: 'utf-8',
      });
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  static async processUploadedFile(file: File): Promise<ProcessedFile> {
    if (file.size > this.MAX_SIZE_BYTES) {
      throw new Error(
        `Ukuran berkas ${(file.size / 1024 / 1024).toFixed(1)}MB melebihi batas ${(
          this.MAX_SIZE_BYTES /
          1024 /
          1024
        ).toFixed(0)}MB.`
      );
    }

    const id = `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const ext = path.extname(file.name);
    const safeFilename = `${id}${ext}`;
    const localPath = path.join(UPLOAD_DIR, safeFilename);

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(localPath, buffer);

    const url = `/api/browser-shots/${encodeURIComponent(safeFilename)}`;
    const isImage = this.isImageMime(file.type);
    let extractedText: string | undefined;

    if (this.isTextMime(file.type, ext)) {
      try {
        extractedText = buffer.toString('utf-8').substring(0, 24000);
      } catch {}
    } else if (ext.toLowerCase() === '.xlsx' || ext.toLowerCase() === '.docx') {
      extractedText = this.extractOfficeText(localPath, ext);
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
