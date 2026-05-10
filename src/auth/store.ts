import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { getConfigDir } from "../core/config.js";

const AUTH_DIR = join(getConfigDir(), "auth");

export interface Credentials {
  type: "cookie" | "oauth" | "token";
  value: string;
  expiresAt?: string;
}

function authPath(platform: string): string {
  return join(AUTH_DIR, `${platform}.json`);
}

export function getCredentials(platform: string): Credentials | null {
  const path = authPath(platform);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function saveCredentials(platform: string, creds: Credentials): void {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(authPath(platform), JSON.stringify(creds, null, 2));
}

export function hasCredentials(platform: string): boolean {
  return existsSync(authPath(platform));
}

export function clearCredentials(platform: string): void {
  const path = authPath(platform);
  if (existsSync(path)) {
    writeFileSync(path, "");
  }
}
