export interface Article {
  title: string;
  body: string;
  bodyHtml: string;
  cover?: string;
  tags?: string[];
  summary?: string;
  canonical?: string;
  platforms?: string[];
}

export interface PublishResult {
  platform: string;
  success: boolean;
  url?: string;
  error?: string;
  healed?: boolean;
}

export interface DryRunResult {
  platform: string;
  payload: unknown;
  wouldPublish: boolean;
}

export interface PublishOpts {
  dryRun: boolean;
  agent: boolean;
}

export interface HealthStatus {
  platform: string;
  authenticated: boolean;
  reachable: boolean;
  issues?: string[];
}

export type ErrorClass = "auth_expired" | "hash_stale" | "rate_limit" | "unknown";

export interface Platform {
  name: string;
  publish(article: Article, opts: PublishOpts): Promise<PublishResult>;
  dryRun(article: Article): Promise<DryRunResult>;
  authenticate(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  classifyError(error: unknown): ErrorClass;
}
