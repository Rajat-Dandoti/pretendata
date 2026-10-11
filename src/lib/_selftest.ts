// Runs every module's _selfCheck under `npm test`. Keeps the checks out of the
// browser bundle and actually executes them (they never ran before).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BENCHMARKS, BENCHMARK_GENERATOR, BENCHMARK_VERSION, matchBenchmark } from '../data/benchmarks';
import { AVAILABLE_COLUMNS, PRESETS } from '../data/schema';
import { _selfCheck as validators } from './validators';
import { _selfCheck as manifest } from './manifest';
import { _selfCheck as share } from './share';
import { _selfCheck as zip } from './zip';
import { _selfCheck as generate, generateRows, generateChunkText, rowsToCSV, rowsToNdjson, rowsToSQL, sqlColumns, sqlCreateTable, GENERATOR_VERSION, HEADER_MODES, IN_MEMORY_THRESHOLD, SQL_TABLE, UTF8_BOM } from './generate';
import { rowsFromManifest } from './manifest';
import { checkSeedContract } from './_seedcontract';
import { _selfCheck as frameworks } from './frameworks';
import { _selfCheck as reference } from './reference';
import { _selfCheck as nesting } from './nesting';
import { _selfCheck as streaming } from './streaming';
import { _selfCheck as scorecard } from './scorecard';
import { _selfCheck as identify } from './identify';
import { _selfCheck as text } from './text';
import { _selfCheck as fixtures } from './fixtures';
import { _selfCheck as maskcheck } from './maskcheck';

for (const f of [validators, manifest, share, zip, generate, frameworks, reference, nesting, streaming, scorecard, identify, text, fixtures, maskcheck]) await f();
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

// Command-line tool, run in process: for the same settings it must write what the app writes,
// on both sides of the in-memory threshold, and the answer key it writes must rebuild the data.
{
  const { main } = await import('../../bin/pretendata');
  const run = async (...argv: string[]) => {
    let out = ''; const files: Record<string, string> = {}; const errors: string[] = [];
    const code = await main(argv, { write: c => { out += c; }, writeFile: (p, c) => { files[p] = c; } }, l => errors.push(l));
    return { code, out, files, errors };
  };
  const ids = ['firstName', 'ssn', 'iban'], cols = AVAILABLE_COLUMNS.filter(c => ids.includes(c.id));
  const small = await run('--columns', ids.join(','), '--rows', '300', '--seed', '5', '--sparsity', '10', '--locale', 'de', '--answer-key', 'k.json');
  if (small.code !== 0 || small.out !== UTF8_BOM + rowsToCSV(generateRows({ columnIds: ids, rowCount: 300, seed: 5, sparsity: 10, locale: 'de' }), cols)) throw new Error('FAIL: CLI in-memory CSV differs from the app\'s');
  if (JSON.stringify(rowsFromManifest(JSON.parse(small.files['k.json']))) !== JSON.stringify(generateRows({ columnIds: ids, rowCount: 300, seed: 5, sparsity: 10, locale: 'de' }))) throw new Error('FAIL: CLI answer key does not rebuild the data');
  const big = await run('--columns', ids.join(','), '--rows', String(IN_MEMORY_THRESHOLD + 1), '--seed', '5', '--format', 'ndjson', '--answer-key', 'k.json');
  const key = JSON.parse(big.files['k.json']);
  if (key.seeding !== 'chunked' || big.out !== rowsToNdjson(rowsFromManifest(key))) throw new Error('FAIL: CLI streamed output differs from the answer key\'s rows');
  const preset = await run('--preset', 'India PII', '--rows', '5', '--seed', '1', '--format', 'json', '--no-bom');
  if (JSON.stringify(JSON.parse(preset.out)) !== JSON.stringify(generateRows({ columnIds: PRESETS['India PII'], rowCount: 5, seed: 1, locale: 'en_IN' }))) throw new Error('FAIL: CLI preset should carry its locale');
  const sql = await run('--columns', 'ssn', '--rows', '2', '--seed', '1', '--format', 'sql', '--headers', 'neutral');
  if (!sql.out.startsWith('CREATE TABLE pretendata (\n  col_01 TEXT\n);\nINSERT INTO pretendata (col_01) VALUES')) throw new Error('FAIL: CLI SQL');
  const text = await run('text', '--pack', 'prompt', '--count', '3', '--seed', '2');
  if (text.out.trim().split('\n').length !== 3 || !JSON.parse(text.out.split('\n')[0]).messages) throw new Error('FAIL: CLI text');
  if ((await run('list', 'columns')).out.trim().split('\n').length !== AVAILABLE_COLUMNS.length) throw new Error('FAIL: CLI list columns');
  for (const bad of [['--columns', 'nope'], ['--preset', 'x'], ['--rows', '0', '--columns', 'ssn'], ['--bogus'], ['--columns', 'ssn', '--format', 'json', '--rows', '200000'], []]) {
    const r = await run(...bad);
    if (r.code !== 2 || r.out !== '' || r.errors.length !== 1) throw new Error(`FAIL: CLI should reject ${JSON.stringify(bad)} with exit code 2`);
  }
  // Standard benchmarks: every one still reproduces its pinned bytes, and is recognised from its answer key.
  if (GENERATOR_VERSION !== BENCHMARK_GENERATOR) {
    throw new Error(`FAIL: benchmark version ${BENCHMARK_VERSION} was pinned at generator version ${BENCHMARK_GENERATOR}, but GENERATOR_VERSION is ${GENERATOR_VERSION}. ` +
      'Published benchmarks can no longer be reproduced: add a new benchmark version in src/data/benchmarks.ts (bump BENCHMARK_VERSION and BENCHMARK_GENERATOR, re-pin the hashes).');
  }
  const known = new Set(AVAILABLE_COLUMNS.map(c => c.id));
  for (const b of BENCHMARKS) {
    const missing = b.columnIds.filter(id => !known.has(id));
    if (missing.length) throw new Error(`FAIL: benchmark ${b.id} lists unknown columns: ${missing}`);
    const made = await run('benchmark', b.id, '--answer-key', 'b.json');
    const sha = createHash('sha256').update(made.out).digest('hex');
    if (sha !== b.sha256) throw new Error(`FAIL: benchmark ${b.id} no longer produces its pinned file (got sha256 ${sha})`);
    if (matchBenchmark(JSON.parse(made.files['b.json']))?.id !== b.id) throw new Error(`FAIL: benchmark ${b.id} is not recognised from its own answer key`);
  }
  if (matchBenchmark({ ...JSON.parse((await run('benchmark', 'india', '--answer-key', 'b.json')).files['b.json']), seed: 5 })) throw new Error('FAIL: a different seed is not the benchmark');
  console.log('cli: output matches the app on both sides of the in-memory threshold');
  console.log(`benchmarks: ${BENCHMARKS.length} standard datasets reproduce their pinned files (v${BENCHMARK_VERSION})`);
}

// COLUMNS.md claims to mirror the schema — hold it to that.
const doc = readFileSync(new URL('../../COLUMNS.md', import.meta.url), 'utf8');
const undocumented = [
  ...AVAILABLE_COLUMNS.filter(c => !doc.includes(`\`${c.id}\``)).map(c => c.id),
  ...Object.keys(PRESETS).filter(p => !doc.includes(p)),
];
if (undocumented.length) throw new Error(`FAIL: missing from COLUMNS.md: ${undocumented.join(', ')}`);

console.log('all self-checks passed');
