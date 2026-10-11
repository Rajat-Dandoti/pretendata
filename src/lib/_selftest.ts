// Runs every module's _selfCheck under `npm test`. Keeps the checks out of the
// browser bundle and actually executes them (they never ran before).
import { readFileSync } from 'node:fs';
import { AVAILABLE_COLUMNS, PRESETS } from '../data/schema';
import { _selfCheck as validators } from './validators';
import { _selfCheck as manifest } from './manifest';
import { _selfCheck as share } from './share';
import { _selfCheck as zip } from './zip';
import { _selfCheck as generate } from './generate';
import { _selfCheck as frameworks } from './frameworks';
import { _selfCheck as reference } from './reference';
import { _selfCheck as nesting } from './nesting';
import { _selfCheck as streaming } from './streaming';

for (const f of [validators, manifest, share, zip, generate, frameworks, reference, nesting, streaming]) await f();
// COLUMNS.md claims to mirror the schema — hold it to that.
const doc = readFileSync(new URL('../../COLUMNS.md', import.meta.url), 'utf8');
const undocumented = [
  ...AVAILABLE_COLUMNS.filter(c => !doc.includes(`\`${c.id}\``)).map(c => c.id),
  ...Object.keys(PRESETS).filter(p => !doc.includes(p)),
];
if (undocumented.length) throw new Error(`FAIL: missing from COLUMNS.md: ${undocumented.join(', ')}`);

console.log('all self-checks passed');
