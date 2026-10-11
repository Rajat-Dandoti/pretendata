// Checks a masking, tokenisation or anonymisation tool's output against the originals.
// The originals never have to be uploaded: a seeded dataset is rebuilt from its answer key, so
// only the masked file and the key are needed.
//
// Per sensitive column it answers: did any original value survive, was the same input always
// given the same output, did different inputs collide, and was the format kept.
import { buildManifest, rowsFromManifest } from './manifest';
import type { Manifest, ManifestColumn } from './manifest';
import { parseCSV } from './scorecard';
import { VALIDATORS } from './validators';

export type Row = Record<string, unknown>;

/** A masked file as rows: CSV with a header, a JSON array, or NDJSON. Values keep their JSON types. */
export function parseTable(text: string): Row[] {
  const src = text.replace(/^﻿/, '').trim();
  if (!src) throw new Error('The masked file is empty.');
  if (src[0] === '[') {
    const rows = JSON.parse(src);
    if (!Array.isArray(rows)) throw new Error('Expected a JSON array of rows.');
    return rows;
  }
  if (src[0] === '{') return src.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  const [header, ...body] = parseCSV(src);
  if (!header || body.length === 0) throw new Error('Expected CSV with a header row and at least one row.');
  return body.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const digits = (s: string) => s.replace(/[\s.-]/g, '');
// Below this length a match is coincidence, not a leak (a CVV, a blood type, "Mobile").
const MIN_LEAK_LENGTH = 6;

export interface ColumnCheck {
  id: string;
  name: string;
  /** Masked column this one was matched to, or null when the masked file has no such column. */
  maskedHeader: string | null;
  rows: number;
  /** Same row, same column, value identical to the original. */
  unchanged: number;
  /** Original values of this column found anywhere else in the masked file. */
  leakedElsewhere: number;
  /** Masked value differs but still ends with the original's last four characters. */
  keptLastFour: number;
  /** Original values that were masked to more than one output (needs repeated originals). */
  inconsistent: number;
  /** How many distinct originals occurred more than once, i.e. how much `inconsistent` could have caught. */
  repeatedOriginals: number;
  /** Masked values shared by more than one distinct original. */
  collisions: number;
  distinctMasked: number;
  /** Share of masked values (0–1) that still fit the column's pattern; null when it has none. */
  formatKept: number | null;
  /** Share of masked values (0–1) that still pass the column's checksum or rules; null when it has none. */
  stillValid: number | null;
}

export interface MaskReport {
  aligned: boolean;
  originalRows: number;
  maskedRows: number;
  columns: ColumnCheck[];
  /** Masked headers that match no column in the answer key. */
  extraHeaders: string[];
  /** Total original values that survived, in place or elsewhere. */
  leaks: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Compare a masked table with the original rows the answer key describes.
 * `originals` are keyed by column id (as `rowsFromManifest` returns them). Rows are compared
 * position by position, so the masked file must keep the row order.
 */
export function checkMasking(manifest: Pick<Manifest, 'columns'>, originals: Row[], masked: Row[], opts: { includeContext?: boolean } = {}): MaskReport {
  const aligned = originals.length === masked.length;
  const headers = masked.length ? Object.keys(masked[0]) : [];
  const byNorm = new Map(headers.map(h => [norm(h), h]));
  // A masked column can be named by header, JSON key, display name or id.
  const headerOf = (c: ManifestColumn) => [c.header, c.key, c.name, c.id].map(n => byNorm.get(norm(n ?? ''))).find(Boolean) ?? null;
  const matched = new Set<string>();
  const sensitive = manifest.columns.filter(c => c.expectation === 'detect' || (opts.includeContext && c.expectation === 'context'));

  // Every original value of a sensitive column, to look for anywhere in the masked file.
  const owner = new Map<string, string>(), ownerDigits = new Map<string, string>();
  for (const c of sensitive) {
    for (const r of originals) {
      const v = text(r[c.id]);
      if (v.length < MIN_LEAK_LENGTH) continue;
      if (!owner.has(v)) owner.set(v, c.id);
      const d = digits(v);
      if (d !== v && d.length >= 8 && !ownerDigits.has(d)) ownerDigits.set(d, c.id);
    }
  }
  const elsewhere = new Map<string, number>();
  masked.forEach((row, i) => {
    for (const h of headers) {
      const cell = text(row[h]);
      if (cell.length < MIN_LEAK_LENGTH) continue;
      const id = owner.get(cell) ?? ownerDigits.get(digits(cell)) ?? owner.get(digits(cell));
      if (!id) continue;
      // The in-place case is counted per column below; this is the value turning up somewhere else.
      const col = manifest.columns.find(c => c.id === id)!;
      const inPlace = aligned && headerOf(col) === h && text(originals[i][id]) === cell;
      if (!inPlace) elsewhere.set(id, (elsewhere.get(id) ?? 0) + 1);
    }
  });

  const columns: ColumnCheck[] = sensitive.map(c => {
    const h = headerOf(c);
    if (h) matched.add(h);
    const out: ColumnCheck = {
      id: c.id, name: c.name, maskedHeader: h, rows: 0, unchanged: 0, leakedElsewhere: elsewhere.get(c.id) ?? 0, keptLastFour: 0,
      inconsistent: 0, repeatedOriginals: 0, collisions: 0, distinctMasked: 0, formatKept: null, stillValid: null,
    };
    if (!h) return out;
    const values = masked.map(r => text(r[h]));
    out.distinctMasked = new Set(values).size;
    const pattern = c.pattern && !c.pattern.includes('<') ? new RegExp(`^(?:${c.pattern})$`) : null;
    const filled = values.filter(v => v !== '');
    if (pattern && filled.length) out.formatKept = filled.filter(v => pattern.test(v)).length / filled.length;
    if (VALIDATORS[c.id] && filled.length) out.stillValid = filled.filter(v => VALIDATORS[c.id](v)).length / filled.length;
    if (!aligned) return out;

    const outputs = new Map<string, Set<string>>(), inputs = new Map<string, Set<string>>(), seen = new Map<string, number>();
    originals.forEach((r, i) => {
      const o = text(r[c.id]), m = values[i];
      if (o === '') return; // a null original has nothing to leak
      out.rows++;
      if (m === o) out.unchanged++;
      else if (o.length >= 8 && m.length >= 4 && m.endsWith(o.slice(-4))) out.keptLastFour++;
      (outputs.get(o) ?? outputs.set(o, new Set()).get(o)!).add(m);
      (inputs.get(m) ?? inputs.set(m, new Set()).get(m)!).add(o);
      seen.set(o, (seen.get(o) ?? 0) + 1);
    });
    out.repeatedOriginals = [...seen.values()].filter(n => n > 1).length;
    out.inconsistent = [...outputs.values()].filter(s => s.size > 1).length;
    out.collisions = [...inputs.entries()].filter(([m, s]) => m !== '' && s.size > 1).length;
    return out;
  });

  const known = new Set(manifest.columns.map(c => headerOf(c)).filter(Boolean));
  return {
    aligned, originalRows: originals.length, maskedRows: masked.length, columns,
    extraHeaders: headers.filter(h => !known.has(h)),
    leaks: columns.reduce((n, c) => n + c.unchanged + c.leakedElsewhere, 0),
  };
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

export function maskReportMarkdown(r: MaskReport, tool = ''): string {
  const lines = [
    `# Masking check${tool ? `: ${tool}` : ''}`,
    '',
    r.leaks === 0 ? `No original value survived in ${r.maskedRows.toLocaleString()} masked rows.` : `**${r.leaks.toLocaleString()} original values survived masking.**`,
    '',
  ];
  if (!r.aligned) lines.push(`The masked file has ${r.maskedRows.toLocaleString()} rows and the original ${r.originalRows.toLocaleString()}, so rows could not be compared in place. Only the search for surviving values was run.`, '');
  lines.push('| Column | Unchanged | Leaked elsewhere | Kept last four | Inconsistent | Collisions | Format kept | Still valid |', '|---|---|---|---|---|---|---|---|');
  for (const c of r.columns) {
    lines.push(c.maskedHeader === null
      ? `| ${c.name} | not in the masked file | ${c.leakedElsewhere} | — | — | — | — | — |`
      : `| ${c.name} | ${c.unchanged} of ${c.rows} | ${c.leakedElsewhere} | ${c.keptLastFour} | ${c.inconsistent}${c.repeatedOriginals ? '' : ' (no repeats to test)'} | ${c.collisions} | ${pct(c.formatKept)} | ${pct(c.stillValid)} |`);
  }
  lines.push('', 'Limits: values are compared cell by cell, with and without separators. An original embedded inside longer text is not found. Consistency can only be judged where an original value occurs more than once.');
  return lines.join('\n') + '\n';
}

// ---------- self-check (run via `npm test`) ----------
export function _selfCheck() {
  const m = buildManifest(['firstName', 'email', 'ssn', 'creditCard', 'salary'], {
    seed: 8, rowCount: 400, sparsityPct: 0, locale: 'en', seeding: 'whole', densityPct: 100, headerMode: 'descriptive', formatting: 'canonical',
  });
  const orig = rowsFromManifest(m);
  // A well-behaved tokeniser: the same input always gives the same token; SSNs keep their shape and last four.
  const token = (v: unknown) => { let h = 2166136261; for (const ch of String(v)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return 'tok_' + (h >>> 0).toString(16).padStart(8, '0'); };
  const clean = (): Row[] => orig.map(r => ({
    'First Name': token(r.firstName), 'Email Address': token(r.email), 'SSN': `900-00-${String(r.ssn).slice(-4)}`,
    'Credit Card': token(r.creditCard), 'Salary': r.salary,
  }));
  const col = (r: MaskReport, id: string) => r.columns.find(c => c.id === id)!;

  const ok = checkMasking(m, orig, clean());
  if (ok.leaks !== 0 || !ok.aligned) throw new Error(`FAIL: a clean masking run reported ${ok.leaks} leaks`);
  if (ok.columns.map(c => c.id).join() !== 'firstName,email,ssn,creditCard') throw new Error('FAIL: only should-fire columns are checked');
  const ssn = col(ok, 'ssn');
  if (ssn.keptLastFour !== 400 || ssn.formatKept !== 1 || ssn.stillValid !== 0) throw new Error(`FAIL: SSN format checks ${JSON.stringify(ssn)}`);
  if (col(ok, 'firstName').repeatedOriginals === 0 || col(ok, 'firstName').inconsistent !== 0) throw new Error('FAIL: consistent tokens should show no inconsistency');
  if (col(ok, 'email').collisions !== 0) throw new Error('FAIL: no collisions expected');

  // Plant one of each defect.
  const bad = clean();
  for (const i of [3, 7, 11]) bad[i].SSN = orig[i].ssn;                         // left as is
  bad[20]['First Name'] = orig[21].email;                                       // an email in the wrong column
  bad[30]['Email Address'] = String(orig[30].creditCard).replace(/-/g, ' ');    // a card, rewritten with spaces, in another column
  const name = orig.map(r => r.firstName).find((n, i, all) => all.indexOf(n) !== i)!;
  bad[orig.map(r => r.firstName).lastIndexOf(name)]['First Name'] = 'tok_other'; // same name, different token
  bad[40]['Credit Card'] = bad[41]['Credit Card'];                              // two cards, one token
  const r = checkMasking(m, orig, bad);
  const got = JSON.stringify({ ssn: col(r, 'ssn').unchanged, email: col(r, 'email').leakedElsewhere, card: col(r, 'creditCard').leakedElsewhere, name: col(r, 'firstName').inconsistent, collide: col(r, 'creditCard').collisions, leaks: r.leaks });
  const want = JSON.stringify({ ssn: 3, email: 1, card: 1, name: 1, collide: 1, leaks: 5 });
  if (got !== want) throw new Error(`FAIL: planted masking defects\n  got  ${got}\n  want ${want}`);

  // Same file as CSV and NDJSON; and with a row missing, the search for survivors still runs.
  const csv = Object.keys(bad[0]).join(',') + '\n' + bad.map(row => Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  for (const [how, table] of [['csv', parseTable(csv)], ['ndjson', parseTable(bad.map(x => JSON.stringify(x)).join('\n'))], ['json', parseTable(JSON.stringify(bad))]] as const) {
    if (checkMasking(m, orig, table).leaks !== 5) throw new Error(`FAIL: masking check on ${how}`);
  }
  const short = checkMasking(m, orig, bad.slice(0, -1));
  if (short.aligned || short.leaks !== 5) throw new Error(`FAIL: unaligned masking check (${short.leaks} leaks)`);
  const md = maskReportMarkdown(r, 'Example');
  if (!md.includes('**5 original values survived masking.**') || !md.includes('| SSN | 3 of 400 |')) throw new Error('FAIL: masking report');
  if (!maskReportMarkdown(ok).includes('No original value survived')) throw new Error('FAIL: clean masking report');
  console.log('maskcheck: all self-checks passed');
}
