export type Article = {
  title: string;
  body: string;
  bodyHtml: string;
  cover?: string;
  tags?: readonly string[];
  summary?: string;
  canonical?: string;
  platforms?: readonly string[];
};

export type PublishResult = {
  platform: string;
  success: boolean;
  url?: string;
  error?: string;
  healed?: boolean;
};

export type DryRunResult = {
  platform: string;
  payload: unknown;
  wouldPublish: boolean;
};

export type PublishOpts = {
  dryRun: boolean;
  agent: boolean;
};

export type HealthStatus = {
  platform: string;
  authenticated: boolean;
  reachable: boolean;
  issues?: readonly string[];
};

export type ErrorClass = "auth_expired" | "hash_stale" | "rate_limit" | "unknown";

export type Platform = {
  name: string;
  publish(article: Article, opts: PublishOpts): Promise<PublishResult>;
  dryRun(article: Article): Promise<DryRunResult>;
  authenticate(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  classifyError(error: unknown): ErrorClass;
};
