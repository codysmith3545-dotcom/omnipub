import matter from "gray-matter";
import { marked } from "marked";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { z } from "zod";
import type { Article } from "../platforms/base.js";

const FrontmatterSchema = z.object({
  title: z.string(),
  cover: z.string().optional(),
  tags: z.array(z.string()).optional(),
  summary: z.string().optional(),
  canonical: z.string().url().optional(),
  platforms: z.array(z.string()).optional(),
});

export function parseMarkdownFile(filePath: string): Article {
  const absPath = resolve(filePath);
  const raw = readFileSync(absPath, "utf-8");
  return parseMarkdown(raw, dirname(absPath));
}

export function parseMarkdown(content: string, baseDir?: string): Article {
  const { data, content: body } = matter(content);
  const frontmatter = FrontmatterSchema.parse(data);

  let coverPath: string | undefined;
  if (frontmatter.cover && baseDir) {
    coverPath = resolve(baseDir, frontmatter.cover);
  }

  const bodyHtml = marked.parse(body, { async: false }) as string;

  return {
    title: frontmatter.title,
    body: body.trim(),
    bodyHtml,
    cover: coverPath,
    tags: frontmatter.tags,
    summary: frontmatter.summary,
    canonical: frontmatter.canonical,
    platforms: frontmatter.platforms,
  };
}
