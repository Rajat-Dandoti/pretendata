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

// IBAN: simplified — country + 2 check digits + BBAN of country-typical length
const IBAN_SPECS: Record<string, number> = { DE: 18, FR: 23, GB: 18, ES: 20, IT: 23, NL: 14 };
export function generateIBAN(): string {
  const country = pick(Object.keys(IBAN_SPECS));
  const bbanLen = IBAN_SPECS[country] - 4;
  const bban = digits(bbanLen);
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

// VIN — Faker is checksum-valid
export function generateVIN(): string { return faker.vehicle.vin(); }

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

// Saudi Iqama (resident permit): 10 digits, prefix 2 (nationals start with 1), Luhn check digit.
export function generateIqama(): string {
  const body = '2' + digits(8);
  return body + luhnCheckDigit(body);
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
  // IBAN — verify mod-97 == 1
  const ib = generateIBAN();
  const rearr = ib.slice(4) + ib.slice(0,4);
  assert(mod97(lettersToDigits(rearr)) === 1, 'IBAN mod-97');
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
  // near-miss: regex-shaped but checksum fails
  const badA = breakChecksum(generateAadhaar());
  assert(/^[2-9]\d{11}$/.test(badA), 'bad Aadhaar still regex-shaped');
  assert(verhoeffCheckDigit(badA.slice(0,11)) !== parseInt(badA[11],10), 'bad Aadhaar checksum fails');
  const badE = breakChecksum(generateEAN13());
  let bs = 0; for (let i = 0; i < 13; i++) bs += parseInt(badE[i],10) * (i % 2 === 0 ? 1 : 3);
  assert(bs % 10 !== 0, 'bad EAN-13 checksum fails');
  console.log('validators: all self-checks passed');
}
