import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabase, SUPABASE_CONFIGURED } from '@/lib/supabase';

/**
 * Per-record canonical.
 *
 * These pages number in the thousands by season's end and are the deepest, thinnest
 * content on the site — exactly the shape a crawler treats as near-duplicate. A
 * canonical pointing at the record's own id is what keeps them distinguishable.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return {
    title: 'Decision record — Artificial Turf War',
    description: 'The full prompt, the unedited response, and every check run against it.',
    alternates: { canonical: `/decisions/${id}` },
  };
}

/** Nothing is hidden here, so nothing is cached — a decision never changes. */
export const revalidate = 86400;

interface DecisionRow {
  id: string;
  type: string;
  week: number | null;
  round: number | null;
  pick_overall: number | null;
  prompt_version: string;
  rulebook_version: string;
  dossier_hash: string | null;
  memory_block: string | null;
  system_prompt: string;
  user_prompt: string;
  context_hash: string;
  raw_response: string | null;
  parsed_json: unknown;
  valid: boolean;
  validation_error: string | null;
  fallback_applied: boolean;
  provider_failure: boolean;
  retry_count: number;
  temperature_requested: number | null;
  reasoning_tokens: number | null;
  latency_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  headline: string | null;
  key_factors: string[] | null;
  closest_call: string | null;
  what_would_change_it: string | null;
  confidence: number | null;
  cited_fields: string[] | null;
  unsupported_claims: string[] | null;
  soft_violations: string[] | null;
  created_at: string;
  models: { display_name: string; lab: string } | null;
}

