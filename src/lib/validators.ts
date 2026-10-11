import { faker } from '@faker-js/faker';

// ---------- shared helpers ----------
const rand = (n: number) => Math.floor(Math.random() * n);
const digits = (n: number) => Array.from({ length: n }, () => rand(10)).join('');
const alphaUpper = (n: number) =>
  Array.from({ length: n }, () => String.fromCharCode(65 + rand(26))).join('');
const pick = <T,>(arr: T[]): T => arr[rand(arr.length)];

// ---------- Luhn (credit-card style) ----------
function luhnCheckDigit(numStr: string): number {
  let sum = 0;
  let dbl = true;
  for (let i = numStr.length - 1; i >= 0; i--) {
    let d = parseInt(numStr[i], 10);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return (10 - (sum % 10)) % 10;
}

// ---------- Verhoeff (Aadhaar) ----------
const VERHOEFF_D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0],
];
const VERHOEFF_P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
];
const VERHOEFF_INV = [0,4,3,2,1,5,6,7,8,9];

function verhoeffCheckDigit(numStr: string): number {
  let c = 0;
  const arr = numStr.split('').reverse().map(Number);
  for (let i = 0; i < arr.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][arr[i]]];
  return VERHOEFF_INV[c];
}

// ---------- mod-97 (IBAN) ----------
function mod97(s: string): number {
  // Process in chunks to avoid bigint
  let rem = 0;
  for (const ch of s) rem = (rem * 10 + parseInt(ch, 10)) % 97;
  return rem;
}
function lettersToDigits(s: string): string {
  return s.replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
}

// ==================== Generators ====================

// SSN: AAA-GG-SSSS, area not 000/666/900-999, group not 00, serial not 0000
export function generateSSN(): string {
  let area: number;
  do { area = 1 + rand(899); } while (area === 666);
  const group = 1 + rand(99);
  const serial = 1 + rand(9999);
  return `${String(area).padStart(3,'0')}-${String(group).padStart(2,'0')}-${String(serial).padStart(4,'0')}`;
}

// Aadhaar: 12 digits, first digit 2-9, Verhoeff checksum
export function generateAadhaar(): string {
  const first = 2 + rand(8);
  const rest = digits(10);
  const base = `${first}${rest}`;
  return base + verhoeffCheckDigit(base);
}

// PAN: AAAAA9999A — 4th char is entity type, 5th is surname initial
const PAN_ENTITY = ['P','C','H','F','A','T','B','L','J','G'];
export function generatePAN(): string {
  return alphaUpper(3) + pick(PAN_ENTITY) + alphaUpper(1) + digits(4) + alphaUpper(1);
}

// GSTIN: SS + PAN(10) + entity(1) + Z + check(1), mod-36
const GSTIN_STATE_CODES = ['01','02','03','06','07','09','10','19','21','24','27','29','32','33','36'];
function gstinChecksum(base14: string): string {
  const charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < base14.length; i++) {
    const v = charset.indexOf(base14[i]);
    const f = (i % 2 === 0) ? 1 : 2;
    const p = v * f;
    sum += Math.floor(p / 36) + (p % 36);
  }
  return charset[(36 - (sum % 36)) % 36];
}
export function generateGSTIN(): string {
  const base = pick(GSTIN_STATE_CODES) + generatePAN() + String(1 + rand(9)) + 'Z';
  return base + gstinChecksum(base);
}

