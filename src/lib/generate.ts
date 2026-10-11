// Shared generation core — pure TS, runs in the browser worker AND the Node API server.
// Keep this free of DOM/worker globals so both consumers can import it.
import { AVAILABLE_COLUMNS, ColumnDef, expectationFor } from '../data/schema';
import { applySeed, SEED_REF_DATE } from './seed';
import { getFaker, resolveLocale, sexLabel, LocaleId } from './locale';
import { luhnValid, vinValid } from './validators';

/**
 * Version of the seed contract: for a given (seed, settings), which bytes come out.
 * Bump it whenever a change alters seeded output — `npm test` pins a hash of that output
 * and fails until both are updated together. Recorded in the manifest and share links.
 */
export const GENERATOR_VERSION = 1;

/** Leads every CSV file we write, so Excel reads non-ASCII names (German, Japanese…) as UTF-8. */
export const UTF8_BOM = '\uFEFF';

export function csvEscape(val: any): string {
  if (val === null || val === undefined) return '';
  const s = val instanceof Date ? val.toISOString() : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ---------- headers ----------
/**
 * What the output calls each column.
 *   descriptive: its real name — a detector may lean on it
 *   neutral:     col_01, col_02 … — only the values can give a column away
 *   misleading:  real names, each on a different column — a detector that trusts headers is led astray
 */
export type HeaderMode = 'descriptive' | 'neutral' | 'misleading';
export const HEADER_MODES: HeaderMode[] = ['descriptive', 'neutral', 'misleading'];

/** One header per column: display names for CSV (`name`), ids for JSON keys (`id`). */
export function headersFor(cols: ColumnDef[], mode: HeaderMode = 'descriptive', kind: 'name' | 'id' = 'name'): string[] {
  const own = cols.map(c => (kind === 'name' ? c.name : c.id));
  if (mode === 'neutral') {
    const width = Math.max(2, String(cols.length).length);
    return cols.map((_, i) => `col_${String(i + 1).padStart(width, '0')}`);
  }
  if (mode === 'misleading') {
    // Rotate by half the width: no column keeps its own name, and most land in another category.
    const shift = Math.ceil(cols.length / 2);
    return cols.map((_, i) => own[(i + shift) % cols.length]);
  }
  return own;
}

/** Rows re-keyed for JSON output under a header mode. Descriptive rows pass through untouched. */
export function rekeyRows(rows: Record<string, any>[], cols: ColumnDef[], mode: HeaderMode = 'descriptive'): Record<string, any>[] {
  if (mode === 'descriptive') return rows;
  const keys = headersFor(cols, mode, 'id');
  return rows.map(r => Object.fromEntries(cols.map((c, i) => [keys[i], r[c.id]])));
}

// Columns a detector should fire on: the only ones density thins out.
const DETECT_IDS = new Set(AVAILABLE_COLUMNS.filter(c => expectationFor(c) === 'detect').map(c => c.id));

/**
 * Build one row. Row-consistent fields (name/dob/age/gender) come from a shared ctx.
 * `density` (1–100) is the share of rows in which a should-fire column holds the real value;
 * the rest get harmless filler, to test scanners that sample rows instead of reading them all.
 */
export function makeRow(cols: ColumnDef[], sparsity: number, locale: LocaleId, density = 100): Record<string, any> {
  // 'mix' is resolved once per row so the phone number matches the row's name/address.
  const rowLocale = resolveLocale(locale);
  const f = getFaker(rowLocale);
  const dob = f.date.birthdate({ min: 18, max: 80, mode: 'age' });
  // Age as of faker's reference date (the seed's fixed "now", else the clock), in UTC like
  // the dob column: one year less until this year's birthday has passed.
  const ref = f.defaultRefDate();
  const monthDay = (d: Date) => d.getUTCMonth() * 100 + d.getUTCDate();
  const sex = f.helpers.arrayElement(['female', 'male'] as const);
  // Straight from the gendered list: `person.firstName(sex)` blends in Faker's generic names,
  // and ~6% of those belong to the other list.
  const gendered = f.definitions.person.first_name[sex];
  const fctx: any = {
    firstName: gendered ? f.helpers.arrayElement(gendered) : f.person.firstName(sex),
    lastName: f.person.lastName(sex),
    gender: sexLabel(rowLocale, sex),
    dob,
    age: ref.getUTCFullYear() - dob.getUTCFullYear() - (monthDay(ref) < monthDay(dob) ? 1 : 0),
    faker: f,
    locale: rowLocale,
  };
  const row: Record<string, any> = {};
  for (const col of cols) {
    row[col.id] = sparsity > 0 && Math.random() < sparsity / 100 ? null
      : density < 100 && DETECT_IDS.has(col.id) && Math.random() >= density / 100 ? f.commerce.productName()
      : col.generate(fctx);
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
  density?: number;
  headers?: HeaderMode;
}

/** The rows of one stream chunk. Unseeded runs keep the caller's entropy. */
export function generateChunkRows(cols: ColumnDef[], o: Omit<ChunkOptions, 'format' | 'headers'>): Record<string, any>[] {
  if (o.seed !== null) applySeed(chunkSeed(o.seed, o.chunk));
  const out = new Array(o.rows);
  for (let i = 0; i < o.rows; i++) out[i] = makeRow(cols, o.sparsity, o.locale, o.density);
  return out;
}

/** Serialized text of one stream chunk (no header). */
export function generateChunkText(cols: ColumnDef[], o: ChunkOptions): string {
  let buf = '';
  for (const r of rekeyRows(generateChunkRows(cols, o), cols, o.format === 'ndjson' ? o.headers : 'descriptive')) {
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
  density?: number;
}

/** Whole-array generation (in-memory). Applies the seed, then builds rowCount rows. */
export function generateRows(opts: GenerateOptions): Record<string, any>[] {
  applySeed(opts.seed ?? null);
  const cols = AVAILABLE_COLUMNS.filter(c => opts.columnIds.includes(c.id));
  const sparsity = opts.sparsity ?? 0;
  const locale = opts.locale ?? 'en';
  const out = new Array(opts.rowCount);
  for (let i = 0; i < opts.rowCount; i++) out[i] = makeRow(cols, sparsity, locale, opts.density);
  return out;
}

/** CSV with a header row: column display names, unless a header mode says otherwise. */
export function rowsToCSV(rows: Record<string, any>[], cols: ColumnDef[], headers: HeaderMode = 'descriptive'): string {
  const header = headersFor(cols, headers).map(csvEscape).join(',');
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
  // seeded dates hang off SEED_REF_DATE, never the wall clock; age agrees with dob.
  const ref = SEED_REF_DATE.getTime();
  const DAY = 86_400_000;
  for (const r of generateRows({ columnIds: ['dob', 'age', 'createdAt', 'hireDate', 'graduationYear'], rowCount: 500, seed: 3 })) {
    const made = Date.parse(r.createdAt);
    if (made > ref || made < ref - 30 * DAY) throw new Error(`FAIL: seeded createdAt off the reference date: ${r.createdAt}`);
    if (Date.parse(r.hireDate) > ref || r.graduationYear < 2026 || r.graduationYear > 2030) throw new Error('FAIL: seeded hireDate/graduationYear off the reference date');
    const dob = new Date(r.dob);
    const birthdayThisYear = Date.UTC(dob.getUTCFullYear() + r.age, dob.getUTCMonth(), dob.getUTCDate());
    const birthdayNextYear = Date.UTC(dob.getUTCFullYear() + r.age + 1, dob.getUTCMonth(), dob.getUTCDate());
    if (birthdayThisYear > ref || birthdayNextYear <= ref || r.age < 18 || r.age > 80) throw new Error(`FAIL: age ${r.age} vs dob ${r.dob}`);
  }
  // first name is drawn for the row's gender (checked where Faker's lists are unambiguous).
  for (const loc of ['en', 'de', 'ja'] as const) {
    const names = getFaker(loc).definitions.person.first_name;
    const male = new Set(names.male), female = new Set(names.female);
    for (const r of generateRows({ columnIds: ['firstName', 'gender'], rowCount: 500, seed: 11, locale: loc })) {
      const wrongList = r.gender === sexLabel(loc, 'female') ? male : female;
      const ownList = r.gender === sexLabel(loc, 'female') ? female : male;
      if (wrongList.has(r.firstName) && !ownList.has(r.firstName)) throw new Error(`FAIL: ${loc} name ${r.firstName} vs gender ${r.gender}`);
    }
  }
  // header modes: neutral hides every name, misleading leaves no column under its own
  const many = AVAILABLE_COLUMNS.slice(0, 7);
  if (headersFor(many, 'neutral').join() !== 'col_01,col_02,col_03,col_04,col_05,col_06,col_07') throw new Error('FAIL: neutral headers');
  if (headersFor(AVAILABLE_COLUMNS, 'neutral')[110] !== 'col_111') throw new Error('FAIL: neutral header width');
  for (const n of [2, 3, 7, AVAILABLE_COLUMNS.length]) {
    const c = AVAILABLE_COLUMNS.slice(0, n), h = headersFor(c, 'misleading');
    if (h.some((x, i) => x === c[i].name) || [...h].sort().join() !== c.map(x => x.name).sort().join()) throw new Error(`FAIL: misleading headers (${n} columns)`);
  }
  if (!rowsToCSV(rows, cols, 'neutral').startsWith('col_01,col_02\n') || !rowsToCSV(rows, cols, 'misleading').startsWith('SSN,First Name\n')) throw new Error('FAIL: CSV header modes');
  const nd = JSON.parse(generateChunkText(cols, { ...co, format: 'ndjson', chunk: 3, headers: 'misleading' }).split('\n')[0]);
  const plain = JSON.parse(generateChunkText(cols, { ...co, format: 'ndjson', chunk: 3 }).split('\n')[0]);
  if (nd.ssn !== plain.firstName || nd.firstName !== plain.ssn) throw new Error('FAIL: NDJSON keys under misleading headers');
  // density: should-fire columns carry the real value in that share of rows; other columns are untouched
  const thin = generateRows({ columnIds: ['ssn', 'createdAt', 'aadhaar_invalid'], rowCount: 4000, seed: 13, density: 25 });
  const share = thin.filter(r => /^\d{3}-\d{2}-\d{4}$/.test(r.ssn)).length / thin.length;
  if (share < 0.22 || share > 0.28) throw new Error(`FAIL: density 25% gave ${(share * 100).toFixed(1)}% real SSNs`);
  if (thin.some(r => typeof r.ssn !== 'string' || r.ssn === '')) throw new Error('FAIL: density filler must be a non-empty string');
  if (thin.some(r => Number.isNaN(Date.parse(r.createdAt)) || !/^\d{12}$/.test(r.aadhaar_invalid))) throw new Error('FAIL: density must leave other columns alone');
  // checksum columns hold their contract; near-miss columns never accidentally pass.
  for (const r of generateRows({ columnIds: ['creditCard', 'creditCard_invalid', 'vin', 'vin_invalid'], rowCount: 2000, seed: 5 })) {
    if (!luhnValid(r.creditCard) || luhnValid(r.creditCard_invalid)) throw new Error(`FAIL: credit card Luhn: ${r.creditCard} / ${r.creditCard_invalid}`);
    if (!vinValid(r.vin) || vinValid(r.vin_invalid)) throw new Error(`FAIL: VIN checksum: ${r.vin} / ${r.vin_invalid}`);
  }
  console.log('generate: all self-checks passed');
}
