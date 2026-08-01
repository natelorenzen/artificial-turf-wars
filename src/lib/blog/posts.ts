/**
 * The CMS: markdown files on disk, read at build time.
 *
 * Why files and not a database table with an admin screen — the obvious shape for a
 * CMS, and the wrong one here:
 *
 *   1. This site has NO AUTH, by rule, permanently. An admin UI needs accounts, and
 *      accounts are the one thing the project has committed to never having. A
 *      write path into the database from a browser would be the first crack in that.
 *   2. The site is required to build without a database. Posts in Postgres would make
 *      the marketing pages depend on a live connection that the rest of the site
 *      deliberately does not need.
 *   3. Findings posts make empirical claims about model behaviour. In git they carry
 *      an immutable, public revision history — anyone can see whether a number was
 *      quietly edited after publication. That is the same argument the whole project
 *      rests on, applied to its own writing.
 *
 * The cost is real and worth stating: publishing requires a commit and a deploy. For a
 * site that publishes findings rather than daily news, that is an acceptable trade,
 * and arguably a feature.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface PostMeta {
  slug: string;
  title: string;
  /** One-line summary for the index and for social cards. */
  summary: string;
  /** ISO date. Used for ordering and for the printed dateline. */
  date: string;
  /** Short kicker above the headline, e.g. "Findings". */
  kicker?: string;
  /** Hidden from the index and the sitemap; still reachable by direct URL. */
  draft?: boolean;
  /**
   * Where a reader can check the claims — a script path, a data file, a commit.
   * Findings posts should always carry one.
   */
  evidence?: string;
  /**
   * Slug of a later post that carries newer results on the same question.
   *
   * Findings accumulate, and the honest way to handle that is to leave a published post
   * as the dated snapshot it was and point forward — not to silently rewrite it under a
   * reader who may already have shared it. A post that has been overtaken says so at the
   * top and links on.
   */
  followUp?: string;
  /** One line explaining what changed, shown in the pointer. */
  followUpNote?: string;
}

export interface Post extends PostMeta {
  /** Raw markdown body, frontmatter stripped. */
  body: string;
}

const POSTS_DIR = join(process.cwd(), 'content', 'posts');

/**
 * Minimal frontmatter parser.
 *
 * Deliberately not `gray-matter`: that pulls a full YAML engine and its transitive
 * tree to read six string keys out of files we author ourselves. The supported grammar
 * is `key: value` with optional surrounding quotes, and `true`/`false` for booleans.
 * Anything more elaborate should become a real field on PostMeta rather than a nested
 * structure smuggled through YAML.
 */
export function parseFrontmatter(raw: string): { meta: Record<string, string | boolean>; body: string } {
  const normalized = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) return { meta: {}, body: normalized.trim() };

  const meta: Record<string, string | boolean> = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    meta[key] = value === 'true' ? true : value === 'false' ? false : value;
  }
  return { meta, body: normalized.slice(match[0].length).trim() };
}

function toPost(slug: string, raw: string): Post {
  const { meta, body } = parseFrontmatter(raw);

  const title = typeof meta.title === 'string' ? meta.title : slug;
  const date = typeof meta.date === 'string' ? meta.date : '1970-01-01';
  // A malformed date would sort the post to a silently wrong place, which for a
  // findings log is worse than failing the build.
  if (Number.isNaN(Date.parse(date))) {
    throw new Error(`Post "${slug}" has an unparseable date: ${date}`);
  }

  return {
    slug,
    title,
    summary: typeof meta.summary === 'string' ? meta.summary : '',
    date,
    kicker: typeof meta.kicker === 'string' ? meta.kicker : undefined,
    draft: meta.draft === true,
    evidence: typeof meta.evidence === 'string' ? meta.evidence : undefined,
    followUp: typeof meta.followUp === 'string' ? meta.followUp : undefined,
    followUpNote: typeof meta.followUpNote === 'string' ? meta.followUpNote : undefined,
    body,
  };
}

export function getAllPosts({ includeDrafts = false } = {}): Post[] {
  if (!existsSync(POSTS_DIR)) return [];

  const posts = readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((file) => toPost(file.replace(/\.md$/, ''), readFileSync(join(POSTS_DIR, file), 'utf8')))
    .filter((p) => includeDrafts || !p.draft);

  // Newest first; slug breaks ties so ordering is stable when two posts share a date.
  return posts.sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)));
}

export function getPost(slug: string): Post | null {
  const path = join(POSTS_DIR, `${slug}.md`);
  if (!existsSync(path)) return null;
  return toPost(slug, readFileSync(path, 'utf8'));
}

/** Dateline format. Fixed to UTC so the printed date never shifts with the build host. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
