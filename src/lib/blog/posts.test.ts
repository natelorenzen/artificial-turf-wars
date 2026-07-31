import { describe, expect, it } from 'vitest';
import { parseFrontmatter, formatDate, getAllPosts } from '@/lib/blog/posts';
import { headingId, renderMarkdown } from '@/lib/blog/render';

describe('parseFrontmatter', () => {
  it('splits frontmatter from the body', () => {
    const { meta, body } = parseFrontmatter('---\ntitle: Hello\ndate: 2026-07-31\n---\n\n# Heading\n\nText.');
    expect(meta.title).toBe('Hello');
    expect(meta.date).toBe('2026-07-31');
    expect(body).toBe('# Heading\n\nText.');
  });

  it('strips surrounding quotes so titles with colons survive', () => {
    // Unquoted, a colon in a title would truncate at the wrong separator.
    const { meta } = parseFrontmatter('---\ntitle: "Chalk or Walk: what happened"\n---\nbody');
    expect(meta.title).toBe('Chalk or Walk: what happened');
  });

  it('coerces booleans so draft:true is not the string "true"', () => {
    const { meta } = parseFrontmatter('---\ndraft: true\nkicker: Findings\n---\nbody');
    expect(meta.draft).toBe(true);
    expect(meta.kicker).toBe('Findings');
  });

  it('handles CRLF line endings', () => {
    const { meta, body } = parseFrontmatter('---\r\ntitle: Hi\r\n---\r\nbody text');
    expect(meta.title).toBe('Hi');
    expect(body).toBe('body text');
  });

  it('treats a file with no frontmatter as all body', () => {
    const { meta, body } = parseFrontmatter('# Just markdown');
    expect(meta).toEqual({});
    expect(body).toBe('# Just markdown');
  });
});

describe('formatDate', () => {
  it('is timezone-stable, so the dateline never shifts with the build host', () => {
    // Parsed as UTC midnight; a local-time format would render this as 30 July
    // anywhere west of Greenwich.
    expect(formatDate('2026-07-31')).toBe('31 July 2026');
  });
});

describe('headingId', () => {
  it('slugifies, collapsing punctuation rather than leaving a double hyphen', () => {
    expect(headingId('What this means — and what it does not', new Map())).toBe(
      'what-this-means-and-what-it-does-not',
    );
  });

  it('disambiguates repeats instead of colliding', () => {
    const seen = new Map<string, number>();
    expect(headingId('Results', seen)).toBe('results');
    expect(headingId('Results', seen)).toBe('results-2');
  });

  it('falls back rather than producing an empty anchor', () => {
    expect(headingId('!!!', new Map())).toBe('section');
  });
});

describe('renderMarkdown', () => {
  it('renders markdown and collects H2s for the contents rail', () => {
    const { html, headings } = renderMarkdown('## First\n\ntext\n\n### Sub\n\n## Second');
    expect(html).toContain('<h2 id="first">First</h2>');
    expect(headings.map((h) => h.id)).toEqual(['first', 'second']);
    // H3s are rendered and anchored but stay out of the rail.
    expect(html).toContain('<h3 id="sub">');
  });

  it('escapes raw HTML rather than executing it', () => {
    // Findings posts quote raw model output, and model output is not trusted content.
    const { html } = renderMarkdown('A model replied: <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('supports tables, which every findings post needs', () => {
    const { html } = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });
});

describe('getAllPosts', () => {
  it('returns published posts newest first and excludes drafts by default', () => {
    const posts = getAllPosts();
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => !p.draft)).toBe(true);

    const dates = posts.map((p) => p.date);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });

  it('gives every post the fields the index and the sitemap rely on', () => {
    for (const post of getAllPosts()) {
      expect(post.slug, `${post.slug} slug`).toMatch(/^[a-z0-9-]+$/);
      expect(post.title.length, `${post.slug} title`).toBeGreaterThan(0);
      expect(post.summary.length, `${post.slug} summary`).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(post.date)), `${post.slug} date`).toBe(false);
    }
  });
});
