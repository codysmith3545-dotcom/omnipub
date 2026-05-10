# omnipub

One markdown file, published everywhere. Multi-platform content publishing CLI for agents.

## Platforms

- **X Articles** — reverse-engineered GraphQL with self-healing hashes
- **LinkedIn** — OAuth v2 article API
- **Medium** — REST API with integration token
- **Substack** — Playwright browser automation

## Install

```bash
npm install -g @codysmith/omnipub
```

## Usage

```bash
# Dry-run (default — shows what would publish, no mutations)
omnipub publish article.md

# Publish for real
omnipub publish article.md --post

# Single platform
omnipub publish article.md --post --only x

# Agent mode (JSON output, no prompts)
omnipub publish article.md --post --agent

# Check auth status
omnipub doctor

# Set up auth
omnipub auth setup x          # extracts cookies from Chrome
omnipub auth setup medium     # set integration token
omnipub auth status
```

## Markdown Format

```markdown
---
title: My Article
cover: ./cover.png
tags: [ai, automation]
summary: One-line description
canonical: https://myblog.com/post
platforms: [x, linkedin, medium, substack]
---

Your article content here...
```

## Self-Healing

X Articles uses internal GraphQL endpoints with rotating operation hashes. When hashes go stale (404), omnipub automatically:

1. Launches headless Playwright
2. Opens X Articles editor
3. Intercepts network requests to extract fresh hashes
4. Updates local cache
5. Retries the failed request

Same pattern for expired cookies — detects auth failures and re-extracts from a running browser session.

## Library Usage

```typescript
import { publish, parseMarkdownFile } from '@codysmith/omnipub';

const article = parseMarkdownFile('article.md');
const results = await publish(article, { dryRun: false, agent: true });
```