export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SUPABASE_CONFIGURED) notFound();

  const { data } = await supabase
    .from('decisions')
    .select(
      'id, type, week, round, pick_overall, prompt_version, rulebook_version, dossier_hash, memory_block, ' +
        'system_prompt, user_prompt, context_hash, raw_response, parsed_json, valid, validation_error, ' +
        'fallback_applied, provider_failure, retry_count, temperature_requested, reasoning_tokens, ' +
        'latency_ms, tokens_in, tokens_out, cost_usd, headline, key_factors, closest_call, ' +
        'what_would_change_it, confidence, cited_fields, unsupported_claims, soft_violations, ' +
        'created_at, models(display_name, lab)',
    )
    .eq('id', id)
    .maybeSingle();

  if (!data) notFound();
  const d = data as unknown as DecisionRow;

  const label = [
    d.type.replace('_', ' '),
    d.week ? `week ${d.week}` : null,
    d.round ? `round ${d.round}` : null,
    d.pick_overall ? `pick ${d.pick_overall}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <main className="wrap">
      <div className="yard" />
      <h1>{d.models?.display_name ?? 'Decision'}</h1>
      <p className="sub">{label}</p>

      <p className="lede-copy">
        This is the complete record of one model call: everything sent, everything returned, and
        every check run against it. Nothing is summarised or edited.
      </p>

      <Status d={d} />
      <Reasoning d={d} />
      <Checks d={d} />
      <Raw d={d} />
      <Provenance d={d} />
    </main>
  );
}

function Status({ d }: { d: DecisionRow }) {
  return (
    <div className="tiles" style={{ marginTop: 20 }}>
      <div className="tile">
        <div className="k">Outcome</div>
        <div className="v" style={{ fontSize: 26 }}>
          {d.provider_failure ? 'OUTAGE' : d.valid ? 'VALID' : 'INVALID'}
        </div>
        <div className="n">
          {d.provider_failure
            ? 'The provider never returned a usable response. Not a model error.'
            : d.valid
              ? 'Parsed cleanly against the schema on this attempt.'
              : 'Failed the schema. A deterministic fallback was applied and flagged.'}
          {d.retry_count > 0 && <> · {d.retry_count} retries</>}
        </div>
      </div>
      <div className="tile">
        <div className="k">Tokens</div>
        <div className="v" style={{ fontSize: 26 }}>
          {d.tokens_in ?? '—'} → {d.tokens_out ?? '—'}
        </div>
        <div className="n">
          {d.reasoning_tokens ? `${d.reasoning_tokens} of the output was reasoning` : 'no reasoning tokens reported'}
        </div>
      </div>
      <div className="tile">
        <div className="k">Cost</div>
        <div className="v" style={{ fontSize: 26 }}>
          ${Number(d.cost_usd ?? 0).toFixed(4)}
        </div>
        <div className="n">{d.latency_ms ? `${(d.latency_ms / 1000).toFixed(1)}s latency` : ''}</div>
      </div>
      <div className="tile">
        <div className="k">Temperature</div>
        <div className="v" style={{ fontSize: 26 }}>
          {d.temperature_requested ?? '—'}
        </div>
        <div className="n">Requested identically for all eight models</div>
      </div>
    </div>
  );
}

function Reasoning({ d }: { d: DecisionRow }) {
  if (!d.headline) return null;
  return (
    <>
      <div className="yard" />
      <h2>What it said</h2>
      <p className="sub">Structured reasoning, exactly as returned</p>

      <div className="telestrator">
        <div className="tel-hd">
          <b>{d.models?.display_name}</b>
          <span>{d.type.replace('_', ' ')}</span>
          {d.confidence !== null && <span>stated confidence {d.confidence.toFixed(2)}</span>}
        </div>
        <p className="lede">{d.headline}</p>

        {d.key_factors && d.key_factors.length > 0 && (
          <>
            <p>
              <strong>Key factors</strong>
            </p>
            <ul className="kf">
              {d.key_factors.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </>
        )}

        {d.closest_call && (
          <p style={{ marginTop: 12 }}>
            <strong>Closest call.</strong> {d.closest_call}
          </p>
        )}
        {d.what_would_change_it && (
          <p>
            <strong>What would have changed it.</strong> {d.what_would_change_it}
          </p>
        )}
      </div>
    </>
  );
}

function Checks({ d }: { d: DecisionRow }) {
  const cited = d.cited_fields ?? [];
  const unsupported = d.unsupported_claims ?? [];
  const soft = d.soft_violations ?? [];

  return (
    <>
      <div className="yard" />
      <h2>Automated checks</h2>
      <p className="sub">Deterministic string and number matching — never a model call</p>

      <div className="grid2">
        <div className="panel">
          <h3>Fields cited</h3>
          {cited.length === 0 ? (
            <p className="muted">None detected.</p>
          ) : (
            <p style={{ fontFamily: 'var(--font-data)', fontSize: 13, lineHeight: 2 }}>
              {cited.map((f) => (
                <code key={f} style={{ marginRight: 6 }}>
                  {f}
                </code>
              ))}
            </p>
          )}
          <p className="muted">
            Data fields and rulebook values the stated reasoning can be tied back to.
          </p>
        </div>

        <div className={`panel ${unsupported.length > 0 ? 'flag' : ''}`}>
          <h3>Claims not tied to the data</h3>
          {unsupported.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <ul>
              {unsupported.map((c) => (
                <li key={c} style={{ fontSize: 14 }}>
                  {c}
                </li>
              ))}
            </ul>
          )}
          <p className="muted">
            Advisory only. This checker was wrong about most of what it flagged the first time it
            ran against real output — see <Link href="/methodology">methodology</Link>. Read these
            as prompts to go and look, not as verdicts.
          </p>
        </div>
      </div>

      {soft.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Formatting notes</h3>
          <ul>
            {soft.map((s) => (
              <li key={s} style={{ fontSize: 14 }}>
                {s}
              </li>
            ))}
          </ul>
          <p className="muted">
            Cosmetic deviations from the bounded schema. Deliberately kept separate from the column
            above, and they never trigger a fallback — reporting a model as having failed over
            formatting would misstate what happened.
          </p>
        </div>
      )}

      {d.validation_error && (
        <div className="panel flag" style={{ marginTop: 16 }}>
          <h3>Validation error</h3>
          <pre>{d.validation_error}</pre>
        </div>
      )}
    </>
  );
}

function Raw({ d }: { d: DecisionRow }) {
  return (
    <>
      <div className="yard" />
      <h2>Everything sent and returned</h2>
      <p className="sub">Unedited · the response is stored before any parsing or repair</p>

      <details className="disclose" open>
        <summary>Raw response, exactly as the model emitted it</summary>
        <pre>{d.raw_response ?? '(empty — the model returned no content)'}</pre>
      </details>

      <details className="disclose">
        <summary>System prompt ({d.prompt_version})</summary>
        <pre>{d.system_prompt}</pre>
      </details>

      <details className="disclose">
        <summary>User prompt — rulebook, memory and data block ({d.user_prompt.length.toLocaleString()} characters)</summary>
        <pre>{d.user_prompt}</pre>
      </details>

      {d.parsed_json != null && (
        <details className="disclose">
          <summary>Parsed result, after schema validation</summary>
          <pre>{JSON.stringify(d.parsed_json, null, 2)}</pre>
        </details>
      )}
    </>
  );
}

function Provenance({ d }: { d: DecisionRow }) {
  const rows: [string, string][] = [
    ['Decision id', d.id],
    ['Model', `${d.models?.display_name ?? '—'} (${d.models?.lab ?? '—'})`],
    ['Prompt version', d.prompt_version],
    ['Rulebook version', d.rulebook_version],
    ['Context hash', d.context_hash],
    ['Dossier hash', d.dossier_hash ?? 'not attached'],
    ['Recorded at', new Date(d.created_at).toISOString()],
  ];

  return (
    <>
      <div className="yard" />
      <h2>Provenance</h2>
      <p className="sub">What identifies this call and what it was given</p>

      <div className="scroll compact">
        <table>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="l muted" style={{ width: 190 }}>
                  {k}
                </td>
                <td className="l wrap-cell" style={{ wordBreak: 'break-all' }}>
                  <code>{v}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="lede-copy" style={{ marginTop: 14 }}>
        The context hash covers the data block alone. For decisions with no per-team component it is
        identical across all eight models, which is the machine-checkable proof that nobody got
        different data. For weekly decisions each model sees its own opponent, so the shared half is
        hashed separately — the limits of that claim are set out on{' '}
        <Link href="/methodology">the methodology page</Link>.
      </p>

      {d.memory_block && (
        <details className="disclose" style={{ marginTop: 16 }}>
          <summary>Memory block carried into this call</summary>
          <pre>{d.memory_block}</pre>
        </details>
      )}
    </>
  );
}
