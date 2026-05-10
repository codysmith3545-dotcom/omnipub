import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { getConfigDir } from "../core/config.js";

const AUTH_DIR = join(getConfigDir(), "auth");

export type Credentials = {
  type: "cookie" | "oauth" | "token";
  value: string;
  expiresAt?: string;
};

function authPath(platform: string): string {
  return join(AUTH_DIR, `${platform}.json`);
}

export function getCredentials(platform: string): Credentials | null {
  const path = authPath(platform);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export function saveCredentials(platform: string, creds: Credentials): void {
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(authPath(platform), JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function hasCredentials(platform: string): boolean {
  return getCredentials(platform) !== null;
}

export function clearCredentials(platform: string): void {
  const path = authPath(platform);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
