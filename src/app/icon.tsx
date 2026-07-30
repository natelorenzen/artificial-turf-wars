import { ImageResponse } from 'next/og';
import { PIXEL, bitmapRects, bitmapSize, wordBitmap } from '@/lib/site/pixel';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

/**
 * The favicon and app icon, generated at build time.
 *
 * Hand-built from the pixel bitmaps rather than a font, so it renders identically
 * without shipping font binaries to Satori. A tab favicon is 16px, so the mark is
 * deliberately huge in frame and the background carries the field/sky split for
 * recognisability at that size — detail would just turn to mush.
 *
 * Shared renderer. Both entry points call this with their own dimension, because
 * re-exporting the default only changes the DECLARED size — the ImageResponse is
 * constructed with whatever `size` was in scope where it was written, so apple-icon
 * was shipping a 512px image labelled 180x180.
 */
export function renderIcon(px: number) {
  const bmp = wordBitmap('ATW');
  const scale = Math.round((22 * px) / 512);
  const { width, height } = bitmapSize(bmp, scale);
  const rects = bitmapRects(bmp, scale);
  const u = px / 512; // everything below was laid out against a 512 canvas
  const offsetY = 3 * u;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          background: PIXEL.sky2,
        }}
      >
        {/* Hard sky bands — no blends, as the hardware could not do them. */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: 128 * u, background: PIXEL.sky1 }} />
        <div style={{ position: 'absolute', left: 0, top: 128 * u, width: '100%', height: 96 * u, background: PIXEL.sky2 }} />
        <div style={{ position: 'absolute', left: 0, top: 224 * u, width: '100%', height: 96 * u, background: PIXEL.sky3 }} />
        <div style={{ position: 'absolute', left: 0, top: 320 * u, width: '100%', height: 64 * u, background: PIXEL.sky4 }} />

        {/* Field: mow stripes, hard edged. */}
        {Array.from({ length: 16 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: i * 32 * u,
              top: 384 * u,
              width: 32 * u,
              height: 128 * u,
              background: i % 2 === 0 ? PIXEL.field : PIXEL.fieldLo,
            }}
          />
        ))}
        <div style={{ position: 'absolute', left: 0, top: 384 * u, width: '100%', height: 6 * u, background: PIXEL.white }} />

        {/* Floodlight banks. */}
        {[
          [22, 26],
          [402, 26],
        ].map(([lx, ly], bank) =>
          Array.from({ length: 12 }).map((_, i) => (
            <div
              key={`${bank}-${i}`}
              style={{
                position: 'absolute',
                left: (lx + (i % 4) * 24) * u,
                top: (ly + Math.floor(i / 4) * 24) * u,
                width: 14 * u,
                height: 14 * u,
                background: PIXEL.white,
              }}
            />
          )),
        )}

        {/* The mark: amber fill on a thick ink outline, offset shadow beneath. */}
        <div style={{ position: 'relative', display: 'flex', width, height, marginTop: offsetY }}>
          {rects.map((r, i) => (
            <div
              key={`s${i}`}
              style={{
                position: 'absolute',
                left: r.x + 10 * u,
                top: r.y + 12 * u,
                width: r.w,
                height: r.h,
                background: PIXEL.ink,
              }}
            />
          ))}
          {rects.map((r, i) => (
            <div
              key={`o${i}`}
              style={{
                position: 'absolute',
                left: r.x - 6 * u,
                top: r.y - 6 * u,
                width: r.w + 12 * u,
                height: r.h + 12 * u,
                background: PIXEL.ink,
              }}
            />
          ))}
          {rects.map((r, i) => (
            <div
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
        </div>
      </div>
    ),
    { width: px, height: px },
  );
}

export default function Icon() {
  return renderIcon(size.width);
}
