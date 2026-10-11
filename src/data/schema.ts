import { faker } from '@faker-js/faker';
import { generateGaussianInt, generateGaussianFloat } from '../lib/statistics';
import {
  generateSSN, generateAadhaar, generatePAN, generateGSTIN, generateIBAN,
  generateNPI, generateEIN, generateDLIndia, generateDLUS, generateDLUK,
  generateDLGermany, generateVIN, generateIMEI, generateEAN13, generateISIN,
  generateNHSNumber, generateDEA, breakChecksum,
  generateUPI, generateVoterId, generateVehicleRegIndia, generateIFSC, generateABHA, generateIqama,
  generateMobile, generateJWT,
} from '../lib/validators';
import type { LocaleId } from '../lib/locale';

export type PrivacyCategory = 'PII' | 'PHI' | 'PCI' | 'Secrets' | 'Biometric' | 'Network' | 'Quasi-Identifier' | 'Statistical' | 'Masked' | 'Non-Sensitive' | 'DLP-Negative' | 'Chaos';

export type ValidationKind =
  | 'free-form'      // names, lorem, jobs — no shape contract
  | 'pattern-only'   // regex-shaped but no checksum (email, phone, IP, PAN format, …)
  | 'luhn'           // credit card, IMEI
  | 'verhoeff'       // Aadhaar
  | 'mod-97'         // IBAN
  | 'mod-36'         // GSTIN
  | 'mod-11'         // NHS
  | 'mod-10'         // EAN-13, ISIN
  | 'vin-checksum'   // VIN custom mod-11
  | 'npi-luhn'       // NPI = Luhn over 80840-prefixed
  | 'chaos'          // intentionally malformed/hostile — parser + DLP robustness stressor
  | `near-miss-of:${string}`; // regex-shaped sibling whose checksum deliberately fails

export interface ColumnDef {
  id: string;
  name: string;
  category: PrivacyCategory;
  generate: (ctx: any) => any;
  defaultSelected: boolean;
  /** ISO 3166-1 alpha-2 (or 'INTL' for cross-border) for region-specific identifiers. */
  region?: string;
  /** What guarantee the column's value holds, used by the DLP manifest sidecar. */
  validation?: ValidationKind;
}

export const CATEGORY_COLORS: Record<PrivacyCategory, string> = {
  'PII': 'bg-red-100 text-red-800 border-red-200',
  'PHI': 'bg-rose-100 text-rose-800 border-rose-200',
  'PCI': 'bg-amber-100 text-amber-800 border-amber-200',
  // ponytail: fuchsia = loudest alarm — leaked secrets are the highest-severity DLP hit.
  'Secrets': 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200',
  'Biometric': 'bg-indigo-100 text-indigo-800 border-indigo-200',
  'Network': 'bg-cyan-100 text-cyan-800 border-cyan-200',
  'Quasi-Identifier': 'bg-orange-100 text-orange-800 border-orange-200',
  'Statistical': 'bg-blue-100 text-blue-800 border-blue-200',
  'Masked': 'bg-purple-100 text-purple-800 border-purple-200',
  'Non-Sensitive': 'bg-green-100 text-green-800 border-green-200',
  // ponytail: neutral/gray — signals "looks like an ID but isn't real". DLP should NOT flag these.
  'DLP-Negative': 'bg-slate-100 text-slate-700 border-slate-300',
  // ponytail: yellow = hazard tape — malformed/hostile values meant to break parsers.
  'Chaos': 'bg-yellow-100 text-yellow-800 border-yellow-300',
};