// IBAN: country + 2 check digits (mod-97) + BBAN in the country's registry layout
// ([letters, digits] — GB/NL lead with a 4-letter bank code, IT with its CIN letter).
// ponytail: national check digits inside the BBAN (FR RIB key, ES DC, IT CIN) are random —
// compute them if a detector validates past length + layout + mod-97.
const IBAN_BBAN: Record<string, [letters: number, digits: number]> = {
  DE: [0, 18], FR: [0, 23], GB: [4, 14], ES: [0, 20], IT: [1, 22], NL: [4, 10],
};
// Registry BBAN layouts for the countries generated here (wider than the generator: the registry
// allows letters where real banks use them). Other countries are held to the general shape only.
const IBAN_REGISTRY: Record<string, RegExp> = {
  DE: /^\d{18}$/, FR: /^\d{10}[A-Z0-9]{11}\d{2}$/, GB: /^[A-Z]{4}\d{14}$/,
  ES: /^\d{20}$/, IT: /^[A-Z]\d{10}[A-Z0-9]{12}$/, NL: /^[A-Z]{4}\d{10}$/,
};
/** Shape, the country's registry layout where known, and mod-97 == 1 over the rearranged IBAN. */
export function ibanValid(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const layout = IBAN_REGISTRY[iban.slice(0, 2)];
  return (!layout || layout.test(iban.slice(4))) && mod97(lettersToDigits(iban.slice(4) + iban.slice(0, 4))) === 1;
}
export function generateIBAN(): string {
  const country = pick(Object.keys(IBAN_BBAN));
  const [letters, numbers] = IBAN_BBAN[country];
  const bban = alphaUpper(letters) + digits(numbers);
  const check = 98 - mod97(lettersToDigits(bban + country + '00'));
  return country + String(check).padStart(2, '0') + bban;
}

// NPI: 10 digits, Luhn-valid with 80840 prefix prepended during check calc
export function generateNPI(): string {
  const body = '1' + digits(8); // NPIs start with 1 or 2
  const check = luhnCheckDigit('80840' + body);
  return body + check;
}

// EIN: NN-NNNNNNN, prefix from valid IRS campus list
const EIN_PREFIXES = ['01','02','03','04','05','06','10','11','12','13','14','15','16','20','21','22','23','24','25','26','27','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45','46','47','48','50','51','52','53','54','55','56','57','58','59','60','61','62','63','64','65','66','67','68','71','72','73','74','75','76','77','80','81','82','83','84','85','86','87','88','90','91','92','93','94','95','98','99'];
export function generateEIN(): string {
  return `${pick(EIN_PREFIXES)}-${digits(7)}`;
}

// Driver's licenses
const INDIA_STATES = ['MH','KA','TN','DL','UP','GJ','RJ','WB','KL','AP','TS','PB','HR','MP','BR'];
// Format per Microsoft Purview: LL DD YYYY DDDDDDD with an optional space-or-dash at each of the
// 3 boundaries. Randomize the separators so we exercise every formatting variant a detector must catch.
export function generateDLIndia(): string {
  const sep = () => pick(['', ' ', '-']);
  const state = pick(INDIA_STATES);
  const rto = String(rand(99)).padStart(2, '0');
  const year = String(2000 + rand(25));
  return `${state}${sep()}${rto}${sep()}${year}${sep()}${digits(7)}`;
}
export function generateDLUS(): string { return alphaUpper(1) + digits(7); } // CA format
export function generateDLUK(): string {
  return alphaUpper(5) + digits(6) + alphaUpper(2) + digits(1) + alphaUpper(2);
}
export function generateDLGermany(): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 11 }, () => charset[rand(36)]).join('');
}

// VIN — Faker gives the shape but a random position-9 check digit, so compute it:
// transliterate (A=1 … Z=9, no I/O/Q), weight, mod 11, 10 → 'X'.
const VIN_VALUES = '0123456789.ABCDEFGH..JKLMN.P.R..STUVWXYZ'; // value = index % 10
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
function vinCheckChar(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (VIN_VALUES.indexOf(vin[i]) % 10) * VIN_WEIGHTS[i];
  return '0123456789X'[sum % 11];
}
export function generateVIN(): string {
  const v = faker.vehicle.vin();
  return v.slice(0, 8) + vinCheckChar(v) + v.slice(9);
}

// ---------- validity predicates (self-checks) ----------
/** Luhn over the digits of `s` (separators ignored). */
export function luhnValid(s: string): boolean {
  const d = s.replace(/\D/g, '');
  return luhnCheckDigit(d.slice(0, -1)) === parseInt(d.slice(-1), 10);
}
export function vinValid(v: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(v) && vinCheckChar(v) === v[8];
}

// IMEI: 14 random + Luhn
export function generateIMEI(): string {
  const body = digits(14);
  return body + luhnCheckDigit(body);
}

// EAN-13: 12 random + mod-10 (weights 1,3,1,3...)
export function generateEAN13(): string {
  const body = digits(12);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(body[i],10) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return body + check;
}

