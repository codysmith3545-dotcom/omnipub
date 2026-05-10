# omnipub — Design Spec

**Date:** 2026-05-10
**Author:** Cody Smith
**Status:** Approved

## Overview

One markdown file in, published to X Articles + LinkedIn + Medium + Substack simultaneously. Dry-run by default, `--post` to go live. TypeScript/Node. Self-healing auth and GraphQL hashes via bundled Playwright. Monolith CLI with library exports.

## Identity

- **CLI:** `npx omnipub publish draft.md`
- **Library:** `import { publish } from 'omnipub'`
- **MCP:** `omnipub-mcp`
- **Package:** `@codysmith/omnipub`

## Architecture

```
omnipub/
├── src/
│   ├── cli.ts                 # CLI entry (commander)
│   ├── index.ts               # Library exports
│   ├── mcp.ts                 # MCP server entry
│   ├── core/
│   │   ├── parser.ts          # Markdown + frontmatter → platform-neutral AST
│   │   ├── publisher.ts       # Orchestrator: parse → adapt → publish per platform
│   │   └── config.ts          # ~/.config/omnipub/config.toml loader
│   ├── platforms/
│   │   ├── base.ts            # Platform interface
│   │   ├── x-articles.ts      # X Articles (GraphQL + cookie auth)
│   │   ├── linkedin.ts        # LinkedIn (OAuth + API)
│   │   ├── substack.ts        # Substack (browser automation)
│   │   └── medium.ts          # Medium (REST API + token)
│   ├── auth/
│   │   ├── store.ts           # Unified credential store (~/.config/omnipub/auth/)
│   │   ├── cookie-refresh.ts  # Playwright-based cookie refresh for X/Substack
│   │   └── oauth.ts           # OAuth flows for LinkedIn/Medium
│   ├── healing/
│   │   └── x-hash-refresh.ts  # Auto-detect stale GraphQL hashes, re-extract via Playwright
│   └── media/
│       └── upload.ts          # Shared image upload (resize, format, per-platform limits)
├── tests/
├── package.json
└── tsconfig.json
```

## Key Interfaces

```typescript
interface Platform {
  name: string;
  publish(article: Article, opts: PublishOpts): Promise<PublishResult>;
  dryRun(article: Article): Promise<DryRunResult>;
  authenticate(): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
}

interface Article {
  title: string;
  body: MarkdownAST;
  cover?: string;
  tags?: string[];
  summary?: string;
  canonical?: string;
  platforms?: string[];
}

interface PublishResult {
  platform: string;
  success: boolean;
  url?: string;
  error?: string;
  healed?: boolean;  // true if self-healing ran
}

interface PublishOpts {
  dryRun: boolean;
  agent: boolean;   // --json --compact --no-input --no-color --yes
  only?: string[];
  exclude?: string[];
}

interface HealthStatus {
  platform: string;
  authenticated: boolean;
  reachable: boolean;
  issues?: string[];
}
```

## Platform Adapters

### X Articles
- Cookie auth from `~/.config/omnipub/auth/x-cookies.json`
- GraphQL operation hashes cached in `~/.config/omnipub/x-ops.json`
- Self-healing: on 404, Playwright launches headless, opens Articles editor, intercepts network requests, extracts fresh hashes, updates cache, retries
- Cookie refresh: on 401/403, Playwright opens X with existing cookies, triggers page load to refresh session, re-exports cookies
- Publish sequence: create draft → update title → upload images → update content → set cover → publish

### LinkedIn
- OAuth 2.0 token stored in auth store
- LinkedIn article creation API (v2 ugcPosts / articles)
- Supports cover images, rich text, tags

### Medium
- Integration token from Medium settings (no OAuth dance)
- `POST /users/{userId}/posts` with markdown
- Supports tags, canonical URL, publish status (draft/public/unlisted)
- No cover image via API (Medium auto-generates)

### Substack
- No official API — Playwright browser automation
- Cookie auth similar to X Articles
- Navigates editor, fills title/body, uploads cover, publishes

## Self-Healing

```
On any platform request failure:
  1. Classify: auth_expired | hash_stale | rate_limit | unknown
  2. auth_expired → cookie/token refresh via Playwright
  3. hash_stale (X only) → re-extract GraphQL hashes via Playwright
  4. rate_limit → exponential backoff with jitter (max 3 retries)
  5. unknown → log, skip platform, continue others
  6. After heal → retry original request once
  7. If retry fails → report failure, don't loop
```

Healing is inline during publish — no separate daemon.

## CLI Commands

```bash
# Publishing
omnipub publish <file.md>                  # dry-run all platforms
omnipub publish <file.md> --post           # publish live
omnipub publish <file.md> --only x         # single platform
omnipub publish <file.md> --exclude medium # skip one

# Auth
omnipub auth setup <platform>             # interactive auth flow
omnipub auth status                       # show auth state all platforms
omnipub auth refresh <platform>           # force credential refresh

# Health
omnipub doctor                            # check all platforms
omnipub doctor --platform x               # check one

# Agent mode
omnipub publish draft.md --post --agent   # JSON output, no prompts

# Config
omnipub config init                       # create config.toml
omnipub config show                       # dump config
```

## Frontmatter Schema

```yaml
---
title: My Article Title
cover: ./cover.png
tags: [ai, automation, agents]
summary: One-line description
canonical: https://myblog.com/original-post
platforms: [x, linkedin, medium, substack]
---
```

## Output Format

```json
{
  "results": [
    {"platform": "x", "success": true, "url": "https://x.com/..."},
    {"platform": "linkedin", "success": true, "url": "https://linkedin.com/..."},
    {"platform": "medium", "success": true, "url": "https://medium.com/..."},
    {"platform": "substack", "success": false, "error": "cookie expired", "healed": false}
  ],
  "summary": "3/4 published successfully"
}
```

## Not in v1

- No scheduled publishing
- No analytics aggregation
- No Git-driven auto-publish
- No multi-account
- No thread/tweet support
- No content diffing / update existing articles