export const AVAILABLE_COLUMNS: ColumnDef[] = [
  // PII
  { id: 'firstName', name: 'First Name', category: 'PII', generate: (ctx) => ctx.firstName, defaultSelected: true },
  { id: 'lastName', name: 'Last Name', category: 'PII', generate: (ctx) => ctx.lastName, defaultSelected: true },
  { id: 'email', name: 'Email Address', category: 'PII', generate: (ctx) => (ctx.faker ?? faker).internet.email({ firstName: ctx.firstName, lastName: ctx.lastName }), defaultSelected: true },
  { id: 'phone', name: 'Phone Number', category: 'PII', generate: (ctx) => generateMobile(ctx.locale), defaultSelected: true },
  { id: 'ssn', name: 'SSN', category: 'PII', generate: () => generateSSN(), defaultSelected: false },
  { id: 'aadhaar', name: 'Aadhaar (IN)', category: 'PII', generate: () => generateAadhaar(), defaultSelected: false },
  { id: 'pan', name: 'PAN (IN)', category: 'PII', generate: () => generatePAN(), defaultSelected: false },
  { id: 'ein', name: 'EIN (US)', category: 'PII', generate: () => generateEIN(), defaultSelected: false },
  { id: 'upiId', name: 'UPI ID (IN)', category: 'PII', generate: () => generateUPI(), defaultSelected: false },
  { id: 'voterId', name: 'Voter ID (IN)', category: 'PII', generate: () => generateVoterId(), defaultSelected: false },
  { id: 'iqama', name: 'Iqama (SA)', category: 'PII', generate: () => generateIqama(), defaultSelected: false },
  { id: 'dlIndia', name: "Driver's License (IN)", category: 'PII', generate: () => generateDLIndia(), defaultSelected: false },
  { id: 'dlUS', name: "Driver's License (US)", category: 'PII', generate: () => generateDLUS(), defaultSelected: false },
  { id: 'dlUK', name: "Driver's License (UK)", category: 'PII', generate: () => generateDLUK(), defaultSelected: false },
  { id: 'dlGermany', name: "Driver's License (DE)", category: 'PII', generate: () => generateDLGermany(), defaultSelected: false },
  { id: 'passportNumber', name: 'Passport Number', category: 'PII', generate: () => faker.string.alphanumeric({ length: 9, casing: 'upper' }), defaultSelected: false },
  { id: 'driversLicense', name: 'Driver\'s License', category: 'PII', generate: () => faker.string.alphanumeric({ length: 8, casing: 'upper' }), defaultSelected: false },
  { id: 'ipAddress', name: 'IP Address', category: 'PII', generate: () => faker.internet.ipv4(), defaultSelected: false },
  { id: 'macAddress', name: 'MAC Address', category: 'PII', generate: () => faker.internet.mac(), defaultSelected: false },
  
  // PHI
  { id: 'mrn', name: 'Medical Record Number', category: 'PHI', generate: () => `MRN-${faker.string.numeric(7)}`, defaultSelected: false },
  { id: 'healthInsuranceId', name: 'Health Insurance ID', category: 'PHI', generate: () => `${faker.string.alpha({ length: 3, casing: 'upper' })}${faker.string.numeric(8)}`, defaultSelected: false },
  { id: 'bloodType', name: 'Blood Type', category: 'PHI', generate: () => faker.helpers.arrayElement(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']), defaultSelected: false },
  { id: 'diagnosisCode', name: 'ICD-10 Diagnosis', category: 'PHI', generate: () => `${faker.string.alpha({ length: 1, casing: 'upper' })}${faker.string.numeric(2)}.${faker.string.numeric(1)}`, defaultSelected: false },
  { id: 'medicalNotes', name: 'Medical Notes', category: 'PHI', generate: () => faker.lorem.sentence(), defaultSelected: false },
  { id: 'npi', name: 'NPI (US Provider)', category: 'PHI', generate: () => generateNPI(), defaultSelected: false },
  { id: 'dea', name: 'DEA Number (US)', category: 'PHI', generate: () => generateDEA(), defaultSelected: false },
  { id: 'nhsNumber', name: 'NHS Number (UK)', category: 'PHI', generate: () => generateNHSNumber(), defaultSelected: false },
  { id: 'abha', name: 'ABHA Health ID (IN)', category: 'PHI', generate: () => generateABHA(), defaultSelected: false },

  // PCI
  { id: 'creditCard', name: 'Credit Card', category: 'PCI', generate: () => faker.finance.creditCardNumber(), defaultSelected: false },
  { id: 'cvv', name: 'CVV', category: 'PCI', generate: () => faker.finance.creditCardCVV(), defaultSelected: false },
  { id: 'routingNumber', name: 'Routing Number', category: 'PCI', generate: () => faker.finance.routingNumber(), defaultSelected: false },
  { id: 'accountNumber', name: 'Account Number', category: 'PCI', generate: () => faker.finance.accountNumber(10), defaultSelected: false },
  { id: 'iban', name: 'IBAN', category: 'PCI', generate: () => generateIBAN(), defaultSelected: false },
  { id: 'ifsc', name: 'IFSC Code (IN)', category: 'PCI', generate: () => generateIFSC(), defaultSelected: false },

  // Quasi-Identifier
  { id: 'zipCode', name: 'Zip Code', category: 'Quasi-Identifier', generate: () => faker.location.zipCode(), defaultSelected: true },
  { id: 'dob', name: 'Date of Birth', category: 'Quasi-Identifier', generate: (ctx) => ctx.dob.toISOString().split('T')[0], defaultSelected: true },
  { id: 'gender', name: 'Gender', category: 'Quasi-Identifier', generate: (ctx) => ctx.gender, defaultSelected: true },
  { id: 'ethnicity', name: 'Ethnicity', category: 'Quasi-Identifier', generate: () => faker.helpers.arrayElement(['Asian', 'Black', 'Hispanic', 'White', 'Other']), defaultSelected: false },
  { id: 'city', name: 'City', category: 'Quasi-Identifier', generate: (ctx) => (ctx.faker ?? faker).location.city(), defaultSelected: false },
  { id: 'jobTitle', name: 'Job Title', category: 'Quasi-Identifier', generate: (ctx) => (ctx.faker ?? faker).person.jobTitle(), defaultSelected: false },
  { id: 'department', name: 'Department', category: 'Quasi-Identifier', generate: () => faker.commerce.department(), defaultSelected: false },
  { id: 'major', name: 'Major', category: 'Quasi-Identifier', generate: (ctx) => (ctx.faker ?? faker).person.jobArea(), defaultSelected: false },
  { id: 'university', name: 'University', category: 'Quasi-Identifier', generate: (ctx) => `University of ${(ctx.faker ?? faker).location.state()}`, defaultSelected: false },
  { id: 'gstin', name: 'GSTIN (IN)', category: 'Quasi-Identifier', generate: () => generateGSTIN(), defaultSelected: false },
  { id: 'vin', name: 'VIN (Vehicle)', category: 'Quasi-Identifier', generate: () => generateVIN(), defaultSelected: false },
  { id: 'imei', name: 'IMEI', category: 'Quasi-Identifier', generate: () => generateIMEI(), defaultSelected: false },
  { id: 'vehicleRegIndia', name: 'Vehicle Reg (IN)', category: 'Quasi-Identifier', generate: () => generateVehicleRegIndia(), defaultSelected: false },
  
  // Statistical
  { id: 'salary', name: 'Salary', category: 'Statistical', generate: () => generateGaussianInt(30000, 200000, 1.5), defaultSelected: true },
  { id: 'age', name: 'Age', category: 'Statistical', generate: (ctx) => ctx.age, defaultSelected: true },
  { id: 'purchaseCount', name: 'Purchase Count', category: 'Statistical', generate: () => generateGaussianInt(0, 500, 1.2), defaultSelected: false },
  { id: 'accountBalance', name: 'Account Balance', category: 'Statistical', generate: () => generateGaussianFloat(0, 50000, 2, 1.3), defaultSelected: false },
  { id: 'creditScore', name: 'Credit Score', category: 'Statistical', generate: () => generateGaussianInt(300, 850, 0.9), defaultSelected: false },
  { id: 'gpa', name: 'GPA', category: 'Statistical', generate: () => generateGaussianFloat(2.0, 4.0, 2, 1.1), defaultSelected: false },
  { id: 'performanceScore', name: 'Performance Score', category: 'Statistical', generate: () => generateGaussianFloat(1.0, 5.0, 1, 1), defaultSelected: false },
  { id: 'loanAmount', name: 'Loan Amount', category: 'Statistical', generate: () => generateGaussianInt(1000, 500000, 1.4), defaultSelected: false },
  
  // Masked
  { id: 'maskedEmail', name: 'Masked Email', category: 'Masked', generate: (ctx) => {
      const email = (ctx.faker ?? faker).internet.email({ firstName: ctx.firstName, lastName: ctx.lastName });
      const [local, domain] = email.split('@');
      return `${local.charAt(0)}***@${domain}`;
    }, defaultSelected: true },
  { id: 'hashedId', name: 'Hashed User ID', category: 'Masked', generate: () => faker.string.uuid(), defaultSelected: true },
  { id: 'last4SSN', name: 'Last 4 SSN', category: 'Masked', generate: () => faker.string.numeric(4), defaultSelected: false },
  { id: 'tokenizedCard', name: 'Tokenized Card', category: 'Masked', generate: () => `****-****-****-${faker.string.numeric(4)}`, defaultSelected: false },
  { id: 'maskedAccount', name: 'Masked Account', category: 'Masked', generate: () => `******${faker.string.numeric(4)}`, defaultSelected: false },
  
  // Non-Sensitive
  { id: 'transactionId', name: 'Transaction ID', category: 'Non-Sensitive', generate: () => faker.string.alphanumeric(10).toUpperCase(), defaultSelected: true },
  { id: 'createdAt', name: 'Created At', category: 'Non-Sensitive', generate: () => faker.date.recent({ days: 30 }).toISOString(), defaultSelected: true },
  { id: 'deviceType', name: 'Device Type', category: 'Non-Sensitive', generate: () => faker.helpers.arrayElement(['Mobile', 'Desktop', 'Tablet']), defaultSelected: false },
  { id: 'storeLocation', name: 'Store Location', category: 'Non-Sensitive', generate: () => faker.location.state(), defaultSelected: false },
  { id: 'hireDate', name: 'Hire Date', category: 'Non-Sensitive', generate: () => faker.date.past({ years: 10 }).toISOString().split('T')[0], defaultSelected: false },
  { id: 'graduationYear', name: 'Graduation Year', category: 'Non-Sensitive', generate: () => faker.date.future({ years: 4 }).getUTCFullYear(), defaultSelected: false },
  { id: 'lastLogin', name: 'Last Login', category: 'Non-Sensitive', generate: () => faker.date.recent({ days: 5 }).toISOString(), defaultSelected: false },
  { id: 'subscriptionTier', name: 'Subscription Tier', category: 'Non-Sensitive', generate: () => faker.helpers.arrayElement(['Free', 'Basic', 'Premium', 'Enterprise']), defaultSelected: false },
  { id: 'employeeId', name: 'Employee ID', category: 'Non-Sensitive', generate: () => `EMP-${faker.string.numeric(5)}`, defaultSelected: false },
  { id: 'studentId', name: 'Student ID', category: 'Non-Sensitive', generate: () => faker.string.numeric(8), defaultSelected: false },
  { id: 'crmId', name: 'CRM ID', category: 'Non-Sensitive', generate: () => `CUST-${faker.string.numeric(6)}`, defaultSelected: false },
  { id: 'ean13', name: 'EAN-13 Barcode', category: 'Non-Sensitive', generate: () => generateEAN13(), defaultSelected: false },
  { id: 'isin', name: 'ISIN (Security)', category: 'Non-Sensitive', generate: () => generateISIN(), defaultSelected: false },

  // Secrets / Credentials — what secret scanners (Gitleaks, TruffleHog, GitHub scanning) hunt.
  // Pattern-only: each has a distinct vendor prefix/shape; none carry a checksum we validate.
  // AWS key IDs are base32 (A–Z, 2–7) after the prefix.
  { id: 'awsAccessKey',   name: 'AWS Access Key ID',   category: 'Secrets', generate: () => `AKIA${faker.string.fromCharacters('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', 16)}`, defaultSelected: false },
  { id: 'awsSecretKey',   name: 'AWS Secret Access Key', category: 'Secrets', generate: () => faker.string.alphanumeric({ length: 40 }), defaultSelected: false },
  { id: 'githubPAT',      name: 'GitHub Token',        category: 'Secrets', generate: () => `ghp_${faker.string.alphanumeric({ length: 36 })}`, defaultSelected: false },
  { id: 'stripeKey',      name: 'Stripe Secret Key',   category: 'Secrets', generate: () => `sk_live_${faker.string.alphanumeric({ length: 24 })}`, defaultSelected: false },
  { id: 'googleApiKey',   name: 'Google API Key',      category: 'Secrets', generate: () => `AIza${faker.string.alphanumeric({ length: 35 })}`, defaultSelected: false },
  { id: 'jwt',            name: 'JWT',                 category: 'Secrets', generate: () => generateJWT(), defaultSelected: false },
  { id: 'bcryptHash',     name: 'Bcrypt Password Hash', category: 'Secrets', generate: () => `$2b$10$${faker.string.alphanumeric({ length: 53 })}`, defaultSelected: false },
  { id: 'privateKeyPem',  name: 'PEM Private Key',     category: 'Secrets', generate: () => `-----BEGIN RSA PRIVATE KEY-----\n${faker.string.alphanumeric({ length: 64 })}\n${faker.string.alphanumeric({ length: 64 })}\n-----END RSA PRIVATE KEY-----`, defaultSelected: false },
  { id: 'basicAuthUrl',   name: 'Basic-Auth URL',      category: 'Secrets', generate: () => `https://${faker.internet.username().toLowerCase()}:${faker.internet.password({ length: 12 })}@${faker.internet.domainName()}`, defaultSelected: false },

  // Biometric — GDPR Art.9 / CCPA special category. Real systems store opaque templates/vectors, never raw scans.
  { id: 'fingerprintHash', name: 'Fingerprint Template', category: 'Biometric', generate: () => faker.string.hexadecimal({ length: 64, casing: 'lower', prefix: '' }), defaultSelected: false },
  { id: 'faceEmbeddingId', name: 'Face Embedding ID',    category: 'Biometric', generate: () => `FACE-${faker.string.uuid()}`, defaultSelected: false },
  { id: 'voiceprintId',    name: 'Voiceprint ID',        category: 'Biometric', generate: () => `VOICE-${faker.string.uuid()}`, defaultSelected: false },
  { id: 'irisScanId',      name: 'Iris Scan ID',         category: 'Biometric', generate: () => `IRIS-${faker.string.alphanumeric({ length: 24, casing: 'upper' })}`, defaultSelected: false },

  // Network / Telemetry — log-DLP territory beyond the endpoint. Extends the existing IPv4/MAC coverage.
  { id: 'ipv6Address',     name: 'IPv6 Address',      category: 'Network', generate: () => faker.internet.ipv6(), defaultSelected: false },
  { id: 'userAgent',       name: 'User Agent',        category: 'Network', generate: () => faker.internet.userAgent(), defaultSelected: false },
  { id: 'sessionCookie',   name: 'Session Cookie',    category: 'Network', generate: () => `sid=${faker.string.hexadecimal({ length: 40, casing: 'lower', prefix: '' })}`, defaultSelected: false },
  { id: 'internalHostname', name: 'Internal Hostname', category: 'Network', generate: () => `${faker.internet.domainWord()}-${faker.number.int({ min: 1, max: 99 })}.internal.corp`, defaultSelected: false },
  { id: 'cidrBlock',       name: 'CIDR Block',        category: 'Network', generate: () => `${faker.internet.ipv4()}/${faker.number.int({ min: 8, max: 30 })}`, defaultSelected: false },
  { id: 'geoCoordinates',  name: 'Geo Coordinates',   category: 'Network', generate: () => `${faker.location.latitude()}, ${faker.location.longitude()}`, defaultSelected: false },

  // Near-miss siblings: regex-shaped, checksum deliberately broken. Category is DLP-Negative because
  // a well-behaved DLP should NOT flag these — they're the false-positive control set.
  { id: 'aadhaar_invalid',    name: 'Aadhaar (near-miss)',     category: 'DLP-Negative', generate: () => breakChecksum(generateAadhaar()),    defaultSelected: false },
  { id: 'creditCard_invalid', name: 'Credit Card (near-miss)', category: 'DLP-Negative', generate: () => breakChecksum(faker.finance.creditCardNumber()), defaultSelected: false },
  { id: 'iban_invalid',       name: 'IBAN (near-miss)',        category: 'DLP-Negative', generate: () => breakChecksum(generateIBAN()),       defaultSelected: false },
  { id: 'npi_invalid',        name: 'NPI (near-miss)',         category: 'DLP-Negative', generate: () => breakChecksum(generateNPI()),        defaultSelected: false },
  { id: 'nhsNumber_invalid',  name: 'NHS Number (near-miss)',  category: 'DLP-Negative', generate: () => breakChecksum(generateNHSNumber()),  defaultSelected: false },
  { id: 'gstin_invalid',      name: 'GSTIN (near-miss)',       category: 'DLP-Negative', generate: () => breakChecksum(generateGSTIN()),      defaultSelected: false },
  { id: 'vin_invalid',        name: 'VIN (near-miss)',         category: 'DLP-Negative', generate: () => breakChecksum(generateVIN()),        defaultSelected: false },
  { id: 'imei_invalid',       name: 'IMEI (near-miss)',        category: 'DLP-Negative', generate: () => breakChecksum(generateIMEI()),       defaultSelected: false },
  { id: 'ean13_invalid',      name: 'EAN-13 (near-miss)',      category: 'DLP-Negative', generate: () => breakChecksum(generateEAN13()),      defaultSelected: false },
  { id: 'isin_invalid',       name: 'ISIN (near-miss)',        category: 'DLP-Negative', generate: () => breakChecksum(generateISIN()),       defaultSelected: false },
  { id: 'iqama_invalid',      name: 'Iqama (near-miss)',       category: 'DLP-Negative', generate: () => breakChecksum(generateIqama()),      defaultSelected: false },

  // Chaos / Malformed — intentionally hostile values that stress parsers, CSV escaping, and DLP engines.
  // ponytail: fixed payload pools picked via seeded faker.helpers.arrayElement — reproducible under a seed.
  { id: 'chaosEmpty',     name: 'Empty / Blank',      category: 'Chaos', generate: () => faker.helpers.arrayElement(['', ' ', '   ', '\t', '\n']), defaultSelected: false },
  { id: 'chaosUnicode',   name: 'Unicode Stress',     category: 'Chaos', generate: () => faker.helpers.arrayElement(['🔥💀🎭', 'مرحبا بك', 'שלום עולם', 'áè combining', 'zero​width', '𝕦𝕟𝕚𝕔𝕠𝕕𝕖', '👨‍👩‍👧‍👦']), defaultSelected: false },
  { id: 'chaosSqli',      name: 'SQL Injection',      category: 'Chaos', generate: () => faker.helpers.arrayElement(["' OR '1'='1", "'; DROP TABLE users;--", "1' UNION SELECT NULL--", "admin'--", '" OR 1=1--']), defaultSelected: false },
  { id: 'chaosXss',       name: 'XSS / HTML Payload', category: 'Chaos', generate: () => faker.helpers.arrayElement(['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg/onload=alert(1)>', '{{7*7}}', '${jndi:ldap://x}']), defaultSelected: false },
  { id: 'chaosHomoglyph', name: 'Homoglyph',          category: 'Chaos', generate: () => faker.helpers.arrayElement(['аdmin', 'раypal', 'gооgle', 'аpple.com', 'miсrosoft']), defaultSelected: false },
  { id: 'chaosLong',      name: 'Oversized String',   category: 'Chaos', generate: () => 'A'.repeat(512), defaultSelected: false },
  { id: 'chaosCsvBreak',  name: 'CSV Breaker',        category: 'Chaos', generate: () => faker.helpers.arrayElement(['a,b,"c"', 'line1\nline2', 'tab\there', '"quoted, value"', 'trailing,']), defaultSelected: false },
  { id: 'chaosNumeric',   name: 'Numeric Edge',       category: 'Chaos', generate: () => faker.helpers.arrayElement(['007', '1e309', '-0', '9'.repeat(30), '0x1F', '+1.0E-10', 'NaN']), defaultSelected: false },
];

// DLP manifest metadata — co-located with the column list so additions stay in sync.
// Anything not listed defaults to { validation: 'free-form', region: undefined }.
const COLUMN_DLP_META: Record<string, Partial<Pick<ColumnDef, 'region' | 'validation'>>> = {
  // PII — region-specific identifiers
  ssn:         { region: 'US', validation: 'pattern-only' },
  aadhaar:     { region: 'IN', validation: 'verhoeff' },
  pan:         { region: 'IN', validation: 'pattern-only' },
  ein:         { region: 'US', validation: 'pattern-only' },
  upiId:       { region: 'IN', validation: 'pattern-only' },
  voterId:     { region: 'IN', validation: 'pattern-only' },
  iqama:       { region: 'SA', validation: 'luhn' },
  dlIndia:     { region: 'IN', validation: 'pattern-only' },
  dlUS:        { region: 'US', validation: 'pattern-only' },
  dlUK:        { region: 'UK', validation: 'pattern-only' },
  dlGermany:   { region: 'DE', validation: 'pattern-only' },
  passportNumber:  { validation: 'pattern-only' },
  driversLicense:  { validation: 'pattern-only' },
  email:       { validation: 'pattern-only' },
  phone:       { validation: 'pattern-only' },
  ipAddress:   { validation: 'pattern-only' },
  macAddress:  { validation: 'pattern-only' },
  // PHI
  mrn:         { validation: 'pattern-only' },
  healthInsuranceId: { validation: 'pattern-only' },
  diagnosisCode:     { validation: 'pattern-only' },
  npi:         { region: 'US', validation: 'npi-luhn' },
  dea:         { region: 'US', validation: 'pattern-only' },
  nhsNumber:   { region: 'UK', validation: 'mod-11' },
  abha:        { region: 'IN', validation: 'pattern-only' },
  // PCI
  creditCard:  { validation: 'luhn' },
  cvv:         { validation: 'pattern-only' },
  routingNumber:  { region: 'US', validation: 'pattern-only' },
  accountNumber:  { validation: 'pattern-only' },
  iban:        { region: 'INTL', validation: 'mod-97' },
  ifsc:        { region: 'IN', validation: 'pattern-only' },
  // Quasi-Identifier
  zipCode:     { validation: 'pattern-only' },
  gstin:       { region: 'IN', validation: 'mod-36' },
  vin:         { validation: 'vin-checksum' },
  imei:        { validation: 'luhn' },
  vehicleRegIndia: { region: 'IN', validation: 'pattern-only' },
  // Masked
  maskedEmail: { validation: 'pattern-only' },
  hashedId:    { validation: 'pattern-only' },
  last4SSN:    { region: 'US', validation: 'pattern-only' },
  tokenizedCard:  { validation: 'pattern-only' },
  maskedAccount:  { validation: 'pattern-only' },
  // Non-Sensitive
  ean13:       { validation: 'mod-10' },
  isin:        { validation: 'mod-10' },
  // Secrets / Biometric / Network — pattern-shaped (distinct regex signature), no locale.
  awsAccessKey:    { region: 'INTL', validation: 'pattern-only' },
  awsSecretKey:    { region: 'INTL', validation: 'pattern-only' },
  githubPAT:       { region: 'INTL', validation: 'pattern-only' },
  stripeKey:       { region: 'INTL', validation: 'pattern-only' },
  googleApiKey:    { region: 'INTL', validation: 'pattern-only' },
  jwt:             { region: 'INTL', validation: 'pattern-only' },
  bcryptHash:      { region: 'INTL', validation: 'pattern-only' },
  privateKeyPem:   { region: 'INTL', validation: 'pattern-only' },
  basicAuthUrl:    { region: 'INTL', validation: 'pattern-only' },
  fingerprintHash: { region: 'INTL', validation: 'pattern-only' },
  faceEmbeddingId: { region: 'INTL', validation: 'pattern-only' },
  voiceprintId:    { region: 'INTL', validation: 'pattern-only' },
  irisScanId:      { region: 'INTL', validation: 'pattern-only' },
  ipv6Address:     { region: 'INTL', validation: 'pattern-only' },
  sessionCookie:   { region: 'INTL', validation: 'pattern-only' },
  cidrBlock:       { region: 'INTL', validation: 'pattern-only' },
  // Near-miss siblings inherit region from their origin, validation = `near-miss-of:<originId>`.
  aadhaar_invalid:    { region: 'IN',   validation: 'near-miss-of:aadhaar' },
  creditCard_invalid: {                 validation: 'near-miss-of:creditCard' },
  iban_invalid:       { region: 'INTL', validation: 'near-miss-of:iban' },
  npi_invalid:        { region: 'US',   validation: 'near-miss-of:npi' },
  nhsNumber_invalid:  { region: 'UK',   validation: 'near-miss-of:nhsNumber' },
  gstin_invalid:      { region: 'IN',   validation: 'near-miss-of:gstin' },
  vin_invalid:        {                 validation: 'near-miss-of:vin' },
  imei_invalid:       {                 validation: 'near-miss-of:imei' },
  ean13_invalid:      {                 validation: 'near-miss-of:ean13' },
  isin_invalid:       {                 validation: 'near-miss-of:isin' },
  iqama_invalid:      { region: 'SA',   validation: 'near-miss-of:iqama' },
  // Chaos — all malformed by design.
  chaosEmpty:     { validation: 'chaos' },
  chaosUnicode:   { validation: 'chaos' },
  chaosSqli:      { validation: 'chaos' },
  chaosXss:       { validation: 'chaos' },
  chaosHomoglyph: { validation: 'chaos' },
  chaosLong:      { validation: 'chaos' },
  chaosCsvBreak:  { validation: 'chaos' },
  chaosNumeric:   { validation: 'chaos' },
};

AVAILABLE_COLUMNS.forEach(col => {
  const meta = COLUMN_DLP_META[col.id];
  if (meta) Object.assign(col, meta);
});

// What a detector should do with a column — the idea the whole tool is built on, made explicit.
//   detect:  sensitive; a detector should flag it
//   ignore:  benign, or shaped like an identifier but deliberately not one; flagging it is a false positive
//   context: sensitive only in combination or by policy; reported, never scored
export type Expectation = 'detect' | 'ignore' | 'context';

export const EXPECTATION_LABELS: Record<Expectation, string> = {
  detect: 'Should fire',
  ignore: 'Should not fire',
  context: 'Depends on context',
};

const CATEGORY_EXPECTATION: Record<PrivacyCategory, Expectation> = {
  'PII': 'detect', 'PHI': 'detect', 'PCI': 'detect', 'Secrets': 'detect', 'Biometric': 'detect',
  'Network': 'context', 'Quasi-Identifier': 'context',
  'Statistical': 'ignore', 'Masked': 'ignore', 'Non-Sensitive': 'ignore', 'DLP-Negative': 'ignore', 'Chaos': 'ignore',
};

// The few columns whose category undersells or oversells them.
const EXPECTATION_OVERRIDES: Record<string, Expectation> = {
  // Registered identifiers of a business, vehicle or device, filed under Quasi-Identifier.
  gstin: 'detect', vin: 'detect', imei: 'detect', vehicleRegIndia: 'detect',
  // An IPv6 address is as identifying as the IPv4 one under PII; a session cookie is a credential.
  ipv6Address: 'detect', sessionCookie: 'detect',
  // Assigned to one person, but meaningless outside the system that issued them.
  employeeId: 'context', studentId: 'context', crmId: 'context',
  // A quasi-identifier that happens to be a number.
  age: 'context',
};

export function expectationFor(col: Pick<ColumnDef, 'id' | 'category'>): Expectation {
  return EXPECTATION_OVERRIDES[col.id] ?? CATEGORY_EXPECTATION[col.category];
}

export const PRESETS: Record<string, string[]> = {
  'Common Users': ['firstName', 'lastName', 'email', 'phone', 'dob', 'gender', 'city', 'createdAt', 'lastLogin'],
  'HR / Employees': ['employeeId', 'firstName', 'lastName', 'email', 'phone', 'ssn', 'dob', 'gender', 'department', 'jobTitle', 'hireDate', 'salary', 'performanceScore'],
  'CRM / Customers': ['crmId', 'firstName', 'lastName', 'email', 'phone', 'city', 'purchaseCount', 'subscriptionTier', 'lastLogin', 'deviceType'],
  'Bank / Fintech': ['hashedId', 'firstName', 'lastName', 'email', 'phone', 'ssn', 'dob', 'accountNumber', 'routingNumber', 'accountBalance', 'creditScore', 'loanAmount', 'tokenizedCard'],
  'Healthcare / Patients': ['mrn', 'firstName', 'lastName', 'dob', 'gender', 'bloodType', 'diagnosisCode', 'healthInsuranceId', 'phone', 'city', 'medicalNotes'],
  'Education / Students': ['studentId', 'firstName', 'lastName', 'email', 'dob', 'gender', 'university', 'major', 'gpa', 'graduationYear'],
  'Technical / IT': ['hashedId', 'ipAddress', 'macAddress', 'deviceType', 'lastLogin', 'createdAt', 'subscriptionTier'],
  // DLP testing
  'DLP Detection Test': ['firstName', 'lastName', 'email', 'phone', 'ssn', 'aadhaar', 'pan', 'gstin', 'iban', 'creditCard', 'npi', 'nhsNumber', 'ein', 'vin', 'imei', 'ean13', 'isin'],
  'DLP False-Positive Test': ['firstName', 'email', 'aadhaar_invalid', 'creditCard_invalid', 'iban_invalid', 'npi_invalid', 'nhsNumber_invalid', 'gstin_invalid', 'vin_invalid', 'imei_invalid', 'ean13_invalid', 'isin_invalid'],
  'Secrets Leak Test': ['awsAccessKey', 'awsSecretKey', 'githubPAT', 'stripeKey', 'googleApiKey', 'jwt', 'bcryptHash', 'privateKeyPem', 'basicAuthUrl'],
  'App Telemetry': ['crmId', 'ipAddress', 'ipv6Address', 'macAddress', 'userAgent', 'sessionCookie', 'internalHostname', 'cidrBlock', 'geoCoordinates', 'lastLogin', 'deviceType'],
  'Biometric / Special-Category': ['firstName', 'lastName', 'dob', 'fingerprintHash', 'faceEmbeddingId', 'voiceprintId', 'irisScanId'],
  'Chaos / Malformed': ['firstName', 'email', 'chaosEmpty', 'chaosUnicode', 'chaosSqli', 'chaosXss', 'chaosHomoglyph', 'chaosLong', 'chaosCsvBreak', 'chaosNumeric'],
  // Region-focused
  'India PII': ['firstName', 'lastName', 'aadhaar', 'pan', 'voterId', 'upiId', 'vehicleRegIndia', 'dlIndia', 'phone', 'email', 'dob', 'gender'],
  'India Fintech': ['firstName', 'lastName', 'pan', 'aadhaar', 'upiId', 'ifsc', 'accountNumber', 'creditScore', 'loanAmount', 'phone', 'email'],
  'US Healthcare': ['firstName', 'lastName', 'ssn', 'mrn', 'npi', 'dea', 'healthInsuranceId', 'bloodType', 'diagnosisCode', 'dob', 'gender'],
  'EU GDPR Sweep': ['firstName', 'lastName', 'iban', 'dlGermany', 'dlUK', 'email', 'phone', 'ipAddress', 'macAddress', 'dob', 'city'],
};

/**
 * Presets that also switch the locale, so names/addresses/phone match the region
 * the preset is about (an "India PII" sheet with US phone numbers is useless).
 * The user can still change the locale afterwards.
 */
export const PRESET_LOCALES: Record<string, LocaleId> = {
  'India PII': 'en_IN',
  'India Fintech': 'en_IN',
  'US Healthcare': 'en',
  'EU GDPR Sweep': 'de',
};
