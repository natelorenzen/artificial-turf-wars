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
 */
export default function Icon() {
  const bmp = wordBitmap('ATW');
  const scale = 22;
  const { width, height } = bitmapSize(bmp, scale);
  const rects = bitmapRects(bmp, scale);
  const offsetY = 3;

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
        <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: 128, background: PIXEL.sky1 }} />
        <div style={{ position: 'absolute', left: 0, top: 128, width: '100%', height: 96, background: PIXEL.sky2 }} />
        <div style={{ position: 'absolute', left: 0, top: 224, width: '100%', height: 96, background: PIXEL.sky3 }} />
        <div style={{ position: 'absolute', left: 0, top: 320, width: '100%', height: 64, background: PIXEL.sky4 }} />

        {/* Field: mow stripes, hard edged. */}
        {Array.from({ length: 16 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: i * 32,
              top: 384,
              width: 32,
              height: 128,
              background: i % 2 === 0 ? PIXEL.field : PIXEL.fieldLo,
            }}
          />
        ))}
        <div style={{ position: 'absolute', left: 0, top: 384, width: '100%', height: 6, background: PIXEL.white }} />

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
                left: lx + (i % 4) * 24,
                top: ly + Math.floor(i / 4) * 24,
                width: 14,
                height: 14,
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
                left: r.x + 10,
                top: r.y + 12,
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
                left: r.x - 6,
                top: r.y - 6,
                width: r.w + 12,
                height: r.h + 12,
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
                background: r.y < 3 * 22 ? PIXEL.amber : PIXEL.amberLo,
              }}
            />
          ))}
        </div>
      </div>
    ),
    size,
  );
}
