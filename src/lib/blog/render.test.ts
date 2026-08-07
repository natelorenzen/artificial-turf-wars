import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './render';

describe('heading extraction', () => {
  it('collects H2s for the contents rail', () => {
    const { headings } = renderMarkdown('## First\n\ntext\n\n## Second\n');
    expect(headings.map((h) => h.text)).toEqual(['First', 'Second']);
    expect(headings.map((h) => h.id)).toEqual(['first', 'second']);
  });

  it('does not double-escape a heading that contains a quotation mark', () => {
    // Findings 005 was the first post with a quoted heading, and it rendered in the
    // contents rail as `&quot;Leaving the DEF slot empty&quot;` with an anchor of
    // `quot-leaving-the-def-slot-empty-quot`. Marked escapes the quote while parsing
    // inline HTML; stripping the tags left the entity behind, and React escaped it
    // again on the way to the page.
    const { headings } = renderMarkdown('## "Leaving the DEF slot empty"\n');
    expect(headings[0].text).toBe('"Leaving the DEF slot empty"');
    expect(headings[0].id).toBe('leaving-the-def-slot-empty');
  });

  it('handles an ampersand without decoding it twice', () => {
    // `&amp;quot;` must become `&quot;` and stop, not continue on to `"`.
    const { headings } = renderMarkdown('## Waivers &amp; the rolling list\n');
    expect(headings[0].text).toBe('Waivers & the rolling list');
  });

  it('gives the body heading the same id the contents rail links to', () => {
    // A mismatch here is a table of contents whose links all go nowhere.
    const { html, headings } = renderMarkdown('## "Quoted" heading\n');
    expect(html).toContain(`id="${headings[0].id}"`);
  });

  it('still escapes raw HTML in a post body', () => {
    // The reason any of this escaping exists. A findings post quotes model output
    // verbatim, and model output is not to be trusted as markup.
    const { html } = renderMarkdown('Some <script>alert(1)</script> text\n');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
