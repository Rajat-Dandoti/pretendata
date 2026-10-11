// Scores a detection tool's column-level results against what Pretendata knows each column
// holds. Pure logic, no DOM: the Scorecard panel and `npm test` both drive it.
//
// Tools disagree on output format and vocabulary, so nothing here is tool-specific. The caller
// says which field names the column, which field is the tool's label, and how strong each
// distinct label is (detected / weak / none). Everything else follows from the answer key.
import { AVAILABLE_COLUMNS, Expectation, expectationFor } from '../data/schema';
import type { Manifest } from './manifest';

// ---------- the answer key, reduced to what scoring needs ----------
export interface KeyColumn {
  id: string;
  name: string;
  /** Header the column carried in the CSV file the tool scanned. */
  header: string;
  /** Key it carried in flat JSON or NDJSON, when that differs from the id. */
  key?: string;
  expectation: Expectation;
  nearMissOf?: string;
}

/** Every column in the catalog, under its display name. Used when no answer key is loaded. */
export function keyFromCatalog(): KeyColumn[] {
  return AVAILABLE_COLUMNS.map(c => ({
    id: c.id,
    name: c.name,
    header: c.name,
    expectation: expectationFor(c),
    nearMissOf: c.validation?.startsWith('near-miss-of:') ? c.validation.slice('near-miss-of:'.length) : undefined,
  }));
}

export function keyFromManifest(m: Pick<Manifest, 'columns'>): KeyColumn[] {
  return m.columns.map(c => ({ id: c.id, name: c.name, header: c.header ?? c.name, key: c.key, expectation: c.expectation, nearMissOf: c.nearMissOf }));
}

// ---------- reading the tool's output ----------
export interface Table {
  fields: string[];
  rows: Record<string, string>[];
}

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCSV(text: string): string[][] {
  const out: string[][] = [];
  let field = '', record: string[] = [], quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { record.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      record.push(field); field = '';
      out.push(record); record = [];
    } else field += ch;
  }
  if (field !== '' || record.length) { record.push(field); out.push(record); }
  return out.filter(r => r.some(c => c !== ''));
}

const cell = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).trim();

/**
 * A tool's results as a table of strings: a JSON array of objects (or an object holding one),
 * or CSV with a header row. Values are trimmed — real exports carry stray whitespace.
 */
export function parseResults(text: string): Table {
  const src = text.trim();
  if (!src) throw new Error('The file is empty.');
  let records: Record<string, unknown>[];
  if (src[0] === '[' || src[0] === '{') {
    let json: unknown;
    try { json = JSON.parse(src); } catch { throw new Error('This looks like JSON but does not parse.'); }
    const list = Array.isArray(json) ? json : Object.values(json as object).find(Array.isArray);
    if (!Array.isArray(list)) throw new Error('Expected a JSON array of results, one object per column.');
    records = list.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));
  } else {
    const [header, ...body] = parseCSV(src);
    if (!header || body.length === 0) throw new Error('Expected CSV with a header row and at least one result.');
    records = body.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
  }
  if (records.length === 0) throw new Error('No results found in the file.');
  const fields = [...new Set(records.flatMap(r => Object.keys(r)))];
  return { fields, rows: records.map(r => Object.fromEntries(fields.map(f => [f, cell(r[f])]))) };
}

// ---------- which field is which ----------
export interface FieldMap {
  /** Field holding the column name. */
  name: string;
  /** Field holding the tool's label for the column. */
  label: string;
  /** Optional numeric field (risk, confidence): breaks ties when comparing a near-miss with its origin. */
  score: string | null;
  /** Optional field where the tool names what it found ("Aadhaar Number"), to catch a right flag under the wrong name. */
  kind?: string | null;
}

// Letters and digits only: "First Name", "first_name" (a SQL column) and "firstName" are one name.
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const isNumber = (s: string) => s !== '' && Number.isFinite(Number(s));

