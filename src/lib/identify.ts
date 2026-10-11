// "What is this value?" — every column whose shape a pasted value fits, and whether it passes
// that column's checksum or rules. The same value often fits several: a bare 9-digit number is
// shaped like an SSN and like a routing number, which is exactly how detectors confuse them.
import { AVAILABLE_COLUMNS } from '../data/schema';
import { describeValidation, patternFor } from './reference';
import { VALIDATORS, breakChecksum, validAs } from './validators';
import { generateRows } from './generate';

export type MatchStatus =
  | 'valid'    // fits the shape and passes the column's checksum or rules
  | 'invalid'  // fits the shape, fails the checksum or rules
  | 'shape';   // fits the shape; the column has nothing further to check

export interface Match {
  id: string;
  name: string;
  status: MatchStatus;
  /** What was checked, e.g. "Luhn", or "Pattern only". */
  check: string;
}

const ORDER: Record<MatchStatus, number> = { valid: 0, invalid: 1, shape: 2 };

// People write the same identifier with or without its separators ("078-05-1120", "078051120",
// "1234 5678 9012"), so a pattern's literal dashes and spaces become optional — outside
// character classes, where a dash means a range.
function loosen(pattern: string): string {
  let out = '', inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') { out += ch + (pattern[++i] ?? ''); continue; }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    out += !inClass && (ch === '-' || ch === ' ') ? '[- ]?' : ch;
  }
  return out;
}
// Near-miss columns share their origin's shape; listing them too would only repeat it.
const CANDIDATES = AVAILABLE_COLUMNS
  .filter(c => !c.validation?.startsWith('near-miss-of:'))
  .map(c => ({ col: c, pattern: patternFor(c.id), validate: VALIDATORS[c.id] }))
  .filter(c => c.pattern && !c.pattern.includes('<'))
  .map(c => ({ ...c, re: new RegExp(`^(?:${loosen(c.pattern!)})$`) }));

export function identify(value: string): Match[] {
  const v = value.trim();
  if (!v) return [];
  const compact = v.replace(/[\s-]/g, '');
  const out: Match[] = [];
  for (const { col, re, validate } of CANDIDATES) {
    if (!re.test(v) && !re.test(compact)) continue;
    const label = describeValidation(col.validation).label;
    out.push({
      id: col.id,
      name: col.name,
      // Validators take the value with or without separators.
      status: validate ? (validate(v) || validate(compact) ? 'valid' : 'invalid') : 'shape',
      check: validate ? (col.validation === 'pattern-only' ? 'Format rules' : label) : 'Pattern only',
    });
  }
  return out.sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}

// ---------- self-check (run via `npm test`) ----------
export function _selfCheck() {
  // Every column with a validator: all generated values valid, every near-miss invalid.
  const ids = Object.keys(VALIDATORS);
  const missing = ids.filter(id => !AVAILABLE_COLUMNS.some(c => c.id === id));
  if (missing.length) throw new Error(`FAIL: validators for unknown columns: ${missing}`);
  const nearMiss = AVAILABLE_COLUMNS.filter(c => c.validation?.startsWith('near-miss-of:'));
  const rows = generateRows({ columnIds: [...ids, ...nearMiss.map(c => c.id)], rowCount: 1500, seed: 21, locale: 'mix' });
  for (const id of ids) {
    const bad = rows.find(r => !VALIDATORS[id](r[id]));
    if (bad) throw new Error(`FAIL: ${id} generated an invalid value: ${bad[id]}`);
    const found = identify(rows[0][id]).find(m => m.id === id);
    if (found?.status !== 'valid') throw new Error(`FAIL: identify(${rows[0][id]}) should list ${id} as valid, got ${JSON.stringify(found)}`);
  }
  for (const c of nearMiss) {
    const origin = c.validation!.slice('near-miss-of:'.length);
    if (!VALIDATORS[origin]) throw new Error(`FAIL: near-miss ${c.id} has no validator for ${origin}`);
    const seen = identify(rows[0][c.id]).find(m => m.id === origin);
    if (seen?.status !== 'invalid') throw new Error(`FAIL: identify should show ${rows[0][c.id]} as an invalid ${origin}, got ${JSON.stringify(seen)}`);
  }
  // Every negative control — near-miss or hard negative — is valid as nothing at all, not merely
  // invalid as the thing it imitates.
  const negatives = AVAILABLE_COLUMNS.filter(c => c.category === 'DLP-Negative');
  for (const r of generateRows({ columnIds: negatives.map(c => c.id), rowCount: 3000, seed: 22 })) {
    for (const c of negatives) {
      const as = validAs(r[c.id]);
      if (as.length) throw new Error(`FAIL: negative control ${c.id} produced ${r[c.id]}, which is a valid ${as.join(' and ')}`);
    }
  }
  // …and the new ways of being almost right are what they claim to be.
  const odd = generateRows({ columnIds: ['ssn_invalid', 'aadhaar_prefix', 'creditCard', 'creditCard_transposed', 'epochSeconds', 'epochMillis'], rowCount: 300, seed: 23 });
  if (odd.some(r => !/^(000|666|9\d\d)-\d{2}-\d{4}$/.test(r.ssn_invalid))) throw new Error('FAIL: never-issued SSN range');
  if (odd.some(r => !/^[01]\d{11}$/.test(r.aadhaar_prefix))) throw new Error('FAIL: wrong-prefix Aadhaar');
  if (odd.some(r => !/^\d{10}$/.test(r.epochSeconds) || !/^\d{13}$/.test(r.epochMillis))) throw new Error('FAIL: epoch timestamps');
  const shape = (v: string) => v.replace(/\d/g, '9');
  const cardShapes = new Set(odd.map(r => shape(r.creditCard)));
  if (odd.some(r => !cardShapes.has(shape(r.creditCard_transposed)))) throw new Error('FAIL: a transposed card must keep a card shape');
  // The confusion detectors really make: one bare number, two identifiers.
  const both = identify('078051120').filter(m => m.status === 'valid').map(m => m.id);
  if (!both.includes('routingNumber') || !both.includes('ssn')) throw new Error(`FAIL: 078051120 should be a valid routing number and SSN, got ${both}`);
  // …and a real routing number whose digits break the SSN rules (group 00) is told apart.
  if (identify('021000021').find(m => m.id === 'ssn')?.status !== 'invalid') throw new Error('FAIL: 021000021 is not a valid SSN');
  // Written with spaces, still recognised; one digit off, still shaped like it but invalid.
  const aadhaar = rows[0].aadhaar as string;
  if (identify(`${aadhaar.slice(0, 4)} ${aadhaar.slice(4, 8)} ${aadhaar.slice(8)}`).find(m => m.id === 'aadhaar')?.status !== 'valid') throw new Error('FAIL: spaced Aadhaar');
  if (identify(breakChecksum(aadhaar)).find(m => m.id === 'aadhaar')?.status !== 'invalid') throw new Error('FAIL: broken Aadhaar');
  if (identify('').length || identify('hello world').length) throw new Error('FAIL: nothing should match free text');
  console.log('identify: all self-checks passed');
}
