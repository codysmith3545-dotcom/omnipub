import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parse as parseToml } from "toml";

export interface OmnipubConfig {
  platforms: {
    x?: { enabled: boolean };
    linkedin?: { enabled: boolean; clientId?: string };
    medium?: { enabled: boolean };
    substack?: { enabled: boolean; publication?: string };
  };
  defaults: {
    dryRun: boolean;
    agent: boolean;
  };
}

const CONFIG_DIR = join(homedir(), ".config", "omnipub");
const CONFIG_PATH = join(CONFIG_DIR, "config.toml");

const DEFAULT_CONFIG: OmnipubConfig = {
  platforms: {
    x: { enabled: true },
    linkedin: { enabled: true },
    medium: { enabled: true },
    substack: { enabled: true },
  },
  defaults: {
    dryRun: true,
    agent: false,
  },
};

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function loadConfig(): OmnipubConfig {
  if (!existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG;
  }
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return { ...DEFAULT_CONFIG, ...parseToml(raw) } as OmnipubConfig;
}

export function initConfig(): string {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const content = `# omnipub configuration

[platforms.x]
enabled = true

[platforms.linkedin]
enabled = true

[platforms.medium]
enabled = true

[platforms.substack]
enabled = true

[defaults]
dryRun = true
agent = false
`;
  writeFileSync(CONFIG_PATH, content);
  return CONFIG_PATH;
}
