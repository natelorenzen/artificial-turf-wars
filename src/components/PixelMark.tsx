import { bitmapRects, bitmapSize, wordBitmap, PIXEL } from '@/lib/site/pixel';

/**
 * The ATW mark, rendered from the same bitmaps as the favicon and OG card — so the
 * header, the browser tab and an X preview are literally the same artwork rather than
 * three approximations of it.
 *
 * Three layers, matching the key art used as the account avatar: a dark outer outline,
 * a white keyline inside it, then the amber fill graded light-to-dark down the glyph.
 * The white keyline is what makes the mark read as *that* logo rather than as generic
 * amber pixel type — it is the first thing your eye picks up on the avatar, and the
 * header mark looked like a different logo without it.
 */
export function PixelMark({ scale = 4 }: { scale?: number }) {
  const bmp = wordBitmap('ATW');
  const rects = bitmapRects(bmp, scale);
  const { width, height } = bitmapSize(bmp, scale);
  const key = Math.max(1, Math.round(scale / 4)); // white keyline
  const out = key * 2; // dark outline, outside the keyline

  const layer = (inset: number, background: string, prefix: string) =>
    rects.map((r, i) => (
      <span
        key={`${prefix}${i}`}
        style={{
          position: 'absolute',
          left: r.x - inset,
          top: r.y - inset,
          width: r.w + inset * 2,
          height: r.h + inset * 2,
          background,
        }}
      />
    ));

  return (
    <span
      aria-hidden="true"
      style={{ position: 'relative', display: 'inline-block', width, height, flex: '0 0 auto' }}
    >
      {layer(out, PIXEL.ink, 'o')}
      {layer(key, PIXEL.white, 'k')}
      {rects.map((r, i) => (
        <span
          key={`f${i}`}
          style={{
            position: 'absolute',
            left: r.x,
            top: r.y,
            width: r.w,
            height: r.h,
            background: r.y < 3 * scale ? PIXEL.amber : PIXEL.amberLo,
          }}
        />
      ))}
    </span>
  );
}