function columnIndex(key: KeyColumn[]): Map<string, KeyColumn> {
  const index = new Map<string, KeyColumn>();
  // Header and key first: they are what the tool actually saw, and under misleading headers
  // they are another column's name. Name and id are fallbacks.
  for (const pick of [(c: KeyColumn) => c.header, (c: KeyColumn) => c.key ?? c.id, (c: KeyColumn) => c.name, (c: KeyColumn) => c.id]) {
    for (const c of key) if (!index.has(norm(pick(c)))) index.set(norm(pick(c)), c);
  }
  return index;
}

/** Best guess at the three fields; null when the file names no column we know. */
export function guessFields(table: Table, key: KeyColumn[]): FieldMap | null {
  const index = columnIndex(key);
  const distinct = (f: string) => new Set(table.rows.map(r => r[f]));
  const hits = (f: string) => table.rows.filter(r => index.has(norm(r[f]))).length;
  const name = [...table.fields].sort((a, b) => hits(b) - hits(a))[0];
  if (!name || hits(name) === 0) return null;
  const rest = table.fields.filter(f => f !== name && distinct(f).size > 1);
  const numeric = (f: string) => table.rows.every(r => r[f] === '' || isNumber(r[f]));
  // The label is the coarsest text field: a type has fewer distinct values than a subtype.
  const label = rest.filter(f => !numeric(f)).sort((a, b) => distinct(a).size - distinct(b).size)[0];
  if (!label) return null;
  // The finest text field is where a tool says what exactly it found.
  const kind = rest.filter(f => !numeric(f) && f !== label).sort((a, b) => distinct(b).size - distinct(a).size)[0] ?? null;
  return { name, label, score: rest.find(numeric) ?? null, kind };
}

// ---------- did the tool call it the right thing ----------
// Words that say nothing about which identifier is meant.
const FILLER = new Set(['number', 'no', 'id', 'code', 'address', 'text', 'potential', 'possible', 'type', 'value', 'data', 'the', 'of', 'in', 'us', 'uk', 'de', 'sa', 'and']);
const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2 && !FILLER.has(w));

/**
 * Whether the tool's own name for a finding fits the column it was found in.
 *   right: it shares a word with this column ("Aadhaar Number" on Aadhaar)
 *   wrong: it does not, and it spells out another column in full ("SSN Number" on Routing Number)
 *   null:  it names nothing in particular ("Potential PII")
 * Deliberately lenient towards "right": a wrong verdict needs every word of another column.
 */
export function naming(kind: string, col: KeyColumn, key: KeyColumn[]): { verdict: 'right' | 'wrong' | null; namedAs?: string } {
  const said = words(kind);
  if (said.length === 0) return { verdict: null };
  const own = [norm(col.name), norm(col.id)], flat = norm(kind);
  // A word of the tool's inside the column's name ("ip" in "ipv6address"), or a word of the column's in the
  // tool's text — as a whole word, or inside a run-together name when long enough not to be an accident
  // ("credit" in "creditcardnumber", but not "pan" in "company").
  const theirs = words(`${col.name} ${col.id}`);
  if (said.some(w => own.some(n => n.includes(w))) || theirs.some(w => said.includes(w) || (w.length >= 5 && flat.includes(w)))) return { verdict: 'right' };
  const spelledOut = (c: KeyColumn) => [words(c.id), words(c.name)].some(ws => ws.length > 0 && ws.every(w => said.includes(w)));
  const other = key.find(c => c.id !== col.id && !c.nearMissOf && spelledOut(c));
  return other ? { verdict: 'wrong', namedAs: other.name } : { verdict: null };
}

// ---------- how strong is a label ----------
export type Level = 'detected' | 'weak' | 'none';
const RANK: Record<Level, number> = { detected: 2, weak: 1, none: 0 };

/** A starting point the user corrects: reads the tool's own words. Hedged terms win. */
export function guessLevel(label: string): Level {
  if (/potential|possible|maybe|masked|pseudo|quasi|generic|low/i.test(label)) return 'weak';
  if (/pii|phi|pci|secret|credential|sensitive|personal|confidential|restricted|high/i.test(label)) return 'detected';
  if (/identifier|\bid\b/i.test(label)) return 'weak';
  return 'none';
}