// ISIN: country(2) + 9 alphanumeric + check (Luhn on digit-expanded form)
export function generateISIN(): string {
  const country = pick(['US','GB','DE','FR','JP','IN','CA','AU']);
  const body = Array.from({ length: 9 }, () => {
    const r = rand(36);
    return r < 10 ? String(r) : String.fromCharCode(55 + r);
  }).join('');
  // Expand letters to digits, then Luhn over the full string
  const expanded = lettersToDigits(country + body);
  return country + body + luhnCheckDigit(expanded);
}

// NHS Number (UK): 9 digits + mod-11 check. Regenerate if check==10.
export function generateNHSNumber(): string {
  while (true) {
    const body = digits(9);
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(body[i],10) * (10 - i);
    const rem = sum % 11;
    const check = (11 - rem) % 11;
    if (check === 10) continue;
    return `${body.slice(0,3)} ${body.slice(3,6)} ${body.slice(6,9)}${check}`;
  }
}

// DEA Number: 2 letters + 7 digits + check digit
// check = last digit of (d1+d3+d5) + 2*(d2+d4+d6)
export function generateDEA(): string {
  const prefix = alphaUpper(2);
  const body = digits(6);
  const d = body.split('').map(Number);
  const sum = (d[0] + d[2] + d[4]) + 2 * (d[1] + d[3] + d[5]);
  const check = sum % 10;
  return `${prefix}${body}${check}`;
}

// ---------- India-specific identifiers (all pattern-only — no published check digit) ----------
// UPI ID (VPA): local@psp-handle. Local part is usually a mobile or a name.
const UPI_HANDLES = ['ybl', 'ibl', 'axl', 'oksbi', 'okhdfcbank', 'okicici', 'okaxis', 'paytm', 'apl', 'upi'];
export function generateUPI(): string {
  const local = rand(2) === 0 ? pick([6, 7, 8, 9]) + digits(9) : faker.internet.username().toLowerCase().replace(/[^a-z0-9.]/g, '');
  return `${local}@${pick(UPI_HANDLES)}`;
}
// Voter ID (EPIC): 3 letters + 7 digits.
export function generateVoterId(): string { return alphaUpper(3) + digits(7); }
// Vehicle registration: SS + RTO(2 digits) + series(1-2 letters) + 4 digits, e.g. MH12AB1234.
export function generateVehicleRegIndia(): string {
  return pick(INDIA_STATES) + String(rand(99)).padStart(2, '0') + alphaUpper(1 + rand(2)) + digits(4);
}
// IFSC: 4-letter bank code + '0' (reserved) + 6-char branch code (commonly numeric).
export function generateIFSC(): string { return alphaUpper(4) + '0' + digits(6); }
// ABHA (health ID): 14 digits. ponytail: checksum unverified (Verhoeff plausible, unconfirmed) → pattern-only.
export function generateABHA(): string { return digits(14); }

// JWT: base64url(JSON header).base64url(JSON payload).signature — the real layout, so both
// segments decode and start with "eyJ", which is what scanners key on. The signature is random
// (43 chars = the length of an HS256 one), so it never verifies.
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const b64urlJson = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function generateJWT(): string {
  const iat = Math.floor(faker.date.recent({ days: 30 }).getTime() / 1000);
  const payload = { sub: faker.string.uuid(), iat, exp: iat + 3600 };
  return `${b64urlJson({ alg: 'HS256', typ: 'JWT' })}.${b64urlJson(payload)}.${faker.string.fromCharacters(B64URL, 43)}`;
}

// Saudi Iqama (resident permit): 10 digits, prefix 2 (nationals start with 1), Luhn check digit.
export function generateIqama(): string {
  const body = '2' + digits(8);
  return body + luhnCheckDigit(body);
}

// ---------- Mobile numbers, per locale ----------
// ponytail: Faker's national-style phone is landline-shaped and fails real mobile
// regexes (en_IN emits "06103 325 246" — 11 digits, leading 0; no Indian mobile
// looks like that). So: real operator prefixes + the ways people actually write them.
//
// India (NNP): mobile is exactly 10 digits starting 6/7/8/9. Written as +91 / 91 /
//   leading-0 trunk / bare. Matches ^(\+?91|0)?[6-9]\d{9}$.
// US (NANPA): area + exchange are NXX (N = 2-9) and never N11.
// DE: 15x/16x/17x mobile blocks; ES: 6xx/7xx; FR: 06/07; JP: 070/080/090.

