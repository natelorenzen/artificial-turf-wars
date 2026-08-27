import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The firewall, asserted rather than trusted.
 *
 * The league measures eight models reasoning INDEPENDENTLY. The report cards hand every
 * model a ranking of all eight rosters, its own included. If those two ever touch — if
 * a grade, a ranking, or a self-identification reaches a league prompt, memory block or
 * DATA block — then a model setting a Week 3 lineup is doing it having been told that
 * seven rivals rated its draft last, and no later week can be read as independent
 * reasoning again. There is no way to un-see it after the fact.
 *
 * A convention would not survive a year of edits, so it is a test.
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

/** The parts that build model-facing league calls. */
const LEAGUE_DIRS = ['lib/prompt', 'lib/engine', 'lib/decisions', 'lib/preseason', 'lib/scoring', 'lib/weekly'];

describe('grades/league firewall', () => {
  it('no league module imports from the grades module', () => {
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
        if (/from\s+['"](@\/lib\/grades|\.{1,2}\/.*grades)/.test(source)) {
          offenders.push(file.replace(process.cwd() + '/', ''));
        }
      }
    }

    expect(offenders, `league modules importing grades code: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the grades module never imports league decision assembly', () => {
    const offenders: string[] = [];
    // Reading league CONFIG is legitimate and necessary — the rules are shared reality
    // and a grader needs them. What must never be touched is anything that ASSEMBLES a
    // league decision or carries league state.
    const forbidden = /from\s+['"]@\/lib\/(prompt|decisions|engine|weekly)\//;

    for (const file of filesUnder(join(ROOT, 'lib/grades'))) {
      const source = readFileSync(file, 'utf8');
      if (forbidden.test(source)) offenders.push(file.replace(process.cwd() + '/', ''));
    }

    expect(offenders, `grades modules importing league assembly: ${offenders.join(', ')}`).toEqual([]);
  });
});
