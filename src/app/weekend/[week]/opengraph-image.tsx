import { ImageResponse } from 'next/og';
import { PIXEL, bitmapRects, bitmapSize, wordBitmap } from '@/lib/site/pixel';
import { getGuide } from '@/lib/preview/read';
import { gameTitle } from '@/lib/preview/teams';

export const alt = 'Artificial Turf War — how to survive the weekend';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The share card for one weekend guide.
 *
 * This page had NO card at all — not even the site-wide fallback. Its
 * `generateMetadata` sets its own `openGraph` object, and doing that replaces the root
 * layout's rather than extending it, so a guide shared anywhere went out as a bare link
 * with a title and no picture. Of everything on this site the guide is the piece most
 * likely to be sent to somebody, which made it the worst page to have that gap.
 *
 * It leads with the four games. The headline is a good headline, but "Ravens at Colts"
 * tells a reader whether this weekend is worth their Sunday and a clever headline does
 * not — and the fixtures come from `game_keys`, so they cannot be wrong.
 */
export default async function WeekendOgImage({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  const guide = await getGuide(Number(week));

  const bmp = wordBitmap('ATW');
  const scale = 6;
  const { width, height } = bitmapSize(bmp, scale);
  const rects = bitmapRects(bmp, scale);

  const stripe = 40;
  const stripes = Math.ceil(size.width / stripe);

  const games = (guide?.gameKeys ?? []).map(gameTitle);
  // Stepped by character count, not measured — Satori cannot measure text. Erring small
  // keeps a long headline inside the card; erring large clips it.
  const headline = guide?.headline ?? 'How to survive this weekend';
  const headlineSize = headline.length > 58 ? 44 : headline.length > 40 ? 52 : 60;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          background: PIXEL.sky1,
          fontFamily: 'sans-serif',
        }}
      >
        {Array.from({ length: stripes }).map((_, i) => (
          <div
            key={`s${i}`}
            style={{
              position: 'absolute',
              left: i * stripe,
              top: 570,
              width: stripe,
              height: 60,
              background: i % 2 === 0 ? PIXEL.field : PIXEL.fieldLo,
            }}
          />
        ))}

        <div style={{ position: 'absolute', left: 56, top: 48, display: 'flex', width, height }}>
          {rects.map((r, i) => (
            <div
              key={`ol${i}`}
              style={{ position: 'absolute', left: r.x - 4, top: r.y - 4, width: r.w + 8, height: r.h + 8, background: PIXEL.ink }}
            />
          ))}
          {rects.map((r, i) => (
            <div
              key={`kl${i}`}
              style={{ position: 'absolute', left: r.x - 2, top: r.y - 2, width: r.w + 4, height: r.h + 4, background: PIXEL.white }}
            />
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

        <div
          style={{
            position: 'absolute',
            left: 56 + width + 26,
            top: 54,
            display: 'flex',
            fontSize: 20,
            letterSpacing: 4,
            color: PIXEL.amber,
          }}
        >
          {guide ? `WEEK ${guide.week}  ·  THE WEEKEND` : 'THE WEEKEND'}
        </div>

        <div
          style={{
            position: 'absolute',
            left: 56,
            top: 120,
            width: 1088,
            display: 'flex',
            fontSize: headlineSize,
            fontWeight: 700,
            lineHeight: 1.12,
            color: PIXEL.white,
            textShadow: `5px 5px 0 ${PIXEL.ink}`,
          }}
        >
          {headline}
        </div>

        {games.map((game, i) => (
          <div
            key={game}
            style={{
              position: 'absolute',
              left: 56,
              top: 312 + i * 50,
              display: 'flex',
              alignItems: 'center',
              fontSize: 30,
              color: '#aebbe0',
            }}
          >
            {/* A DRAWN square, not a bullet character. Satori ships no font covering
                the arrow glyph this used first, so it rendered as a tofu box on the
                card while looking perfectly fine in the source. */}
            <div style={{ width: 12, height: 12, marginRight: 16, background: PIXEL.amber }} />
            {game}
          </div>
        ))}

        {games.length === 0 && (
          <div
            style={{
              position: 'absolute',
              left: 56,
              top: 330,
              display: 'flex',
              fontSize: 30,
              color: '#aebbe0',
            }}
          >
            Eight AI models read the same data and disagree in public.
          </div>
        )}

        <div
          style={{
            position: 'absolute',
            left: 56,
            top: 528,
            display: 'flex',
            fontSize: 22,
            letterSpacing: 3,
            color: '#aebbe0',
          }}
        >
          ARTIFICIALTURFWAR.COM
        </div>
      </div>
    ),
    size,
  );
}