/** Split `n` into groups of the given sizes (remainder becomes a final group). */
function group(n: string, sizes: number[], sep = ' '): string {
  const out: string[] = [];
  let i = 0;
  for (const s of sizes) { out.push(n.slice(i, i + s)); i += s; }
  if (i < n.length) out.push(n.slice(i));
  return out.join(sep);
}

const nanpaNxx = () => {
  let s: string;
  do { s = `${2 + rand(8)}${digits(2)}`; } while (s[1] === '1' && s[2] === '1');
  return s;
};

type MobileSpec = {
  cc: string;
  /** National significant number — no trunk prefix, no country code. */
  nsn: () => string;
  /** How the same number gets written in the wild. One is picked at random. */
  styles: ((n: string, cc: string) => string)[];
};

const MOBILES: Record<string, MobileSpec> = {
  en: {
    cc: '+1',
    nsn: () => nanpaNxx() + nanpaNxx() + digits(4),
    styles: [
      n => `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`,
      n => group(n, [3, 3], '-'),
      (n, cc) => `${cc} ${group(n, [3, 3], '-')}`,
      n => n,
    ],
  },
  en_IN: {
    cc: '+91',
    nsn: () => pick(['6', '7', '8', '9']) + digits(9),
    styles: [
      (n, cc) => `${cc} ${group(n, [5])}`,   // +91 98765 43210
      (n, cc) => `${cc}${n}`,                // +919876543210
      n => `91${n}`,                         // 919876543210
      n => `0${group(n, [5])}`,              // 098765 43210
      n => group(n, [5]),                    // 98765 43210
      n => n,                                // 9876543210
    ],
  },
  de: {
    cc: '+49',
    nsn: () => {
      const p = pick(['151', '152', '155', '157', '159', '160', '162', '163',
                      '170', '171', '172', '173', '174', '175', '176', '177', '178', '179']);
      return p + digits(p.startsWith('15') ? 8 : 7);
    },
    styles: [
      (n, cc) => `${cc} ${group(n, [3])}`,
      (n, cc) => `${cc}${n}`,
      n => `0${group(n, [3])}`,
      n => `0${n}`,
    ],
  },
  es: {
    cc: '+34',
    nsn: () => pick(['6', '7']) + digits(8),
    styles: [
      (n, cc) => `${cc} ${group(n, [3, 2, 2])}`,
      (n, cc) => `${cc}${n}`,
      n => group(n, [3, 2, 2]),
      n => n,
    ],
  },
  fr: {
    cc: '+33',
    nsn: () => pick(['6', '7']) + digits(8),
    styles: [
      n => group('0' + n, [2, 2, 2, 2]),                       // 06 12 34 56 78
      (n, cc) => `${cc} ${n[0]} ${group(n.slice(1), [2, 2, 2])}`,
      (n, cc) => `${cc}${n}`,
    ],
  },
  ja: {
    cc: '+81',
    nsn: () => pick(['70', '80', '90']) + digits(8),
    styles: [
      n => `0${group(n, [2, 4], '-')}`,                        // 090-1234-5678
      (n, cc) => `${cc} ${group(n, [2, 4], '-')}`,
      (n, cc) => `${cc}${n}`,
    ],
  },
};

const MOBILE_IDS = Object.keys(MOBILES);

/** A realistic mobile number for `locale` ('mix' → a random one), in a randomly chosen local format. */
export function generateMobile(locale = 'en'): string {
  const spec = MOBILES[locale === 'mix' ? pick(MOBILE_IDS) : locale] ?? MOBILES.en;
  const n = spec.nsn();
  return pick(spec.styles)(n, spec.cc);
}

// ---------- near-miss: mutate last alphanumeric char so checksum fails ----------
// ponytail: positional mutation is enough — every checksum we use treats the last
// char as either the check digit itself or a weighted body digit (weight != 0).
export function breakChecksum(s: string): string {
  const i = s.length - 1;
  const c = s[i];
  let next: string;
  if (/\d/.test(c)) next = String((parseInt(c, 10) + 1) % 10);
  else if (c === 'X') next = '0';                                  // VIN check
  else if (/[A-Z]/.test(c)) next = String.fromCharCode(((c.charCodeAt(0) - 65 + 1) % 26) + 65);
  else return s;
  return s.slice(0, i) + next;
}

