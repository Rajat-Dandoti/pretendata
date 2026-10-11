// Human-readable descriptions of each ValidationKind, for the in-app Column Reference.
// Derived from the schema (single source of truth) — mirrors the table in COLUMNS.md.
import { AVAILABLE_COLUMNS, ValidationKind } from '../data/schema';
import { makeRow } from './generate';
import { LocaleId } from './locale';

const GLOSSARY: Record<string, { label: string; note: string }> = {
  'free-form':    { label: 'Free-form',    note: 'No shape contract — names, notes, job titles.' },
  'pattern-only': { label: 'Pattern only', note: 'Regex-shaped, no checksum.' },
  'luhn':         { label: 'Luhn',         note: 'Luhn mod-10 check digit (cards, IMEI).' },
  'verhoeff':     { label: 'Verhoeff',     note: 'Verhoeff mod-10 check digit (Aadhaar).' },
  'mod-97':       { label: 'Mod-97',       note: 'ISO 7064 mod-97 check (IBAN).' },
  'mod-36':       { label: 'Mod-36',       note: 'Mod-36 weighted check (GSTIN).' },
  'mod-11':       { label: 'Mod-11',       note: 'Mod-11 check digit (NHS number).' },
  'mod-10':       { label: 'Mod-10',       note: 'GS1 mod-10 check digit (EAN-13, ISIN).' },
  'vin-checksum': { label: 'VIN checksum', note: 'VIN transliteration mod-11 check (position 9).' },
  'npi-luhn':     { label: 'NPI Luhn',     note: 'Luhn over the 80840-prefixed NPI.' },
  'chaos':        { label: 'Chaos',        note: 'Intentionally malformed / hostile value.' },
};

// Regex/shape per column, for the ones with a well-defined pattern. Display-only (double-escaped
// so backslashes render). Free-form / statistical / chaos columns have no fixed shape → omitted.
const COLUMN_PATTERNS: Record<string, string> = {
  ssn: '\\d{3}-\\d{2}-\\d{4}',
  aadhaar: '\\d{12}',
  pan: '[A-Z]{5}\\d{4}[A-Z]',
  ein: '\\d{2}-\\d{7}',
  upiId: '[a-z0-9.]+@[a-z]+',
  voterId: '[A-Z]{3}\\d{7}',
  iqama: '2\\d{9}',
  dlIndia: '[A-Z]{2}[ -]?\\d{2}[ -]?\\d{4}[ -]?\\d{7}',
  dlUS: '[A-Z]\\d{7}',
  passportNumber: '[A-Z0-9]{9}',
  driversLicense: '[A-Z0-9]{8}',
  ipAddress: '\\d{1,3}(\\.\\d{1,3}){3}',
  macAddress: '([0-9a-f]{2}:){5}[0-9a-f]{2}',
  vehicleRegIndia: '[A-Z]{2}\\d{2}[A-Z]{1,2}\\d{4}',
  ifsc: '[A-Z]{4}0\\d{6}',
  abha: '\\d{14}',
  mrn: 'MRN-\\d{7}',
  healthInsuranceId: '[A-Z]{3}\\d{8}',
  diagnosisCode: '[A-Z]\\d{2}\\.\\d',
  npi: '\\d{10}',
  dea: '[A-Z]{2}\\d{7}',
  nhsNumber: '\\d{3} \\d{3} \\d{4}',
  creditCard: '\\d{13}|\\d{4}-\\d{4}-\\d{4}-\\d{4}|\\d{4}-\\d{6}-\\d{4,5}',
  cvv: '\\d{3}',
  routingNumber: '\\d{9}',
  accountNumber: '\\d{10}',
  iban: '[A-Z]{2}\\d{2}[A-Z0-9]+',
  zipCode: '\\d{5}(-\\d{4})?',
  gstin: '\\d{2}[A-Z]{5}\\d{4}[A-Z][1-9]Z[0-9A-Z]',
  vin: '[A-HJ-NPR-Z0-9]{17}',
  imei: '\\d{15}',
  ean13: '\\d{13}',
  isin: '[A-Z]{2}[A-Z0-9]{9}\\d',
  last4SSN: '\\d{4}',
  tokenizedCard: '\\*{4}-\\*{4}-\\*{4}-\\d{4}',
  maskedAccount: '\\*{6}\\d{4}',
  hashedId: '<uuid v4>',
  awsAccessKey: 'AKIA[A-Z2-7]{16}',
  awsSecretKey: '[A-Za-z0-9]{40}',
  githubPAT: 'ghp_[A-Za-z0-9]{36}',
  stripeKey: 'sk_live_[A-Za-z0-9]{24}',
  googleApiKey: 'AIza[A-Za-z0-9]{35}',
  jwt: 'eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{43}',
  bcryptHash: '\\$2b\\$10\\$[A-Za-z0-9]{53}',
  fingerprintHash: '[0-9a-f]{64}',
  faceEmbeddingId: 'FACE-<uuid>',
  voiceprintId: 'VOICE-<uuid>',
  irisScanId: 'IRIS-[A-Z0-9]{24}',
  sessionCookie: 'sid=[0-9a-f]{40}',
  cidrBlock: '\\d{1,3}(\\.\\d{1,3}){3}/\\d{1,2}',
  ipv6Address: '([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}',
  epochSeconds: '\\d{10}',
  epochMillis: '\\d{13}',
  orderNumber: '[2-9]\\d{11}',
  trackingNumber: '1Z[A-Z0-9]{16}',
  skuCode: 'SKU-[A-Z]{2}\\d{2}-\\d{4}',
};

