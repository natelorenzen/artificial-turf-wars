import { ImageResponse } from 'next/og';
import { PIXEL, bitmapRects, bitmapSize, wordBitmap } from '@/lib/site/pixel';
import { loadWeekResults } from '@/lib/site/results';

export const alt = 'Artificial Turf War — weekly results';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The share card for one week (SPEC §12).
 *
 * A results link shared anywhere — X, Slack, iMessage, Discord, a Google result — has
 * one job: show the scores. Not the headline, not the branding. Somebody who sees this
 * card and never clicks should still know what happened, and somebody who wants the
 * reasoning behind it has a reason to.
 *
 * Deliberately NOT the beat writer's headline, which is what the findings card leads
 * with. A column is one model's account of the week and it has been wrong before; four
 * scorelines are the week itself and cannot be.
 *
 * Flat rectangles and no webfonts, like the other generated art: Satori supports a
 * subset of CSS and needs font binaries supplied explicitly, and the 16-bit look wants
 * hard edges anyway.
 */
export default async function ResultsOgImage({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  const results = await loadWeekResults(Number(week));

  const bmp = wordBitmap('ATW');
  const scale = 6;
  const { width, height } = bitmapSize(bmp, scale);
  const rects = bitmapRects(bmp, scale);

  const stripe = 40;
  const stripes = Math.ceil(size.width / stripe);

  // At most four fixtures in an eight-team league, so the layout never has to scroll or
  // shrink — the row height below is a constant, not a calculation.
  const matchups = results?.matchups ?? [];
  //
  // 214 + 4 rows of 74 ends the last fixture near 474, leaving a clear gap under the
  // WEEK title and above the domain line at 516. The first draft used 210/84 and the
  // fourth fixture sat on top of the domain — visible only once it had been rendered,
  // which is the whole argument for rendering it.
  const rowTop = 214;
  const rowHeight = 74;

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
          {results?.facts.scoring_status === 'final' ? 'FINAL' : 'PROVISIONAL'}
        </div>

        <div
          style={{
            position: 'absolute',
            left: 56,
            top: 118,
            display: 'flex',
            fontSize: 68,
            fontWeight: 700,
            color: PIXEL.white,
            textShadow: `5px 5px 0 ${PIXEL.ink}`,
          }}
        >
          {results ? `WEEK ${results.week}` : 'RESULTS'}
        </div>

        {matchups.map((m, i) => (
          <div
            key={m.winner.model}
            style={{
              position: 'absolute',
              left: 56,
              top: rowTop + i * rowHeight,
              width: 1088,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {/* The winner is bright and the loser is dimmed, so the result reads at
                thumbnail size without anyone parsing two numbers. */}
            <div style={{ display: 'flex', width: 400, fontSize: 34, fontWeight: 700, color: PIXEL.white }}>
              {m.winner.model}
            </div>
            <div style={{ display: 'flex', width: 130, fontSize: 38, fontWeight: 700, color: PIXEL.amber }}>
              {m.winner.points}
            </div>
            <div style={{ display: 'flex', width: 70, fontSize: 22, color: '#8fa2cf' }}>
              {m.tied ? 'tie' : 'def.'}
            </div>
            <div style={{ display: 'flex', width: 360, fontSize: 30, color: '#aebbe0' }}>
              {m.loser.model}
            </div>
            <div style={{ display: 'flex', fontSize: 30, color: '#8fa2cf' }}>{m.loser.points}</div>
          </div>
        ))}

        {matchups.length === 0 && (
          <div
            style={{
              position: 'absolute',
              left: 56,
              top: 240,
              display: 'flex',
              fontSize: 34,
              color: '#aebbe0',
            }}
          >
            Eight AI models. One NFL fantasy season.
          </div>
        )}

        <div
          style={{
            position: 'absolute',
            left: 56,
            top: 516,
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
