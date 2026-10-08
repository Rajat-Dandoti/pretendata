// Shared generation core — pure TS, runs in the browser worker AND the Node API server.
// Keep this free of DOM/worker globals so both consumers can import it.
import { AVAILABLE_COLUMNS, ColumnDef } from '../data/schema';
import { applySeed } from './seed';
import { getFaker, resolveLocale, LocaleId } from './locale';

export function csvEscape(val: any): string {
  if (val === null || val === undefined) return '';
  const s = val instanceof Date ? val.toISOString() : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build one row. Row-consistent fields (name/dob/age/gender) come from a shared ctx. */
export function makeRow(cols: ColumnDef[], sparsity: number, locale: LocaleId): Record<string, any> {
  // 'mix' is resolved once per row so the phone number matches the row's name/address.
  const rowLocale = resolveLocale(locale);
  const f = getFaker(rowLocale);
  const dob = f.date.birthdate({ min: 18, max: 80, mode: 'age' });
  const fctx: any = {
    firstName: f.person.firstName(),
    lastName: f.person.lastName(),
    gender: f.person.sex(),
    dob,
    age: new Date().getFullYear() - dob.getFullYear(),
    faker: f,
    locale: rowLocale,
  };
  const row: Record<string, any> = {};
  for (const col of cols) {
    row[col.id] = sparsity > 0 && Math.random() < sparsity / 100 ? null : col.generate(fctx);
  }
  return row;
}

// ---------- streaming chunks (large datasets) ----------
/** Rows per stream chunk. Part of the seed contract: changing it changes seeded output. */
export const STREAM_CHUNK_ROWS = 5_000;

/**
 * Every chunk gets its own seed, so chunks can be generated on different workers, in any
 * order, and the file still reproduces byte-for-byte from (seed, row count).
 */
export function chunkSeed(seed: number, chunk: number): number {
  return (Math.imul(seed, 0x9E3779B1) + chunk) >>> 0;
}

export interface ChunkOptions {
  seed: number | null;
  chunk: number;
  rows: number;
  sparsity: number;
  locale: LocaleId;
  format: 'csv' | 'ndjson';
}

/** Serialized text of one stream chunk (no header). Unseeded runs keep the caller's entropy. */
export function generateChunkText(cols: ColumnDef[], o: ChunkOptions): string {
  if (o.seed !== null) applySeed(chunkSeed(o.seed, o.chunk));
  let buf = '';
  for (let i = 0; i < o.rows; i++) {
    const r = makeRow(cols, o.sparsity, o.locale);
    buf += (o.format === 'csv' ? cols.map(c => csvEscape(r[c.id])).join(',') : JSON.stringify(r)) + '\n';
  }
  return buf;
}

export interface GenerateOptions {
  columnIds: string[];
  rowCount: number;
  sparsity?: number;
  seed?: number | null;
  locale?: LocaleId;
}

/** Whole-array generation (in-memory). Applies the seed, then builds rowCount rows. */
export function generateRows(opts: GenerateOptions): Record<string, any>[] {
  applySeed(opts.seed ?? null);
  const cols = AVAILABLE_COLUMNS.filter(c => opts.columnIds.includes(c.id));
  const sparsity = opts.sparsity ?? 0;
  const locale = opts.locale ?? 'en';
  const out = new Array(opts.rowCount);
  for (let i = 0; i < opts.rowCount; i++) out[i] = makeRow(cols, sparsity, locale);
  return out;
}

/** CSV with a header row of column display names. */
export function rowsToCSV(rows: Record<string, any>[], cols: ColumnDef[]): string {
  const header = cols.map(c => csvEscape(c.name)).join(',');
  const body = rows.map(r => cols.map(c => csvEscape(r[c.id])).join(',')).join('\n');
  return header + '\n' + body + (rows.length ? '\n' : '');
}

export function rowsToNdjson(rows: Record<string, any>[]): string {
  return rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
}

// ---------- self-check (run via `npm test`) ----------
export function _selfCheck() {
  const rows = generateRows({ columnIds: ['firstName', 'ssn'], rowCount: 5, seed: 1 });
  if (rows.length !== 5) throw new Error('FAIL: generateRows row count');
  if (!('firstName' in rows[0]) || !('ssn' in rows[0])) throw new Error('FAIL: generateRows keys');
  // determinism: same seed ⇒ identical first row
  const again = generateRows({ columnIds: ['firstName', 'ssn'], rowCount: 1, seed: 1 });
  if (JSON.stringify(again[0]) !== JSON.stringify(rows[0])) throw new Error('FAIL: seed determinism');
  const cols = AVAILABLE_COLUMNS.filter(c => ['firstName', 'ssn'].includes(c.id));
  if (!rowsToCSV(rows, cols).startsWith('First Name,SSN\n')) throw new Error('FAIL: CSV header');
  // chaos columns: still string-valued and seed-deterministic; CSV escaping survives embedded commas/quotes/newlines.
  const chaosIds = ['chaosSqli', 'chaosCsvBreak'];
  const c1 = generateRows({ columnIds: chaosIds, rowCount: 3, seed: 7 });
  const c2 = generateRows({ columnIds: chaosIds, rowCount: 3, seed: 7 });
  if (JSON.stringify(c1) !== JSON.stringify(c2)) throw new Error('FAIL: chaos seed determinism');
  const chaosCols = AVAILABLE_COLUMNS.filter(c => chaosIds.includes(c.id));
  const csv = rowsToCSV(c1, chaosCols);
  if (csv.split('\n')[0] !== 'SQL Injection,CSV Breaker') throw new Error('FAIL: chaos CSV header');
  // stream chunks: a chunk depends only on (seed, chunk index), never on what ran before it.
  const co = { seed: 42, rows: 4, sparsity: 20, locale: 'mix' as const, format: 'csv' as const };
  const k3 = generateChunkText(cols, { ...co, chunk: 3 });
  const k4 = generateChunkText(cols, { ...co, chunk: 4 });
  if (generateChunkText(cols, { ...co, chunk: 3 }) !== k3) throw new Error('FAIL: chunk determinism');
  if (k3 === k4) throw new Error('FAIL: chunks must differ');
  if (k3.split('\n').length !== 5 || !k3.endsWith('\n')) throw new Error('FAIL: chunk row count');
  console.log('generate: all self-checks passed');
}
