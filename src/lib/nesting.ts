// JSON output structure. Transforms a flat row (colId → value) into a nested shape.
// Used by the JSON/NDJSON export and the /api/generate JSON output.
import { AVAILABLE_COLUMNS } from '../data/schema';

export type JsonStructure = 'flat' | 'grouped' | 'semantic' | 'deep';
export const DEFAULT_DEPTH = 3;
export const MAX_DEPTH = 10;

const CATEGORY_OF = new Map(AVAILABLE_COLUMNS.map(c => [c.id, c.category]));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_');

// Semantic paths — where a column lands in a realistic nested record. Columns not listed fall back
// to `<category>/<id>` so the map only needs the ones worth grouping nicely.
const SEMANTIC_PATHS: Record<string, string> = {
  firstName: 'person.name.first', lastName: 'person.name.last',
  email: 'person.contact.email', phone: 'person.contact.phone', upiId: 'person.contact.upi',
  dob: 'person.dob', gender: 'person.gender', age: 'person.age', ethnicity: 'person.ethnicity',
  city: 'address.city', zipCode: 'address.zip', storeLocation: 'address.state', geoCoordinates: 'address.geo',
  ssn: 'identifiers.ssn', aadhaar: 'identifiers.aadhaar', pan: 'identifiers.pan', voterId: 'identifiers.voterId',
  iqama: 'identifiers.iqama', ein: 'identifiers.ein', passportNumber: 'identifiers.passport',
  driversLicense: 'identifiers.driversLicense', dlIndia: 'identifiers.driversLicense',
  creditCard: 'financial.card.number', cvv: 'financial.card.cvv', tokenizedCard: 'financial.card.token',
  iban: 'financial.iban', accountNumber: 'financial.account', routingNumber: 'financial.routing',
  ifsc: 'financial.ifsc', salary: 'financial.salary', creditScore: 'financial.creditScore',
  accountBalance: 'financial.balance', loanAmount: 'financial.loanAmount',
  mrn: 'health.mrn', diagnosisCode: 'health.icd10', bloodType: 'health.bloodType',
  healthInsuranceId: 'health.insuranceId', npi: 'health.npi', abha: 'health.abha',
  ipAddress: 'device.ip', ipv6Address: 'device.ipv6', macAddress: 'device.mac',
  userAgent: 'device.userAgent', deviceType: 'device.type',
};

function setPath(obj: Record<string, any>, path: string, value: any) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = (o[parts[i]] ??= {});
  o[parts[parts.length - 1]] = value;
}

function nestByPath(row: Record<string, any>, pathFn: (id: string) => string): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) setPath(out, pathFn(k), v);
  return out;
}

// Deep burial: wrap the whole flat row under `depth` nested keys — tests whether a data
// classifier recursively traverses nested JSON instead of only scanning the top level.
const DEEP_KEYS = ['data', 'attributes', 'record', 'payload', 'details', 'fields'];
function nestDeep(row: Record<string, any>, depth: number): Record<string, any> {
  let node: any = row;
  for (let i = depth - 1; i >= 0; i--) node = { [DEEP_KEYS[i % DEEP_KEYS.length]]: node };
  return node;
}

const groupedPath = (id: string) => `${slug(CATEGORY_OF.get(id) ?? 'other')}.${id}`;
const semanticPath = (id: string) => SEMANTIC_PATHS[id] ?? groupedPath(id);

/** Reshape one flat row per the chosen structure. `depth` only applies to 'deep'. */
export function nestRow(row: Record<string, any>, structure: JsonStructure, depth = DEFAULT_DEPTH): Record<string, any> {
  switch (structure) {
    case 'grouped':  return nestByPath(row, groupedPath);
    case 'semantic': return nestByPath(row, semanticPath);
    // Clamped here, not per caller: `depth` reaches this straight from the API body.
    case 'deep':     return nestDeep(row, Math.min(MAX_DEPTH, Math.max(1, Math.floor(depth) || 1)));
    default:         return row;
  }
}

export function nestRows(rows: Record<string, any>[], structure: JsonStructure, depth = DEFAULT_DEPTH) {
  return structure === 'flat' ? rows : rows.map(r => nestRow(r, structure, depth));
}

// ---------- self-check (run via `npm test`) ----------
export function _selfCheck() {
  const row = { firstName: 'A', email: 'a@b.com', ssn: '1' };
  if ((nestRow(row, 'semantic') as any).person.name.first !== 'A') throw new Error('FAIL: semantic path');
  if ((nestRow(row, 'semantic') as any).identifiers.ssn !== '1') throw new Error('FAIL: semantic id path');
  if ((nestRow(row, 'grouped') as any).pii.firstName !== 'A') throw new Error('FAIL: grouped path');
  const deep = nestRow(row, 'deep', 3) as any;
  if (deep.data.attributes.record.firstName !== 'A') throw new Error('FAIL: deep nesting');
  if (nestRow(row, 'flat') !== row) throw new Error('FAIL: flat passthrough');
  // depth is clamped to 1..MAX_DEPTH whatever a caller sends (huge, fractional, garbage).
  const levels = (d: any) => { let n = 0; for (let o = nestRow(row, 'deep', d) as any; !('firstName' in o); o = Object.values(o)[0]) n++; return n; };
  if (levels(1e9) !== MAX_DEPTH || levels(2.9) !== 2 || levels(-5) !== 1 || levels('x') !== 1) throw new Error('FAIL: deep depth clamp');
  console.log('nesting: all self-checks passed');
}