export function distinctLabels(table: Table, fields: FieldMap): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of table.rows) counts.set(r[fields.label], (counts.get(r[fields.label]) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

// ---------- scoring ----------
export type Verdict = 'correct' | 'misnamed' | 'generic' | 'missed' | 'false-positive' | 'soft-flag' | 'context';
export const VERDICT_LABELS: Record<Verdict, string> = {
  'correct': 'Correct',
  'misnamed': 'Wrong name',
  'generic': 'Flagged generically',
  'missed': 'Missed',
  'false-positive': 'False positive',
  'soft-flag': 'Soft flag',
  'context': 'Context',
};

const VERDICT: Record<Expectation, Record<Level, Verdict>> = {
  detect: { detected: 'correct', weak: 'generic', none: 'missed' },
  ignore: { detected: 'false-positive', weak: 'soft-flag', none: 'correct' },
  context: { detected: 'context', weak: 'context', none: 'context' },
};

export interface ScoredColumn {
  id: string;
  name: string;
  expectation: Expectation;
  label: string;
  /** The tool's other fields for this column, for display and for telling near-misses apart. */
  detail: string;
  score: number | null;
  level: Level;
  verdict: Verdict;
  /** When the tool flagged this under another column's name: that column. */
  namedAs?: string;
}

export type PairOutcome = 'told-apart' | 'not-told-apart' | 'inverted';
export interface PairResult {
  id: string;
  origin: string;
  outcome: PairOutcome;
}

export interface Scorecard {
  columns: ScoredColumn[];
  /** Columns that should fire. */
  detect: { total: number; correct: number; misnamed: number; generic: number; missed: number };
  /** Columns that should stay quiet. */
  ignore: { total: number; correct: number; soft: number; falsePositive: number };
  context: { total: number; flagged: number };
  /** Near-miss columns compared with the valid column they imitate. */
  pairs: PairResult[];
  /** Names in the tool's output that match no column. */
  unmatched: string[];
  /** Key columns the tool's output does not mention. */
  missing: string[];
}

export function score(table: Table, fields: FieldMap, levels: Record<string, Level>, key: KeyColumn[]): Scorecard {
  const index = columnIndex(key);
  const scored = new Map<string, ScoredColumn>();
  const unmatched: string[] = [];
  const detailFields = table.fields.filter(f => f !== fields.name && f !== fields.label && f !== fields.score);
  for (const r of table.rows) {
    const col = index.get(norm(r[fields.name]));
    if (!col) { unmatched.push(r[fields.name]); continue; }
    if (scored.has(col.id)) continue; // first result for a column wins
    const label = r[fields.label];
    const level = levels[label] ?? guessLevel(label);
    let verdict = VERDICT[col.expectation][level], namedAs: string | undefined;
    // A should-fire column flagged with confidence, but as something else, is not a clean hit.
    if (verdict === 'correct' && col.expectation === 'detect' && fields.kind) {
      const n = naming(r[fields.kind], col, key);
      if (n.verdict === 'wrong') { verdict = 'misnamed'; namedAs = n.namedAs; }
    }
    scored.set(col.id, {
      id: col.id, name: col.name, expectation: col.expectation, label,
      detail: detailFields.map(f => r[f]).filter(Boolean).join(' · '),
      score: fields.score && isNumber(r[fields.score]) ? Number(r[fields.score]) : null,
      level, verdict, namedAs,
    });
  }
  const columns = key.filter(c => scored.has(c.id)).map(c => scored.get(c.id)!);
  const count = (e: Expectation, v?: Verdict) => columns.filter(c => c.expectation === e && (!v || c.verdict === v)).length;

  const pairs: PairResult[] = [];
  for (const c of key) {
    const near = scored.get(c.id), origin = c.nearMissOf ? scored.get(c.nearMissOf) : undefined;
    if (!near || !origin) continue;
    // Strength: the tool's own number when it gives one, else the mapped level.
    const strength = (s: ScoredColumn) => (near.score !== null && origin.score !== null ? s.score! : RANK[s.level]);
    const outcome: PairOutcome =
      near.label === origin.label && near.detail === origin.detail && near.score === origin.score ? 'not-told-apart'
      : strength(near) > strength(origin) ? 'inverted'
      : 'told-apart';
    pairs.push({ id: near.id, origin: origin.id, outcome });
  }

  return {
    columns,
    detect: { total: count('detect'), correct: count('detect', 'correct'), misnamed: count('detect', 'misnamed'), generic: count('detect', 'generic'), missed: count('detect', 'missed') },
    ignore: { total: count('ignore'), correct: count('ignore', 'correct'), soft: count('ignore', 'soft-flag'), falsePositive: count('ignore', 'false-positive') },
    context: { total: count('context'), flagged: columns.filter(c => c.expectation === 'context' && c.level !== 'none').length },
    pairs,
    unmatched,
    missing: key.filter(c => !scored.has(c.id)).map(c => c.name),
  };
}

// ---------- report ----------
export const PAIR_LABELS: Record<PairOutcome, string> = { 'told-apart': 'Told apart', 'not-told-apart': 'Not told apart', 'inverted': 'Inverted' };

const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The scorecard as a Markdown report. `scoredAgainstKey` adds the columns the tool did not report. */
export function toMarkdown(card: Scorecard, opts: { tool?: string; scoredAgainstKey?: boolean } = {}): string {
  const pair = (o: PairOutcome) => card.pairs.filter(p => p.outcome === o).length;
  const nameOf = (id: string) => card.columns.find(c => c.id === id)?.name ?? id;
  const lines = [
    `# Scorecard${opts.tool ? `: ${opts.tool}` : ''}`,
    '',
    `Scored ${card.columns.length} columns against Pretendata's answer key.`,
    '',
    '| Measure | Result |',
    '|---|---|',
    `| Should fire | ${card.detect.correct} of ${card.detect.total} correct, ${card.detect.misnamed} under the wrong name, ${card.detect.generic} flagged generically, ${card.detect.missed} missed |`,
    `| Should not fire | ${card.ignore.correct} of ${card.ignore.total} quiet, ${card.ignore.soft} soft flags, ${card.ignore.falsePositive} false positives |`,
    `| Near-miss pairs | ${pair('told-apart')} told apart, ${pair('not-told-apart')} not told apart, ${pair('inverted')} inverted |`,
    `| Context columns | ${card.context.flagged} of ${card.context.total} flagged (not scored) |`,
    '',
  ];
  if (card.pairs.length) {
    lines.push('## Near-miss pairs', '', '| Near-miss | Valid column | Outcome |', '|---|---|---|');
    for (const p of card.pairs) lines.push(`| ${mdCell(nameOf(p.id))} | ${mdCell(nameOf(p.origin))} | ${PAIR_LABELS[p.outcome]} |`);
    lines.push('');
  }
  lines.push('## Columns', '', '| Column | Expected | Tool label | Detail | Verdict |', '|---|---|---|---|---|');
  for (const c of card.columns) {
    const detail = [c.detail, c.score === null ? '' : String(c.score)].filter(Boolean).join(' · ');
    lines.push(`| ${mdCell(c.name)} | ${c.expectation} | ${mdCell(c.label)} | ${mdCell(detail)} | ${VERDICT_LABELS[c.verdict]}${c.namedAs ? ` (as ${mdCell(c.namedAs)})` : ''} |`);
  }
  if (card.unmatched.length) lines.push('', `Names in the results that match no column: ${card.unmatched.map(mdCell).join(', ')}.`);
  if (opts.scoredAgainstKey && card.missing.length) lines.push('', `Columns in the answer key with no result: ${card.missing.map(mdCell).join(', ')}.`);
  return lines.join('\n') + '\n';
}

// ---------- self-check (run via `npm test`) ----------
export function _selfCheck() {
  // A made-up tool: three fields, messy whitespace and case, one column it invented.
  const results = [
    ['Aadhaar (IN)\n', 'PII', 'Aadhaar Number', 100],
    ['aadhaar (near-miss)', 'POTENTIAL_PII', 'Potential PII', 90],
    ['IBAN', 'QUASI_IDENTIFIER', 'Quasi Text', 60],
    ['IBAN (near-miss)', 'QUASI_IDENTIFIER', 'Quasi Text', 60],
    ['VIN (Vehicle)', 'PSEUDONYMIZED_PII', 'Pseudonymized PII', 50],
    ['VIN (near-miss)', 'UNIQUE_IDENTIFIER', 'ID Text', 80],
    ['GSTIN (IN)', 'UNIQUE_IDENTIFIER', 'Gst No', 80],
    ['GSTIN (near-miss)', 'UNIQUE_IDENTIFIER', 'ID Text', 80],
    ['Email Address', 'PII', 'Email', 100],
    ['SSN', 'STATISTICAL', 'Statistical Text', 20],
    ['Salary', 'PII', 'Name', 100],
    ['Created At', 'TIME', 'Added Time', 30],
    ['SQL Injection', 'STATISTICAL', 'Statistical Text', 20],
    ['Gender', 'QUASI_IDENTIFIER', 'Gender', 60],
    ['Routing Number', 'PII', 'SSN Number', 100],
    ['Mystery Column', 'PII', 'Name', 100],
  ].map(([n, t, s, r]) => ({ Attribute_Name: n, Attribute_Type: t, Attribute_SubType: s, Risk_Level: r, Confidence: null }));
  const key = keyFromCatalog();
  const check = (table: Table, how: string) => {
    const f = guessFields(table, key);
    if (!f || f.name !== 'Attribute_Name' || f.label !== 'Attribute_Type' || f.score !== 'Risk_Level' || f.kind !== 'Attribute_SubType') throw new Error(`FAIL: guessFields (${how}): ${JSON.stringify(f)}`);
    const levels = Object.fromEntries(distinctLabels(table, f).map(l => [l.label, guessLevel(l.label)]));
    if (levels.PII !== 'detected' || levels.POTENTIAL_PII !== 'weak' || levels.UNIQUE_IDENTIFIER !== 'weak' || levels.TIME !== 'none') throw new Error(`FAIL: guessLevel (${how})`);
    const card = score(table, f, levels, key);
    const got = JSON.stringify([card.detect, card.ignore, card.context, card.unmatched, card.pairs.map(p => `${p.id}:${p.outcome}`)]);
    const want = JSON.stringify([
      // should fire: aadhaar, email correct; routing number flagged as an SSN; iban, vin, gstin generic; ssn missed
      { total: 7, correct: 2, misnamed: 1, generic: 3, missed: 1 },
      // should not fire: created-at, sql injection quiet; four near-misses soft; salary a false positive
      { total: 7, correct: 2, soft: 4, falsePositive: 1 },
      { total: 1, flagged: 1 },
      ['Mystery Column'],
      ['aadhaar_invalid:told-apart', 'iban_invalid:not-told-apart', 'gstin_invalid:told-apart', 'vin_invalid:inverted'],
    ]);
    if (got !== want) throw new Error(`FAIL: scorecard (${how})\n  got  ${got}\n  want ${want}`);
    return card;
  };
  const card = check(parseResults(JSON.stringify(results)), 'json');
  // the same results as CSV, and wrapped in an object
  const csv = 'Attribute_Name,Attribute_Type,Attribute_SubType,Risk_Level,Confidence\n' +
    results.map(r => `"${String(r.Attribute_Name).replace(/"/g, '""')}",${r.Attribute_Type},${r.Attribute_SubType},${r.Risk_Level},`).join('\n');
  check(parseResults(csv), 'csv');
  check(parseResults(JSON.stringify({ results })), 'wrapped json');

  const md = toMarkdown(card, { tool: 'Example' });
  if (!md.includes('| Should fire | 2 of 7 correct, 1 under the wrong name, 3 flagged generically, 1 missed |') || !md.includes('| VIN (near-miss) | VIN (Vehicle) | Inverted |') || !md.includes('Wrong name (as SSN)')) throw new Error('FAIL: scorecard markdown');
  // naming: lenient towards right, strict towards wrong
  const byId = (id: string) => key.find(c => c.id === id)!;
  const named = (kind: string, id: string) => naming(kind, byId(id), key).verdict;
  for (const [kind, id, want] of [['Aadhaar Number', 'aadhaar', 'right'], ['IP Address v6', 'ipv6Address', 'right'], ['Potential Passport', 'passportNumber', 'right'], ['Name', 'firstName', 'right'],
    ['Gst No', 'gstin', 'right'], ['CreditCardNumber', 'creditCard', 'right'], ['SSN Number', 'routingNumber', 'wrong'], ['Email', 'upiId', 'wrong'], ['Phone Number', 'accountNumber', 'wrong'],
    ['Medical Condition', 'diagnosisCode', null], ['Potential PII', 'ein', null], ['ID Text', 'mrn', null], ['Company language', 'pan', null]] as const) {
    if (named(kind, id) !== want) throw new Error(`FAIL: naming("${kind}" on ${id}) should be ${want}, got ${named(kind, id)}`);
  }

  // scoring against a manifest matches on the header the tool saw, and reports what is absent
  const keyed = score(parseResults(JSON.stringify([{ col: 'col_01', kind: 'PII' }])), { name: 'col', label: 'kind', score: null }, { PII: 'detected' },
    [{ id: 'ssn', name: 'SSN', header: 'col_01', expectation: 'detect' }, { id: 'email', name: 'Email Address', header: 'col_02', expectation: 'detect' }]);
  if (keyed.detect.correct !== 1 || keyed.missing.join() !== 'Email Address') throw new Error('FAIL: scoring by header');

  // misleading headers: the tool reports the SSN column under the name "Email Address", and scoring follows the key
  const swapped: KeyColumn[] = [
    { id: 'ssn', name: 'SSN', header: 'Email Address', key: 'email', expectation: 'detect' },
    { id: 'email', name: 'Email Address', header: 'SSN', key: 'ssn', expectation: 'detect' },
  ];
  const led = score(parseResults(JSON.stringify([{ col: 'Email Address', kind: 'NONE' }, { col: 'SSN', kind: 'PII' }])), { name: 'col', label: 'kind', score: null }, { PII: 'detected', NONE: 'none' }, swapped);
  if (led.columns.find(c => c.id === 'ssn')!.verdict !== 'missed' || led.columns.find(c => c.id === 'email')!.verdict !== 'correct') throw new Error('FAIL: scoring under misleading headers');

  // forgiving name matching must not make two columns indistinguishable
  const seen = new Map<string, string>();
  for (const c of key) for (const n of [c.name, c.id]) {
    const other = seen.get(norm(n));
    if (other && other !== c.id) throw new Error(`FAIL: "${n}" (${c.id}) and ${other} normalise to the same name`);
    seen.set(norm(n), c.id);
  }
  const sqlNamed = score(parseResults(JSON.stringify([{ col: 'first_name', kind: 'PII' }, { col: 'drivers license (in)', kind: 'PII' }])), { name: 'col', label: 'kind', score: null }, { PII: 'detected' }, key);
  if (sqlNamed.columns.map(c => c.id).join() !== 'firstName,dlIndia') throw new Error('FAIL: matching SQL-style and loosely written names');

  for (const bad of ['', '{"a":1}', 'just,a,header']) {
    let threw = false;
    try { parseResults(bad); } catch { threw = true; }
    if (!threw) throw new Error(`FAIL: parseResults should reject ${JSON.stringify(bad)}`);
  }
  console.log('scorecard: all self-checks passed');
}
