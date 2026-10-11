// The same valid identifier, written the ways people (and people hiding it) write it.
// A detector that only knows the canonical form misses most real leaks. The value underneath
// is unchanged and still valid, so the expectation stays "should fire".
import { VALIDATORS } from './validators';

/**
 *   canonical: one form per column, as documented in COLUMNS.md
 *   mixed:     per row, a random everyday form — regrouped with spaces or dashes, bare, or labelled
 *   evasive:   mixed, plus forms that defeat naive matching — full-width digits, zero-width
 *              characters between digits, dots as separators, base64
 */
export type Formatting = 'canonical' | 'mixed' | 'evasive';
export const FORMATTINGS: Formatting[] = ['canonical', 'mixed', 'evasive'];

// How each identifier is conventionally grouped when written out. Others are not regrouped.
const GROUPS: Record<string, number[]> = {
  aadhaar: [4, 4, 4], creditCard: [4, 4, 4, 4], ssn: [3, 2, 4], iban: [4, 4, 4, 4, 4, 4, 4], nhsNumber: [3, 3, 4],
};
// What people write in front of it.
const LABELS: Record<string, string[]> = {
  ssn: ['SSN', 'SSN#', 'Social Security No'], aadhaar: ['Aadhaar', 'Aadhaar No', 'UID'], creditCard: ['Card', 'CC', 'Card No'],
  iban: ['IBAN'], npi: ['NPI'], nhsNumber: ['NHS No', 'NHS Number'], gstin: ['GSTIN', 'GST No'], vin: ['VIN'], imei: ['IMEI'],
  iqama: ['Iqama', 'Iqama No'], dea: ['DEA', 'DEA#'], routingNumber: ['Routing', 'ABA', 'RTN'],
  canadaSin: ['SIN', 'Social Insurance No'], brazilCpf: ['CPF'], spainDni: ['DNI', 'NIF'], netherlandsBsn: ['BSN'], franceNir: ['NIR', 'No SS'],
  singaporeNric: ['NRIC'], australiaTfn: ['TFN'], chinaResidentId: ['ID No'], southAfricaId: ['ID No', 'RSA ID'], uaeEmiratesId: ['Emirates ID', 'EID'], ukNino: ['NI No', 'NINO'],
};
/** Columns that take variants: should-fire identifiers with a validator, so every form can be checked. */
export const VARIANT_IDS = new Set(Object.keys(LABELS));

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(arr: T[]): T => arr[rand(arr.length)];
const compact = (v: string) => v.replace(/[\s-]/g, '');
function group(v: string, sizes: number[] | undefined, sep: string): string {
  const c = compact(v);
  if (!sizes) return c;
  const out: string[] = [];
  let i = 0;
  for (const s of sizes) { if (i >= c.length) break; out.push(c.slice(i, i + s)); i += s; }
  if (i < c.length) out.push(c.slice(i));
  return out.join(sep);
}

type Variant = (id: string, value: string) => string;
const EVERYDAY: Variant[] = [
  (_, v) => v,
  (id, v) => group(v, GROUPS[id], ' '),
  (id, v) => group(v, GROUPS[id], '-'),
  (_, v) => compact(v),
  (id, v) => `${pick(LABELS[id])}${pick([': ', '='])}${v}`,
];
const ZERO_WIDTH_SPACE = '​';
const EVASIVE: Variant[] = [
  // ０-９ (U+FF10–FF19): look the same, are different characters
  (_, v) => v.replace(/\d/g, d => String.fromCharCode(0xFF10 + Number(d))),
  // an invisible character between every three characters
  (_, v) => compact(v).replace(/(.{3})(?=.)/g, `$1${ZERO_WIDTH_SPACE}`),
  (id, v) => group(v, GROUPS[id] ?? [4, 4, 4, 4, 4], '.'),
  (_, v) => btoa(v),
];

/** One written form of a canonical value, drawn for this row. Leaves non-strings (nulls) alone. */
export function applyVariant(id: string, value: unknown, formatting: Formatting): unknown {
  if (formatting === 'canonical' || typeof value !== 'string' || !VARIANT_IDS.has(id)) return value;
  // Evasive runs draw an evasive form half the time, so both kinds are well represented.
  const pool = formatting === 'evasive' && rand(2) === 0 ? EVASIVE : EVERYDAY;
  return pick(pool)(id, value);
}

/**
 * Undo `applyVariant`: the forms a written value could stand for, most likely first. What a
 * thorough detector does before matching — fold Unicode look-alikes, drop invisible characters,
 * strip a label, try base64, ignore separators.
 */
export function canonicalForms(value: string): string[] {
  const folded = value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '');
  const bare = (v: string) => v.replace(/[.\s-]/g, '');
  // A label needs something after it; base64 padding ("…ODQ=") is not a label.
  const unlabelled = folded.replace(/^[A-Za-z][A-Za-z .#]*[:=]\s*(?=.)/, '');
  const forms = [unlabelled, bare(unlabelled)];
  if (/^[A-Za-z0-9+/]+=*$/.test(folded) && folded.length % 4 === 0) {
    try {
      const decoded = atob(folded);
      if (/^[\x20-\x7E]+$/.test(decoded)) forms.push(decoded, bare(decoded));
    } catch { /* not base64 */ }
  }
  return forms;
}

/** Whether a written value still stands for a valid `id`. */
export function validUnderVariants(id: string, value: string): boolean {
  return canonicalForms(value).some(f => VALIDATORS[id](f));
}

// ---------- self-check (run via `npm test`): lives in generate.ts, which owns row generation ----------