// ---------- validators ----------
// One per column whose values obey a checksum or a published rule, keyed by column id.
// Each takes the value as the column writes it and says whether it is a valid instance.
// They power the "paste a value" playground and the checks that every generated value is
// valid and every near-miss is not. Written against the same definitions as the generators,
// so `npm test` also checks them against known-good values from outside this codebase.
const digitsOf = (s: string) => s.replace(/[\s-]/g, '');
const luhnOk = (d: string) => /^\d+$/.test(d) && luhnCheckDigit(d.slice(0, -1)) === parseInt(d.slice(-1), 10);
export const VALIDATORS: Record<string, (value: string) => boolean> = {
  ssn: s => {
    const m = /^(\d{3})-?(\d{2})-?(\d{4})$/.exec(s);
    return !!m && m[1] !== '000' && m[1] !== '666' && m[1] < '900' && m[2] !== '00' && m[3] !== '0000';
  },
  aadhaar: s => { const d = digitsOf(s); return /^[2-9]\d{11}$/.test(d) && verhoeffCheckDigit(d.slice(0, 11)) === parseInt(d[11], 10); },
  creditCard: s => { const d = digitsOf(s); return /^\d{13,19}$/.test(d) && luhnOk(d); },
  iban: s => ibanValid(digitsOf(s).toUpperCase()),
  npi: s => /^[12]\d{9}$/.test(s) && luhnOk('80840' + s),
  nhsNumber: s => {
    const d = digitsOf(s);
    if (!/^\d{10}$/.test(d)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(d[i], 10) * (10 - i);
    const check = (11 - (sum % 11)) % 11;
    return check !== 10 && check === parseInt(d[9], 10);
  },
  gstin: s => /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s) && gstinChecksum(s.slice(0, 14)) === s[14],
  vin: vinValid,
  imei: s => /^\d{15}$/.test(s) && luhnOk(s),
  ean13: s => /^\d{13}$/.test(s) && [...s].reduce((sum, c, i) => sum + parseInt(c, 10) * (i % 2 === 0 ? 1 : 3), 0) % 10 === 0,
  isin: s => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(s) && luhnOk(lettersToDigits(s)),
  iqama: s => /^[12]\d{9}$/.test(s) && luhnOk(s),
  dea: s => {
    if (!/^[A-Z]{2}\d{7}$/.test(s)) return false;
    const d = [...s.slice(2)].map(Number);
    return (d[0] + d[2] + d[4] + 2 * (d[1] + d[3] + d[5])) % 10 === d[6];
  },
  // ABA routing number: weights 3, 7, 1 repeating, sum divisible by 10.
  routingNumber: s => /^\d{9}$/.test(s) && [...s].reduce((sum, c, i) => sum + parseInt(c, 10) * [3, 7, 1][i % 3], 0) % 10 === 0,
};

