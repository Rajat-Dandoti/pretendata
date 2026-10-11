// The seed contract: the same seed and settings must keep producing the same bytes.
// seed-contract.json pins a hash of seeded output per column, plus one over all of them together
// (which also covers the shared row context and column order). Node only.
//
//   npm test            fails if pinned output changed, naming the columns
//   npm run pin-seed    records new columns; refuses to overwrite changed ones until
//                       GENERATOR_VERSION is bumped, so a contract break is always deliberate
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AVAILABLE_COLUMNS } from '../data/schema';
import { generateRows, generateChunkText, GENERATOR_VERSION } from './generate';
import { LOCALES } from './locale';

const FILE = fileURLToPath(new URL('./seed-contract.json', import.meta.url));
interface Contract { version: number; combined: string; columns: Record<string, string> }

// Seeded output for a set of columns: every locale, both generation paths.
function hashOf(ids: string[], rows: number): string {
  const cols = AVAILABLE_COLUMNS.filter(c => ids.includes(c.id));
  const h = createHash('sha256');
  for (const { id: locale } of LOCALES) {
    h.update(JSON.stringify(generateRows({ columnIds: ids, rowCount: rows, seed: 77, sparsity: 10, locale })));
    h.update(generateChunkText(cols, { seed: 77, chunk: 5, rows, sparsity: 10, locale, format: 'ndjson' }));
  }
  return h.digest('hex').slice(0, 12);
}

function compute(ids: string[]): Contract {
  return { version: GENERATOR_VERSION, combined: hashOf(ids, 200), columns: Object.fromEntries(ids.map(id => [id, hashOf([id], 60)])) };
}

/** What differs between pinned and current output, over the pinned columns only. */
function drift(pinned: Contract): string[] {
  const known = new Set(AVAILABLE_COLUMNS.map(c => c.id));
  const ids = Object.keys(pinned.columns);
  const gone = ids.filter(id => !known.has(id));
  if (gone.length) return gone.map(id => `${id} (removed)`);
  const now = compute(ids);
  const changed = ids.filter(id => now.columns[id] !== pinned.columns[id]);
  return changed.length ? changed : now.combined !== pinned.combined ? ['(row context or column order)'] : [];
}

export function checkSeedContract() {
  if (!existsSync(FILE)) throw new Error('FAIL: src/lib/seed-contract.json is missing. Run `npm run pin-seed`.');
  const pinned: Contract = JSON.parse(readFileSync(FILE, 'utf8'));
  const changed = drift(pinned);
  if (changed.length) {
    throw new Error(`FAIL: seeded output changed for: ${changed.join(', ')}. If that is intended, bump GENERATOR_VERSION in generate.ts and run \`npm run pin-seed\`.`);
  }
  if (pinned.version !== GENERATOR_VERSION) throw new Error(`FAIL: GENERATOR_VERSION is ${GENERATOR_VERSION} but the pinned contract is version ${pinned.version}. Run \`npm run pin-seed\`.`);
  const unpinned = AVAILABLE_COLUMNS.filter(c => !(c.id in pinned.columns)).map(c => c.id);
  if (unpinned.length) throw new Error(`FAIL: new columns are not pinned yet: ${unpinned.join(', ')}. Run \`npm run pin-seed\`.`);
  console.log(`seed contract: ${Object.keys(pinned.columns).length} columns match the pinned output (version ${pinned.version})`);
}

function pin() {
  const old: Contract | null = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null;
  if (old && old.version === GENERATOR_VERSION) {
    const changed = drift(old);
    if (changed.length) {
      console.error(`Refusing to re-pin: seeded output changed for ${changed.join(', ')}.\nThat breaks every dataset generated at version ${old.version}. Bump GENERATOR_VERSION in generate.ts first.`);
      process.exit(1);
    }
  }
  const next = compute(AVAILABLE_COLUMNS.map(c => c.id));
  writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n');
  const added = Object.keys(next.columns).filter(id => !old || !(id in old.columns)).length;
  console.log(`Pinned ${Object.keys(next.columns).length} columns at version ${next.version}${old ? ` (${added} new)` : ''}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) pin();
