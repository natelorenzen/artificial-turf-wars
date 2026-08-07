/**
 * Markdown → HTML.
 *
 * Post bodies are files in this repository, so they are trusted content. Raw HTML is
 * still escaped rather than passed through, because a findings post is exactly the kind
 * of document that quotes a model's raw output verbatim — and model output is not
 * trusted content. A quoted `<script>` should read as `<script>` on the page.
 *
 * Two things worth knowing, both learned the hard way:
 *
 *  - marked v15 removed the `sanitize`/`html` options. Passing `html: false` to the
 *    constructor is silently ignored, so the first version of this file shipped a raw
 *    HTML passthrough while looking like it had one turned off. Escaping is explicit now.
 *  - `marked.use()` MUTATES the instance and accumulates. Calling it per render against
 *    a module-level singleton stacks a new renderer on every post rendered in the same
 *    process, which in a build that renders several posts means the last one runs
 *    through N copies of the extension. Each render gets its own instance instead.
 */

import { Marked, type Token } from 'marked';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Undo `escapeHtml`, for text that is about to be rendered as TEXT rather than markup.
 *
 * The contents rail and the heading slug both take their input from parsed inline HTML,
 * where marked has already turned `"` into `&quot;` and `&` into `&amp;`. Stripping the
 * tags off that string leaves the entities behind, and React then escapes them a second
 * time — so a heading containing a quotation mark rendered in the sidebar as
 * `&quot;Leaving the DEF slot empty&quot;`, and its anchor came out as
 * `quot-leaving-the-def-slot-empty-quot`.
 *
 * Ampersand last, mirroring `escapeHtml` doing it first: decoding it earlier would turn
 * `&amp;quot;` into `&quot;` and then into `"`, which is exactly the double-decode this
 * function exists to avoid.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Slug for a heading, so posts can be deep-linked. Deterministic and ASCII-only.
 * Duplicate headings get a numeric suffix rather than colliding.
 */
export function headingId(text: string, seen: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'section';
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

export interface Heading {
  id: string;
  text: string;
  level: number;
}

/** Render a post body, and collect its H2s for the contents rail. */
export function renderMarkdown(body: string): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const seen = new Map<string, number>();

  const marked = new Marked({ gfm: true, breaks: false });

  marked.use({
    /**
     * Demote every raw-HTML token to plain text before rendering.
     *
     * Done here rather than in a tokenizer override: declining the token at tokenizer
     * level leaves the lexer with no rule that consumes the input, and marked bails out
     * with "Infinite loop on byte". Rewriting the token after it has been consumed is
     * both safer and simpler.
     */
    walkTokens(token: Token) {
      if (token.type === 'html') {
        const raw = token.raw;
        // `text` tokens are emitted verbatim by the renderer, so escape here.
        (token as unknown as { type: string; text: string }).type = 'text';
        (token as unknown as { type: string; text: string }).text = escapeHtml(raw);
      }
    },
    renderer: {
      heading({ tokens, depth }: { tokens: unknown[]; depth: number }) {
        // `this.parser` is provided by marked at call time.
        const self = this as unknown as { parser: { parseInline: (t: unknown[]) => string } };
        const text = self.parser.parseInline(tokens);
        const plain = decodeEntities(text.replace(/<[^>]+>/g, ''));
        const id = headingId(plain, seen);
        if (depth === 2) headings.push({ id, text: plain, level: depth });
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
    },
  });

  const html = marked.parse(body, { async: false }) as string;
  return { html, headings };
}
