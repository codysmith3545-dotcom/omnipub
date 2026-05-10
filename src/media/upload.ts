import { readFileSync, existsSync } from "fs";
import { extname } from "path";

export interface MediaFile {
  path: string;
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function loadMedia(filePath: string): MediaFile {
  if (!existsSync(filePath)) {
    throw new Error(`Media file not found: ${filePath}`);
  }
  const ext = extname(filePath).toLowerCase();
  const mimeType = MIME_MAP[ext];
  if (!mimeType) {
    throw new Error(`Unsupported image format: ${ext}`);
  }
  return {
    path: filePath,
    buffer: readFileSync(filePath),
    mimeType,
    filename: filePath.split("/").pop()!,
  };
}