// ---------- self-checks (ponytail: run via `tsx src/lib/validators.ts`) ----------
function assert(cond: any, msg: string) { if (!cond) throw new Error('FAIL: ' + msg); }
export function _selfCheck() {
  // SSN format
  assert(/^\d{3}-\d{2}-\d{4}$/.test(generateSSN()), 'SSN format');
  // Aadhaar verhoeff round-trip
  const a = generateAadhaar();
  assert(/^[2-9]\d{11}$/.test(a), 'Aadhaar format');
  assert(verhoeffCheckDigit(a.slice(0,11)) === parseInt(a[11],10), 'Aadhaar checksum');
  // PAN
  assert(/^[A-Z]{5}\d{4}[A-Z]$/.test(generatePAN()), 'PAN format');
  // GSTIN
  const g = generateGSTIN();
  assert(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9]Z[A-Z0-9]$/.test(g), 'GSTIN format');
  assert(gstinChecksum(g.slice(0,14)) === g[14], 'GSTIN checksum');
  // IBAN — registry length + BBAN layout per country, mod-97 == 1, and the near-miss fails it
  const IBAN_RE: Record<string, RegExp> = {
    DE: /^DE\d{20}$/, FR: /^FR\d{25}$/, GB: /^GB\d{2}[A-Z]{4}\d{14}$/,
    ES: /^ES\d{22}$/, IT: /^IT\d{2}[A-Z]\d{22}$/, NL: /^NL\d{2}[A-Z]{4}\d{10}$/,
  };
  for (let i = 0; i < 300; i++) {
    const ib = generateIBAN();
    assert(IBAN_RE[ib.slice(0, 2)].test(ib), `IBAN layout: ${ib}`);
    assert(ibanValid(ib), `IBAN mod-97: ${ib}`);
    assert(!ibanValid(breakChecksum(ib)), `bad IBAN still valid: ${ib}`);
  }
  assert(ibanValid('GB82WEST12345698765432') && ibanValid('NL91ABNA0417164300'), 'known-good IBANs');
  // JWT — header and payload are base64url JSON
  const [jh, jp, js] = generateJWT().split('.');
  const unb64 = (x: string) => JSON.parse(atob(x.replace(/-/g, '+').replace(/_/g, '/')));
  assert(unb64(jh).alg === 'HS256' && typeof unb64(jp).sub === 'string' && unb64(jp).exp > unb64(jp).iat, 'JWT segments decode');
  assert(jp.startsWith('eyJ') && /^[A-Za-z0-9_-]{43}$/.test(js), 'JWT shape');
  // NPI Luhn
  const n = generateNPI();
  assert(luhnCheckDigit('80840' + n.slice(0,9)) === parseInt(n[9],10), 'NPI Luhn');
  // EIN
  assert(/^\d{2}-\d{7}$/.test(generateEIN()), 'EIN format');
  // IMEI
  const im = generateIMEI();
  assert(luhnCheckDigit(im.slice(0,14)) === parseInt(im[14],10), 'IMEI Luhn');
  // EAN-13
  const e = generateEAN13();
  let s = 0; for (let i = 0; i < 13; i++) s += parseInt(e[i],10) * (i % 2 === 0 ? 1 : 3);
  assert(s % 10 === 0, 'EAN-13 mod-10');
  // NHS
  const nhs = generateNHSNumber().replace(/ /g,'');
  let ns = 0; for (let i = 0; i < 9; i++) ns += parseInt(nhs[i],10) * (10 - i);
  const expected = (11 - (ns % 11)) % 11;
  assert(expected === parseInt(nhs[9],10), 'NHS mod-11');
  // DEA
  const dea = generateDEA();
  const dd = dea.slice(2,8).split('').map(Number);
  const dsum = (dd[0]+dd[2]+dd[4]) + 2*(dd[1]+dd[3]+dd[5]);
  assert((dsum % 10) === parseInt(dea[8],10), 'DEA checksum');
  // DL formats
  assert(/^[A-Z]{2}[ -]?\d{2}[ -]?\d{4}[ -]?\d{7}$/.test(generateDLIndia()), 'DL India format');
  assert(/^[A-Z]\d{7}$/.test(generateDLUS()), 'DL US format');
  assert(generateDLUK().length === 16, 'DL UK length');
  assert(generateDLGermany().length === 11, 'DL Germany length');
  // India pattern-only identifiers
  assert(/^[a-z0-9.]+@[a-z]+$/.test(generateUPI()), 'UPI format');
  assert(/^[A-Z]{3}\d{7}$/.test(generateVoterId()), 'Voter ID format');
  assert(/^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/.test(generateVehicleRegIndia()), 'Vehicle Reg format');
  assert(/^[A-Z]{4}0\d{6}$/.test(generateIFSC()), 'IFSC format');
  assert(/^\d{14}$/.test(generateABHA()), 'ABHA format');
  // Iqama: prefix 2, Luhn-valid
  const iq = generateIqama();
  assert(/^2\d{9}$/.test(iq), 'Iqama format');
  { let s = 0, dbl = false; for (let i = iq.length - 1; i >= 0; i--) { let d = +iq[i]; if (dbl) { d *= 2; if (d > 9) d -= 9; } s += d; dbl = !dbl; } assert(s % 10 === 0, 'Iqama Luhn'); }
  // Mobile numbers: every format a locale can emit must match that locale's real shape.
  const MOBILE_RE: Record<string, RegExp> = {
    en:    /^(\+1 )?(\(\d{3}\) \d{3}-\d{4}|\d{3}-\d{3}-\d{4}|\d{10})$/,
    en_IN: /^(\+?91[ ]?|0)?[6-9]\d{4} ?\d{5}$/,
    de:    /^(\+49 ?|0)1[567]\d ?\d{7,8}$/,
    es:    /^(\+34 ?)?[67]\d{2} ?\d{2} ?\d{2} ?\d{2}$/,
    fr:    /^(\+33 [67]( \d{2}){4}|0[67]( \d{2}){4}|\+33[67]\d{8})$/,
    ja:    /^(\+81 ?|0)?(70|80|90)-?\d{4}-?\d{4}$/,
  };
  for (const [loc, re] of Object.entries(MOBILE_RE)) {
    for (let i = 0; i < 300; i++) {
      const m = generateMobile(loc);
      assert(re.test(m), `mobile ${loc} shape: ${m}`);
      // digits-only form must be the same number regardless of how it was written
      assert(m.replace(/\D/g, '').length >= 9, `mobile ${loc} length: ${m}`);
    }
  }
  // India: whatever the format, the subscriber number is 10 digits starting 6–9.
  for (let i = 0; i < 300; i++) {
    const d = generateMobile('en_IN').replace(/\D/g, '');
    const raw = d.length > 10 ? d.replace(/^(91|0)/, '') : d;  // careful: 91xxxxxxxx is also a valid bare number
    assert(/^[6-9]\d{9}$/.test(raw), `IN mobile subscriber number: ${raw}`);
  }
  assert(/^(\+1 )?(\(\d{3}\) \d{3}-\d{4}|\d{3}-\d{3}-\d{4}|\d{10})$/.test(generateMobile('nope')), 'unknown locale falls back to en');
  // near-miss: regex-shaped but checksum fails
  const badA = breakChecksum(generateAadhaar());
  assert(/^[2-9]\d{11}$/.test(badA), 'bad Aadhaar still regex-shaped');
  assert(verhoeffCheckDigit(badA.slice(0,11)) !== parseInt(badA[11],10), 'bad Aadhaar checksum fails');
  const badE = breakChecksum(generateEAN13());
  let bs = 0; for (let i = 0; i < 13; i++) bs += parseInt(badE[i],10) * (i % 2 === 0 ? 1 : 3);
  assert(bs % 10 !== 0, 'bad EAN-13 checksum fails');
  // VIN: check digit valid, and one bump of the last char always breaks it without leaving the VIN alphabet.
  assert(vinValid('1M8GDM9AXKP042788'), 'known-good VIN');
  for (let i = 0; i < 300; i++) {
    const v = generateVIN();
    assert(vinValid(v), `VIN checksum: ${v}`);
    const bad = breakChecksum(v);
    assert(/^[A-HJ-NPR-Z0-9]{17}$/.test(bad) && !vinValid(bad), `bad VIN still valid or mis-shaped: ${bad}`);
  }
  // Validators agree with values published outside this codebase (standard documentation examples).
  const KNOWN_GOOD: Record<string, string[]> = {
    creditCard: ['4111111111111111', '5555-5555-5555-4444', '378282246310005'],
    iban: ['GB82WEST12345698765432', 'DE89370400440532013000', 'NL91ABNA0417164300', 'FR1420041010050500013M02606', 'ES9121000418450200051332', 'IT60X0542811101000000123456', 'BE68539007547034'],
    vin: ['1M8GDM9AXKP042788'],
    ean13: ['4006381333931'],
    isin: ['US0378331005', 'GB0002634946'],
    imei: ['490154203237518'],
    nhsNumber: ['943 476 5919'],
    routingNumber: ['021000021', '011000015'],
    npi: ['1234567893'],
    ssn: ['078-05-1120'],
  };
  for (const [id, values] of Object.entries(KNOWN_GOOD)) {
    for (const v of values) assert(VALIDATORS[id](v), `validator ${id} rejects the known-good value ${v}`);
  }
  for (const [id, v] of Object.entries({ ssn: '666-12-3456', creditCard: '4111111111111112', iban: 'GB82WEST1234569876543', vin: '1M8GDM9A1KP042788', aadhaar: '123456789012', routingNumber: '021000022' })) {
    assert(!VALIDATORS[id](v), `validator ${id} accepts the known-bad value ${v}`);
  }
  console.log('validators: all self-checks passed');
}
