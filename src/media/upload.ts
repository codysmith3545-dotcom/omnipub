import { readFileSync, existsSync } from "fs";
import { extname, basename } from "path";

export type MediaFile = {
  readonly path: string;
  readonly buffer: Buffer;
  readonly mimeType: string;
  readonly filename: string;
};

const MIME_MAP: Readonly<Record<string, string>> = {
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
    filename: basename(filePath),
  };
}
