import { bitmapRects, bitmapSize, wordBitmap, PIXEL } from '@/lib/site/pixel';

/**
 * The ATW mark, rendered from the same bitmaps as the favicon and OG card — so the
 * header, the browser tab and an X preview are literally the same artwork rather than
 * three approximations of it.
 */
export function PixelMark({ scale = 4 }: { scale?: number }) {
  const bmp = wordBitmap('ATW');
  const rects = bitmapRects(bmp, scale);
  const { width, height } = bitmapSize(bmp, scale);
  const o = Math.max(1, Math.round(scale / 3));

  return (
    <span
      aria-hidden="true"
      style={{ position: 'relative', display: 'inline-block', width, height, flex: '0 0 auto' }}
    >
      {rects.map((r, i) => (
        <span
          key={`o${i}`}
          style={{
            position: 'absolute',
            left: r.x - o,
            top: r.y - o,
            width: r.w + o * 2,
            height: r.h + o * 2,
            background: PIXEL.ink,
          }}
        />
      ))}
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
