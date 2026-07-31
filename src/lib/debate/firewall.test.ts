import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The firewall, asserted rather than trusted.
 *
 * The league measures eight models reasoning INDEPENDENTLY. Chalk or Walk deliberately
 * shows every model what the other seven think. If those two ever touch — if a debate
 * transcript reaches a league prompt, a memory block, or a DATA block — the season
 * stops measuring independent reasoning and the central claim of the project is gone,
 * silently and unrecoverably, because there is no way to un-see it after the fact.
 *
 * A convention would not survive a year of edits, so it is a test. It fails loudly the
 * first time somebody adds the import that would quietly destroy the experiment.
 */

const ROOT = join(process.cwd(), 'src');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** Directories that constitute "the league" — the parts that build model-facing league calls. */
const LEAGUE_DIRS = ['lib/prompt', 'lib/engine', 'lib/decisions', 'lib/preseason', 'lib/scoring'];

describe('debate/league firewall', () => {
  it('no league module imports from the debate module', () => {
    const offenders: string[] = [];

    for (const relative of LEAGUE_DIRS) {
      const dir = join(ROOT, relative);
      let files: string[];
      try {
        files = filesUnder(dir);
      } catch {
        continue; // directory does not exist in this checkout
      }
      for (const file of files) {
        const source = readFileSync(file, 'utf8');
        if (/from\s+['"](@\/lib\/debate|\.{1,2}\/.*debate)/.test(source)) {
          offenders.push(file.replace(process.cwd() + '/', ''));
        }
      }
    }

    expect(offenders, `league modules importing debate code: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the debate module never imports league decision assembly', () => {
    const offenders: string[] = [];
    // The debate legitimately reads league CONFIG — the scoring rules are shared
    // reality and the models need them for context. What it must never touch is
    // anything that ASSEMBLES a league decision or carries league state.
    const forbidden = /from\s+['"]@\/lib\/(prompt|decisions|engine)\//;

    for (const file of filesUnder(join(ROOT, 'lib/debate'))) {
      const source = readFileSync(file, 'utf8');
      if (forbidden.test(source)) offenders.push(file.replace(process.cwd() + '/', ''));
    }

    expect(offenders, `debate modules importing league assembly: ${offenders.join(', ')}`).toEqual([]);
  });
});
