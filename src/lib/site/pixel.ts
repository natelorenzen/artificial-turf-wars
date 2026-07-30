/**
 * Pixel letterforms, as bitmaps.
 *
 * Used by the generated icon and OG images AND by the site chrome, so the mark is
 * identical in a browser tab, an X card, and the header — one definition, no drift.
 *
 * Bitmaps rather than a font, for three reasons: Satori (which renders the OG images)
 * needs font binaries supplied explicitly and has no Impact, a webfont CDN is blocked
 * by our own CSP rules and would fail silently, and pixel art *is* a grid of squares —
 * expressing it as one is more faithful than approximating it with type.
 *
 * 1 = filled, 0 = empty. Read top row first.
 */

export type Bitmap = number[][];

const A: Bitmap = [
  [0, 0, 1, 1, 0, 0],
  [0, 1, 1, 1, 1, 0],
  [1, 1, 0, 0, 1, 1],
  [1, 1, 0, 0, 1, 1],
  [1, 1, 1, 1, 1, 1],
  [1, 1, 0, 0, 1, 1],
  [1, 1, 0, 0, 1, 1],
];

const T: Bitmap = [
  [1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
  [0, 0, 1, 1, 0, 0],
  [0, 0, 1, 1, 0, 0],
  [0, 0, 1, 1, 0, 0],
  [0, 0, 1, 1, 0, 0],
  [0, 0, 1, 1, 0, 0],
];

const W: Bitmap = [
  [1, 1, 0, 0, 0, 1, 1],
  [1, 1, 0, 0, 0, 1, 1],
  [1, 1, 0, 0, 0, 1, 1],
  [1, 1, 0, 1, 0, 1, 1],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 0, 1, 1, 1],
  [1, 1, 0, 0, 0, 1, 1],
];

export const GLYPHS: Record<string, Bitmap> = { A, T, W };

/** The mark, as one bitmap with a one-column gap between letters. */
export function wordBitmap(word = 'ATW', gap = 1): Bitmap {
  const glyphs = [...word].map((c) => GLYPHS[c.toUpperCase()]).filter(Boolean);
  if (glyphs.length === 0) return [];
  const rows = glyphs[0].length;

  const out: Bitmap = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    glyphs.forEach((g, i) => {
      if (i > 0) for (let k = 0; k < gap; k++) row.push(0);
      row.push(...g[r]);
    });
    out.push(row);
  }
  return out;
}

/**
 * Flatten a bitmap into rectangles, merging horizontal runs.
 *
 * Emitting one element per filled cell would mean hundreds of nodes; Satori is slow
 * and memory-hungry at that count and it is wasteful in the DOM too. Merging runs
 * typically cuts it by an order of magnitude while producing identical output.
 */
export function bitmapRects(
  bitmap: Bitmap,
  scale: number,
): { x: number; y: number; w: number; h: number }[] {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  bitmap.forEach((row, y) => {
    let runStart = -1;
    for (let x = 0; x <= row.length; x++) {
      const on = row[x] === 1;
      if (on && runStart === -1) runStart = x;
      if (!on && runStart !== -1) {
        rects.push({ x: runStart * scale, y: y * scale, w: (x - runStart) * scale, h: scale });
        runStart = -1;
      }
    }
  });
  return rects;
}

export function bitmapSize(bitmap: Bitmap, scale: number) {
  return { width: (bitmap[0]?.length ?? 0) * scale, height: bitmap.length * scale };
}

/**
 * Palette shared by the generated art and the site, taken from the key art.
 *
 * Must stay in step with the custom properties in `globals.css` — the favicon, the OG
 * card and the header mark are meant to be the same artwork, and they only are if the
 * two definitions agree.
 *
 * The sky ramp is royal blue rather than the purple it started as: purple was a hue
 * that belonged to nothing else in the picture, where blue-over-green is what a 16-bit
 * football cabinet actually looks like.
 */
export const PIXEL = {
  sky1: '#0f2d8f',
  sky2: '#1745bb',
  sky3: '#1f5ad8',
  sky4: '#2e73e8',
  field: '#3fbb45',
  fieldLo: '#1f7f2c',
  fieldDark: '#14571f',
  /* Helmets on the OG card. `home` was a mid blue, which was legible against a purple
     sky and disappears against a blue one — it is silver now. */
  home: '#e6e9f5',
  away: '#d93b2b',
  amber: '#ffc02e',
  amberLo: '#e07a1a',
  ink: '#05081a',
  white: '#ffffff',
} as const;
