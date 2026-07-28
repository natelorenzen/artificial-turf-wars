/**
 * The cited-fields post-pass (SPEC §7.1).
 *
 * Turns "the model said it weighed the matchup" into "the model cited
 * `opp_position_rank_allowed: 28`, and that value is real." It catches the failure
 * mode the DATA RULE exists to prevent — a model reasoning from stale training
 * memory instead of the data in front of it.
 *
 * Deterministic string/number matching against the frozen DATA block. Never a model
 * call (SPEC §8.4).
 */

export interface CitationCheck {
  citedFields: string[];
  unsupportedClaims: string[];
}

/** Numbers this small are almost always prose ("2 of my 3 backs"), not data claims. */
const NUMERIC_CLAIM_FLOOR = 10;

export function collectDataIndex(data: unknown): {
  fields: Set<string>;
  numbers: Set<string>;
  strings: Set<string>;
} {
  const fields = new Set<string>();
  const numbers = new Set<string>();
  const strings = new Set<string>();

  const walk = (node: unknown) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        fields.add(key);
        walk(value);
      }
      return;
    }
    if (typeof node === 'number' && Number.isFinite(node)) {
      numbers.add(normalizeNumber(node));
      return;
    }
    if (typeof node === 'string') strings.add(node.toLowerCase());
  };

  walk(data);
  return { fields, numbers, strings };
}

/** 14.80 and 14.8 are the same claim; 14 and 14.0 are too. */
function normalizeNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

export function checkCitations(keyFactors: string[], data: unknown): CitationCheck {
  const index = collectDataIndex(data);
  const citedFields = new Set<string>();
  const unsupportedClaims: string[] = [];

  for (const factor of keyFactors) {
    let supported = false;

    // Field names, however the model wrote them: snake_case, or spaced words that
    // collapse onto a real key.
    for (const token of factor.match(/[A-Za-z][A-Za-z0-9_]{2,}/g) ?? []) {
      const candidate = token.toLowerCase();
      if (index.fields.has(candidate)) {
        citedFields.add(candidate);
        supported = true;
      }
    }
    const collapsed = factor.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    for (const field of index.fields) {
      if (collapsed.includes(field)) {
        citedFields.add(field);
        supported = true;
      }
    }

    // Numeric claims must appear somewhere in the DATA block.
    const numbers = (factor.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
    const checkable = numbers.filter((v) => Math.abs(v) >= NUMERIC_CLAIM_FLOOR || !Number.isInteger(v));
    const missing = checkable.filter((v) => !index.numbers.has(normalizeNumber(v)));

    if (missing.length > 0) {
      unsupportedClaims.push(`${factor} — value(s) not in DATA: ${missing.join(', ')}`);
    } else if (checkable.length > 0) {
      supported = true;
    }

    // Player and team names quoted from the data also count as grounding.
    if (!supported) {
      const lower = factor.toLowerCase();
      for (const value of index.strings) {
        if (value.length >= 4 && lower.includes(value)) {
          supported = true;
          break;
        }
      }
    }

    if (!supported) {
      unsupportedClaims.push(`${factor} — cites no DATA field, value, or name`);
    }
  }

  return { citedFields: [...citedFields].sort(), unsupportedClaims };
}
