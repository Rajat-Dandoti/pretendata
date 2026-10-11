// Runs every module's _selfCheck under `npm test`. Keeps the checks out of the
// browser bundle and actually executes them (they never ran before).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AVAILABLE_COLUMNS, PRESETS } from '../data/schema';
import { _selfCheck as validators } from './validators';
import { _selfCheck as manifest } from './manifest';
import { _selfCheck as share } from './share';
import { _selfCheck as zip } from './zip';
import { _selfCheck as generate, generateRows, generateChunkText, GENERATOR_VERSION } from './generate';
import { LOCALES } from './locale';
import { _selfCheck as frameworks } from './frameworks';
import { _selfCheck as reference } from './reference';
import { _selfCheck as nesting } from './nesting';
import { _selfCheck as streaming } from './streaming';
import { _selfCheck as scorecard } from './scorecard';

for (const f of [validators, manifest, share, zip, generate, frameworks, reference, nesting, streaming, scorecard]) await f();
// Seed contract: the same seed and settings must keep producing the same bytes. This hashes
// seeded output for every column and locale, on both generation paths.
// If it fails and the change in output is intended: bump GENERATOR_VERSION in generate.ts,
// then set SEED_CONTRACT below to the new version and the hash printed in the error.
const SEED_CONTRACT = { version: 1, hash: '66b399239623856d' };
const contract = createHash('sha256');
for (const { id: locale } of LOCALES) {
  contract.update(JSON.stringify(generateRows({ columnIds: AVAILABLE_COLUMNS.map(c => c.id), rowCount: 200, seed: 77, sparsity: 10, locale })));
  contract.update(generateChunkText(AVAILABLE_COLUMNS, { seed: 77, chunk: 5, rows: 200, sparsity: 10, locale, format: 'ndjson' }));
}
const contractHash = contract.digest('hex').slice(0, 16);
if (GENERATOR_VERSION !== SEED_CONTRACT.version || contractHash !== SEED_CONTRACT.hash) {
  throw new Error(`FAIL: seeded output changed (version ${GENERATOR_VERSION}, hash ${contractHash}; pinned version ${SEED_CONTRACT.version}, hash ${SEED_CONTRACT.hash}). ` +
    'If intended, bump GENERATOR_VERSION and update SEED_CONTRACT in _selftest.ts.');
}
console.log('seed contract: output matches the pinned hash');

// COLUMNS.md claims to mirror the schema — hold it to that.
const doc = readFileSync(new URL('../../COLUMNS.md', import.meta.url), 'utf8');
const undocumented = [
  ...AVAILABLE_COLUMNS.filter(c => !doc.includes(`\`${c.id}\``)).map(c => c.id),
  ...Object.keys(PRESETS).filter(p => !doc.includes(p)),
];
if (undocumented.length) throw new Error(`FAIL: missing from COLUMNS.md: ${undocumented.join(', ')}`);

console.log('all self-checks passed');
