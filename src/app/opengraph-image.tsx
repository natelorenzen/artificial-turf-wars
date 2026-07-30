import { ImageResponse } from 'next/og';
import { PIXEL, bitmapRects, bitmapSize, wordBitmap } from '@/lib/site/pixel';

export const alt = 'Artificial Turf War — eight AI models, one NFL fantasy season';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The link-preview card, generated at build time.
 *
 * Built from flat rectangles rather than gradients or fonts: Satori supports a subset
 * of CSS, and the 16-bit look wants hard edges anyway. Everything here is a coloured
 * box, which is both faithful to the reference and the most reliable thing to render.
 *
 * The text is deliberately short. A preview card is read at thumbnail size in a feed,
 * so the mark and one line have to carry it.
 */
export default function OpengraphImage() {
  const bmp = wordBitmap('ATW');
  const scale = 20;
  const { width, height } = bitmapSize(bmp, scale);
  const rects = bitmapRects(bmp, scale);

  const stripe = 40;
  const stripes = Math.ceil(size.width / stripe);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          background: PIXEL.sky2,
          fontFamily: 'sans-serif',
        }}
      >
        {/* Sky, in four hard bands. */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: 150, background: PIXEL.sky1 }} />
        <div style={{ position: 'absolute', left: 0, top: 150, width: '100%', height: 130, background: PIXEL.sky2 }} />
        <div style={{ position: 'absolute', left: 0, top: 280, width: '100%', height: 110, background: PIXEL.sky3 }} />
        <div style={{ position: 'absolute', left: 0, top: 390, width: '100%', height: 90, background: PIXEL.sky4 }} />

        {/* Floodlight banks, hard-edged bulbs. */}
        {[
          [48, 40],
          [1010, 40],
        ].map(([lx, ly], bank) =>
          Array.from({ length: 15 }).map((_, i) => (
            <div
              key={`l${bank}-${i}`}
              style={{
                position: 'absolute',
                left: lx + (i % 5) * 30,
                top: ly + Math.floor(i / 5) * 30,
                width: 16,
                height: 16,
                background: PIXEL.white,
              }}
            />
          )),
        )}

        {/* Helmets, abstracted: a coloured block with a visor slit. Small squares read
            as stray noise at feed thumbnail size, so these are big and deliberate. */}
        {[
          { x: 76, colour: PIXEL.home, visor: 'right' as const },
          { x: 990, colour: PIXEL.away, visor: 'left' as const },
        ].map((h) => (
          <div key={h.x} style={{ position: 'absolute', left: h.x, top: 196, display: 'flex' }}>
            <div style={{ position: 'absolute', left: 8, top: 10, width: 134, height: 134, background: PIXEL.ink }} />
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: 134,
                height: 134,
                background: h.colour,
                border: `10px solid ${PIXEL.ink}`,
              }}
            />
            {/* visor */}
            <div
              style={{
                position: 'absolute',
                left: h.visor === 'right' ? 74 : 20,
                top: 46,
                width: 40,
                height: 20,
                background: PIXEL.white,
              }}
            />
            {/* face guard */}
            <div
              style={{
                position: 'absolute',
                left: h.visor === 'right' ? 74 : 20,
                top: 84,
                width: 40,
                height: 10,
                background: PIXEL.white,
              }}
            />
          </div>
        ))}

        {/* Field: mow stripes with yard lines. */}
        {Array.from({ length: stripes }).map((_, i) => (
          <div
            key={`s${i}`}
            style={{
              position: 'absolute',
              left: i * stripe,
              top: 480,
              width: stripe,
              height: 150,
              background: i % 2 === 0 ? PIXEL.field : PIXEL.fieldLo,
            }}
          />
        ))}
        {Array.from({ length: stripes }).map((_, i) => (
          <div
            key={`y${i}`}
            style={{ position: 'absolute', left: i * stripe, top: 480, width: 4, height: 150, background: PIXEL.white }}
          />
        ))}
        <div style={{ position: 'absolute', left: 0, top: 480, width: '100%', height: 8, background: PIXEL.white }} />

        {/* The mark. */}
        <div
          style={{
            position: 'absolute',
            left: (size.width - width) / 2,
            top: 150,
            display: 'flex',
            width,
            height,
          }}
        >
          {rects.map((r, i) => (
            <div key={`sh${i}`} style={{ position: 'absolute', left: r.x + 10, top: r.y + 12, width: r.w, height: r.h, background: PIXEL.ink }} />
          ))}
          {rects.map((r, i) => (
            <div key={`ol${i}`} style={{ position: 'absolute', left: r.x - 6, top: r.y - 6, width: r.w + 12, height: r.h + 12, background: PIXEL.ink }} />
          ))}
          {rects.map((r, i) => (
            <div
              key={`fl${i}`}
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

        {/* One line, sized to survive a feed thumbnail. */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 396,
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: 2,
              color: PIXEL.white,
              textShadow: `5px 5px 0 ${PIXEL.ink}`,
            }}
          >
            EIGHT AI MODELS. ONE FANTASY SEASON.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
