// Runs every module's _selfCheck under `npm test`. Keeps the checks out of the
// browser bundle and actually executes them (they never ran before).
import { readFileSync } from 'node:fs';
import { AVAILABLE_COLUMNS, PRESETS } from '../data/schema';
import { _selfCheck as validators } from './validators';
import { _selfCheck as manifest } from './manifest';
import { _selfCheck as share } from './share';
import { _selfCheck as zip } from './zip';
import { _selfCheck as generate, generateRows, generateChunkText, rowsToSQL, sqlColumns, sqlCreateTable, HEADER_MODES, SQL_TABLE } from './generate';
import { checkSeedContract } from './_seedcontract';
import { _selfCheck as frameworks } from './frameworks';
import { _selfCheck as reference } from './reference';
import { _selfCheck as nesting } from './nesting';
import { _selfCheck as streaming } from './streaming';
import { _selfCheck as scorecard } from './scorecard';
import { _selfCheck as identify } from './identify';
import { _selfCheck as text } from './text';

for (const f of [validators, manifest, share, zip, generate, frameworks, reference, nesting, streaming, scorecard, identify, text]) await f();
checkSeedContract();

// SQL export, loaded into a real engine (Node's built-in SQLite): every value must come back
// exactly, hostile strings included, under every header mode and across stream chunks.
{
  const { DatabaseSync } = await import('node:sqlite');
  const cols = AVAILABLE_COLUMNS;
  const rows = generateRows({ columnIds: cols.map(c => c.id), rowCount: 1200, seed: 31, sparsity: 10, locale: 'mix', formatting: 'evasive' });
  const back = (sql: string) => { const db = new DatabaseSync(':memory:'); db.exec(sql); return db.prepare(`SELECT * FROM ${SQL_TABLE} ORDER BY rowid`).all() as Record<string, unknown>[]; };
  for (const mode of HEADER_MODES) {
    const names = sqlColumns(cols, mode);
    if (new Set(names).size !== names.length || names.some(n => !/^[a-z][a-z0-9_]*$/.test(n))) throw new Error(`FAIL: SQL column names (${mode})`);
    const got = back(rowsToSQL(rows, cols, mode));
    const same = got.length === rows.length && got.every((g, i) => cols.every((c, j) => g[names[j]] === rows[i][c.id]));
    if (!same) throw new Error(`FAIL: SQL dump does not load back identically (${mode} headers)`);
  }
  const o = { seed: 31, rows: 700, sparsity: 0, locale: 'en' as const, format: 'sql' as const };
  const streamed = back(sqlCreateTable(cols) + generateChunkText(cols, { ...o, chunk: 0 }) + generateChunkText(cols, { ...o, chunk: 1 }));
  if (streamed.length !== 1400) throw new Error('FAIL: streamed SQL chunks do not load as one table');
  console.log('sql: dump loads back identically in SQLite');
}

// COLUMNS.md claims to mirror the schema — hold it to that.
const doc = readFileSync(new URL('../../COLUMNS.md', import.meta.url), 'utf8');
const undocumented = [
  ...AVAILABLE_COLUMNS.filter(c => !doc.includes(`\`${c.id}\``)).map(c => c.id),
  ...Object.keys(PRESETS).filter(p => !doc.includes(p)),
];
if (undocumented.length) throw new Error(`FAIL: missing from COLUMNS.md: ${undocumented.join(', ')}`);

console.log('all self-checks passed');
