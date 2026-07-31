import { ImageResponse } from 'next/og';
import { PIXEL, bitmapRects, bitmapSize, wordBitmap } from '@/lib/site/pixel';
import { getAllPosts, getPost, formatDate } from '@/lib/blog/posts';

export const alt = 'Artificial Turf War — findings';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

/**
 * Per-post link-preview card.
 *
 * The site-wide card says "Eight AI models. One fantasy season." — right for the home
 * page, useless on a shared finding, where the whole reason someone clicks is the
 * headline. A findings post shared into a feed has one job: say what was found.
 *
 * Flat rectangles and no webfonts, same as the other generated art: Satori supports a
 * subset of CSS and needs font binaries supplied explicitly, and the 16-bit look wants
 * hard edges anyway.
 */
export default async function FindingsOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);

  const bmp = wordBitmap('ATW');
  const scale = 7;
  const { width, height } = bitmapSize(bmp, scale);
  const rects = bitmapRects(bmp, scale);

  const stripe = 40;
  const stripes = Math.ceil(size.width / stripe);

  const title = post?.title ?? 'Findings';
  // Satori has no text measurement, so long headlines are stepped down by character
  // count rather than measured. Erring small keeps a long title inside the card;
  // erring large would clip it, and a clipped headline is worse than a small one.
  const titleSize = title.length > 62 ? 50 : title.length > 44 ? 60 : 72;

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
        {/* Field strip along the bottom — the one piece of the key art that survives at
            thumbnail size and identifies the site without eating the headline. */}
        {Array.from({ length: stripes }).map((_, i) => (
          <div
            key={`s${i}`}
            style={{
              position: 'absolute',
              left: i * stripe,
              top: 560,
              width: stripe,
              height: 70,
              background: i % 2 === 0 ? PIXEL.field : PIXEL.fieldLo,
            }}
          />
        ))}

        {/* Mark, small and top-left: on a findings card it is a byline, not the subject. */}
        <div style={{ position: 'absolute', left: 60, top: 54, display: 'flex', width, height }}>
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

        {/* Clears the mark: 60px left inset + its 21-column bitmap at this scale. */}
        <div
          style={{
            position: 'absolute',
            left: 60 + width + 28,
            top: 62,
            display: 'flex',
            fontSize: 22,
            letterSpacing: 4,
            color: PIXEL.amber,
          }}
        >
          {(post?.kicker ?? 'FINDINGS').toUpperCase()}
          {post ? `   ·   ${formatDate(post.date).toUpperCase()}` : ''}
        </div>

        {/* The headline is the product. Everything else on this card defers to it. */}
        <div
          style={{
            position: 'absolute',
            left: 60,
            top: 170,
            width: 1080,
            display: 'flex',
            fontSize: titleSize,
            fontWeight: 700,
            lineHeight: 1.12,
            color: PIXEL.white,
            textShadow: `6px 6px 0 ${PIXEL.ink}`,
          }}
        >
          {title}
        </div>

        <div
          style={{
            position: 'absolute',
            left: 60,
            top: 496,
            display: 'flex',
            fontSize: 24,
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