/** Regex/shape for a column, or undefined if it has no fixed pattern. */
export function patternFor(id: string): string | undefined { return COLUMN_PATTERNS[id]; }

/** Label + note for a column's validation contract. Handles the `near-miss-of:<id>` template. */
export function describeValidation(kind: ValidationKind | undefined): { label: string; note: string } {
  if (!kind) return GLOSSARY['free-form'];
  if (kind.startsWith('near-miss-of:')) {
    const origin = kind.slice('near-miss-of:'.length);
    return { label: 'Near-miss', note: `Shaped like ${origin}, but the checksum is deliberately broken.` };
  }
  return GLOSSARY[kind] ?? { label: kind, note: '' };
}

/** One illustrative value per column (id → sample). Reroll by calling again. */
export function sampleValues(locale: LocaleId): Record<string, any> {
  return makeRow(AVAILABLE_COLUMNS, { locale });
}

// ---------- self-check (run via `npm test`) ----------
export function _selfCheck() {
  if (describeValidation('verhoeff').label !== 'Verhoeff') throw new Error('FAIL: glossary lookup');
  if (!describeValidation('near-miss-of:aadhaar').note.includes('aadhaar')) throw new Error('FAIL: near-miss describe');
  if (describeValidation(undefined).label !== 'Free-form') throw new Error('FAIL: undefined -> free-form');
  const s = sampleValues('en');
  if (!('email' in s) || !('aadhaar' in s)) throw new Error('FAIL: sampleValues coverage');
  if (patternFor('pan') !== '[A-Z]{5}\\d{4}[A-Z]' || patternFor('firstName') !== undefined) throw new Error('FAIL: patternFor');
  // every documented pattern must match what its column really emits (`<uuid>`-style ones are prose).
  const rows = Array.from({ length: 300 }, () => sampleValues('en'));
  for (const [id, p] of Object.entries(COLUMN_PATTERNS)) {
    if (p.includes('<')) continue;
    const re = new RegExp(`^(?:${p})$`);
    const miss = rows.find(r => !re.test(String(r[id])));
    if (miss) throw new Error(`FAIL: pattern for ${id} (${p}) does not match ${JSON.stringify(miss[id])}`);
  }
  console.log('reference: all self-checks passed');
}
