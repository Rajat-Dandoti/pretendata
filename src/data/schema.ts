import { faker } from '@faker-js/faker';
import { generateGaussianInt, generateGaussianFloat } from '../lib/statistics';
import {
  generateSSN, generateAadhaar, generatePAN, generateGSTIN, generateIBAN,
  generateNPI, generateEIN, generateDLIndia, generateDLUS, generateDLUK,
  generateDLGermany, generateVIN, generateIMEI, generateEAN13, generateISIN,
  generateNHSNumber, generateDEA, breakChecksum,
  generateUPI, generateVoterId, generateVehicleRegIndia, generateIFSC, generateABHA, generateIqama,
  generateMobile, generateJWT,
  negative, generateSSNNeverIssued, generateAadhaarWrongPrefix, transposeDigits,
  generateSIN, generateCPF, generateCNPJ, generateITIN, generateNINO, generateDNI, generateNIE, generateBSN, generateNIR,
  generateNRIC, generateTFN, generateChinaId, generateSouthAfricaId, generateEmiratesId,
} from '../lib/validators';
import type { LocaleId } from '../lib/locale';
import { CLINICAL_SENTENCES, ICD10_CODES, LAB_RESULTS, MEDICATIONS, POLITICAL_VIEWS, RELIGIONS, UNIONS } from './templates';

export type PrivacyCategory = 'PII' | 'PHI' | 'PCI' | 'Secrets' | 'Biometric' | 'Network' | 'Quasi-Identifier' | 'Statistical' | 'Masked' | 'Non-Sensitive' | 'DLP-Negative' | 'Chaos';

export type ValidationKind =
  | 'free-form'      // names, lorem, jobs — no shape contract
  | 'pattern-only'   // regex-shaped but no checksum (email, phone, IP, PAN format, …)
  | 'luhn'           // credit card, IMEI
  | 'verhoeff'       // Aadhaar
  | 'mod-97'         // IBAN
  | 'mod-36'         // GSTIN
  | 'mod-11'         // NHS, CPF, CNPJ, BSN, NRIC, TFN, China resident ID
  | 'mod-23'         // Spain DNI / NIE check letter
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

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

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
  // National identifiers by region. Where the number encodes a birth date or sex, it is the row's own.
  { id: 'usItin',          name: 'ITIN (US)',             category: 'PII', generate: () => generateITIN(), defaultSelected: false },
  { id: 'canadaSin',       name: 'SIN (CA)',              category: 'PII', generate: () => generateSIN(), defaultSelected: false },
  { id: 'brazilCpf',       name: 'CPF (BR)',              category: 'PII', generate: () => generateCPF(), defaultSelected: false },
  { id: 'brazilCnpj',      name: 'CNPJ (BR)',             category: 'PII', generate: () => generateCNPJ(), defaultSelected: false },
  { id: 'ukNino',          name: 'National Insurance No (UK)', category: 'PII', generate: () => generateNINO(), defaultSelected: false },
  { id: 'spainDni',        name: 'DNI (ES)',              category: 'PII', generate: () => generateDNI(), defaultSelected: false },
  { id: 'spainNie',        name: 'NIE (ES)',              category: 'PII', generate: () => generateNIE(), defaultSelected: false },
  { id: 'netherlandsBsn',  name: 'BSN (NL)',              category: 'PII', generate: () => generateBSN(), defaultSelected: false },
  { id: 'franceNir',       name: 'NIR (FR)',              category: 'PII', generate: (ctx) => generateNIR(ctx.dob, ctx.sex), defaultSelected: false },
  { id: 'singaporeNric',   name: 'NRIC (SG)',             category: 'PII', generate: (ctx) => generateNRIC(ctx.dob), defaultSelected: false },
  { id: 'australiaTfn',    name: 'TFN (AU)',              category: 'PII', generate: () => generateTFN(), defaultSelected: false },
  { id: 'chinaResidentId', name: 'Resident ID (CN)',      category: 'PII', generate: (ctx) => generateChinaId(ctx.dob, ctx.sex), defaultSelected: false },
  { id: 'southAfricaId',   name: 'ID Number (ZA)',        category: 'PII', generate: (ctx) => generateSouthAfricaId(ctx.dob, ctx.sex), defaultSelected: false },
  { id: 'uaeEmiratesId',   name: 'Emirates ID (AE)',      category: 'PII', generate: (ctx) => generateEmiratesId(ctx.dob), defaultSelected: false },
  { id: 'indiaPassport',   name: 'Passport (IN)',         category: 'PII', generate: () => `${faker.string.alpha({ length: 1, casing: 'upper' })}${faker.string.numeric(7)}`, defaultSelected: false },
  { id: 'uan',             name: 'UAN (IN)',              category: 'PII', generate: () => `10${faker.string.numeric(10)}`, defaultSelected: false },
  
  // PHI
  { id: 'mrn', name: 'Medical Record Number', category: 'PHI', generate: () => `MRN-${faker.string.numeric(7)}`, defaultSelected: false },
  { id: 'healthInsuranceId', name: 'Health Insurance ID', category: 'PHI', generate: () => `${faker.string.alpha({ length: 3, casing: 'upper' })}${faker.string.numeric(8)}`, defaultSelected: false },
  { id: 'bloodType', name: 'Blood Type', category: 'PHI', generate: () => faker.helpers.arrayElement(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']), defaultSelected: false },
  { id: 'diagnosisCode', name: 'ICD-10 Diagnosis', category: 'PHI', generate: () => faker.helpers.arrayElement(ICD10_CODES), defaultSelected: false },
  { id: 'medicalNotes', name: 'Medical Notes', category: 'PHI', generate: () => faker.helpers.arrayElement(CLINICAL_SENTENCES), defaultSelected: false },
  { id: 'npi', name: 'NPI (US Provider)', category: 'PHI', generate: () => generateNPI(), defaultSelected: false },
  { id: 'dea', name: 'DEA Number (US)', category: 'PHI', generate: () => generateDEA(), defaultSelected: false },
  { id: 'nhsNumber', name: 'NHS Number (UK)', category: 'PHI', generate: () => generateNHSNumber(), defaultSelected: false },
  { id: 'abha', name: 'ABHA Health ID (IN)', category: 'PHI', generate: () => generateABHA(), defaultSelected: false },
  { id: 'medication', name: 'Medication', category: 'PHI', generate: () => faker.helpers.arrayElement(MEDICATIONS), defaultSelected: false },
  { id: 'labResult', name: 'Lab Result', category: 'PHI', generate: () => faker.helpers.arrayElement(LAB_RESULTS)(), defaultSelected: false },

  // PCI
  { id: 'creditCard', name: 'Credit Card', category: 'PCI', generate: () => faker.finance.creditCardNumber(), defaultSelected: false },
  { id: 'cvv', name: 'CVV', category: 'PCI', generate: () => faker.finance.creditCardCVV(), defaultSelected: false },
  { id: 'routingNumber', name: 'Routing Number', category: 'PCI', generate: () => faker.finance.routingNumber(), defaultSelected: false },
  { id: 'accountNumber', name: 'Account Number', category: 'PCI', generate: () => faker.finance.accountNumber(10), defaultSelected: false },
  { id: 'iban', name: 'IBAN', category: 'PCI', generate: () => generateIBAN(), defaultSelected: false },
  { id: 'ifsc', name: 'IFSC Code (IN)', category: 'PCI', generate: () => generateIFSC(), defaultSelected: false },
  { id: 'cardExpiry', name: 'Card Expiry', category: 'PCI', generate: () => { const d = faker.date.future({ years: 5 }); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(2)}`; }, defaultSelected: false },

  // Quasi-Identifier
  { id: 'zipCode', name: 'Zip Code', category: 'Quasi-Identifier', generate: () => faker.location.zipCode(), defaultSelected: true },
  { id: 'dob', name: 'Date of Birth', category: 'Quasi-Identifier', generate: (ctx) => ctx.dob.toISOString().split('T')[0], defaultSelected: true },
  { id: 'gender', name: 'Gender', category: 'Quasi-Identifier', generate: (ctx) => ctx.gender, defaultSelected: true },
  { id: 'ethnicity', name: 'Ethnicity', category: 'Quasi-Identifier', generate: () => faker.helpers.arrayElement(['Asian', 'Black', 'Hispanic', 'White', 'Other']), defaultSelected: false },
  // GDPR Art.9 special categories that are plain words: sensitive by meaning, not by shape.
  { id: 'religion', name: 'Religion', category: 'Quasi-Identifier', generate: () => faker.helpers.arrayElement(RELIGIONS), defaultSelected: false },
  { id: 'politicalOpinion', name: 'Political Opinion', category: 'Quasi-Identifier', generate: () => faker.helpers.arrayElement(POLITICAL_VIEWS), defaultSelected: false },
  { id: 'unionMembership', name: 'Trade Union Membership', category: 'Quasi-Identifier', generate: () => faker.helpers.arrayElement(UNIONS), defaultSelected: false },
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
  { id: 'maskedAadhaar', name: 'Masked Aadhaar (IN)', category: 'Masked', generate: () => `XXXX XXXX ${faker.string.numeric(4)}`, defaultSelected: false },
  
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
  { id: 'swiftBic', name: 'SWIFT / BIC', category: 'Non-Sensitive', generate: () => `${faker.string.alpha({ length: 4, casing: 'upper' })}${faker.helpers.arrayElement(['GB', 'DE', 'FR', 'US', 'IN', 'SG', 'NL', 'ES'])}${faker.string.alphanumeric({ length: 2, casing: 'upper' })}${faker.helpers.arrayElement(['', 'XXX', faker.string.alphanumeric({ length: 3, casing: 'upper' })])}`, defaultSelected: false },

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
  // Newer vendor formats. Shapes follow each vendor's documented prefix and length; like the ones above
  // they are random and never valid, and vendors change formats, so treat the shape as of 2025.
  { id: 'slackBotToken',     name: 'Slack Bot Token',       category: 'Secrets', generate: () => `xoxb-${faker.string.numeric(12)}-${faker.string.numeric(13)}-${faker.string.alphanumeric({ length: 24 })}`, defaultSelected: false },
  { id: 'openaiKey',         name: 'OpenAI API Key',        category: 'Secrets', generate: () => `sk-proj-${faker.string.fromCharacters(B64URL, 74)}T3BlbkFJ${faker.string.fromCharacters(B64URL, 74)}`, defaultSelected: false },
  { id: 'anthropicKey',      name: 'Anthropic API Key',     category: 'Secrets', generate: () => `sk-ant-api03-${faker.string.fromCharacters(B64URL, 93)}AA`, defaultSelected: false },
  { id: 'npmToken',          name: 'npm Access Token',      category: 'Secrets', generate: () => `npm_${faker.string.alphanumeric({ length: 36 })}`, defaultSelected: false },
  { id: 'sendgridKey',       name: 'SendGrid API Key',      category: 'Secrets', generate: () => `SG.${faker.string.fromCharacters(B64URL, 22)}.${faker.string.fromCharacters(B64URL, 43)}`, defaultSelected: false },
  { id: 'twilioKey',         name: 'Twilio API Key SID',    category: 'Secrets', generate: () => `SK${faker.string.hexadecimal({ length: 32, casing: 'lower', prefix: '' })}`, defaultSelected: false },
  { id: 'azureStorageKey',   name: 'Azure Storage Key',     category: 'Secrets', generate: () => `${faker.string.fromCharacters(B64STD, 86)}==`, defaultSelected: false },
  { id: 'dbConnectionString', name: 'Database Connection String', category: 'Secrets', generate: () => `postgres://${faker.internet.username().toLowerCase().replace(/[^a-z0-9]/g, '')}:${faker.internet.password({ length: 16 })}@db-${faker.number.int({ min: 1, max: 9 })}.internal.corp:5432/${faker.helpers.arrayElement(['app', 'billing', 'users', 'analytics'])}`, defaultSelected: false },
  { id: 'sshPrivateKey',     name: 'OpenSSH Private Key',   category: 'Secrets', generate: () => `-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA${faker.string.fromCharacters(B64STD, 46)}\n${faker.string.fromCharacters(B64STD, 70)}\n${faker.string.fromCharacters(B64STD, 70)}\n-----END OPENSSH PRIVATE KEY-----`, defaultSelected: false },
  { id: 'gcpServiceAccount', name: 'GCP Service Account Key', category: 'Secrets', generate: () => JSON.stringify({ type: 'service_account', project_id: `proj-${faker.string.alphanumeric({ length: 8, casing: 'lower' })}`, private_key_id: faker.string.hexadecimal({ length: 40, casing: 'lower', prefix: '' }), private_key: `-----BEGIN PRIVATE KEY-----\n${faker.string.fromCharacters(B64STD, 64)}\n${faker.string.fromCharacters(B64STD, 64)}\n-----END PRIVATE KEY-----\n`, client_email: `svc-${faker.string.alphanumeric({ length: 6, casing: 'lower' })}@proj.iam.gserviceaccount.com` }), defaultSelected: false },

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
  { id: 'aadhaar_invalid',    name: 'Aadhaar (near-miss)',     category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateAadhaar())),    defaultSelected: false },
  { id: 'creditCard_invalid', name: 'Credit Card (near-miss)', category: 'DLP-Negative', generate: () => negative(() => breakChecksum(faker.finance.creditCardNumber())), defaultSelected: false },
  { id: 'iban_invalid',       name: 'IBAN (near-miss)',        category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateIBAN())),       defaultSelected: false },
  { id: 'npi_invalid',        name: 'NPI (near-miss)',         category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateNPI())),        defaultSelected: false },
  { id: 'nhsNumber_invalid',  name: 'NHS Number (near-miss)',  category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateNHSNumber())),  defaultSelected: false },
  { id: 'gstin_invalid',      name: 'GSTIN (near-miss)',       category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateGSTIN())),      defaultSelected: false },
  { id: 'vin_invalid',        name: 'VIN (near-miss)',         category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateVIN())),        defaultSelected: false },
  { id: 'imei_invalid',       name: 'IMEI (near-miss)',        category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateIMEI())),       defaultSelected: false },
  { id: 'ean13_invalid',      name: 'EAN-13 (near-miss)',      category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateEAN13())),      defaultSelected: false },
  { id: 'isin_invalid',       name: 'ISIN (near-miss)',        category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateISIN())),       defaultSelected: false },
  { id: 'iqama_invalid',      name: 'Iqama (near-miss)',       category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateIqama())),      defaultSelected: false },
  { id: 'voterId_invalid',         name: 'Voter ID (near-miss)',    category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateVoterId())),        defaultSelected: false },
  { id: 'canadaSin_invalid',       name: 'SIN (near-miss)',         category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateSIN())),            defaultSelected: false },
  { id: 'brazilCpf_invalid',       name: 'CPF (near-miss)',         category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateCPF())),            defaultSelected: false },
  { id: 'spainDni_invalid',        name: 'DNI (near-miss)',         category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateDNI())),            defaultSelected: false },
  { id: 'netherlandsBsn_invalid',  name: 'BSN (near-miss)',         category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateBSN())),            defaultSelected: false },
  { id: 'franceNir_invalid',       name: 'NIR (near-miss)',         category: 'DLP-Negative', generate: (ctx) => negative(() => breakChecksum(generateNIR(ctx.dob, ctx.sex))), defaultSelected: false },
  { id: 'singaporeNric_invalid',   name: 'NRIC (near-miss)',        category: 'DLP-Negative', generate: (ctx) => negative(() => breakChecksum(generateNRIC(ctx.dob))), defaultSelected: false },
  { id: 'australiaTfn_invalid',    name: 'TFN (near-miss)',         category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateTFN())),            defaultSelected: false },
  { id: 'chinaResidentId_invalid', name: 'Resident ID (near-miss)', category: 'DLP-Negative', generate: (ctx) => negative(() => breakChecksum(generateChinaId(ctx.dob, ctx.sex))), defaultSelected: false },
  { id: 'southAfricaId_invalid',   name: 'ZA ID (near-miss)',       category: 'DLP-Negative', generate: (ctx) => negative(() => breakChecksum(generateSouthAfricaId(ctx.dob, ctx.sex))), defaultSelected: false },
  { id: 'uaeEmiratesId_invalid',   name: 'Emirates ID (near-miss)', category: 'DLP-Negative', generate: (ctx) => negative(() => breakChecksum(generateEmiratesId(ctx.dob))), defaultSelected: false },
  // More ways to be almost right: a never-issued range, a wrong prefix, a typing error.
  { id: 'ssn_invalid',            name: 'SSN (never issued)',        category: 'DLP-Negative', generate: () => negative(generateSSNNeverIssued),                                  defaultSelected: false },
  { id: 'aadhaar_prefix',         name: 'Aadhaar (wrong prefix)',    category: 'DLP-Negative', generate: () => negative(generateAadhaarWrongPrefix),                              defaultSelected: false },
  { id: 'creditCard_transposed',  name: 'Credit Card (transposed)',  category: 'DLP-Negative', generate: () => negative(() => transposeDigits(faker.finance.creditCardNumber())), defaultSelected: false },
  { id: 'routingNumber_invalid',  name: 'Routing Number (near-miss)', category: 'DLP-Negative', generate: () => negative(() => breakChecksum(faker.finance.routingNumber())),      defaultSelected: false },
  { id: 'dea_invalid',            name: 'DEA Number (near-miss)',    category: 'DLP-Negative', generate: () => negative(() => breakChecksum(generateDEA())),                      defaultSelected: false },
  // Hard negatives: ordinary business values that merely look like identifiers. Each is redrawn
  // until it passes no validator, so flagging one is always a false positive.
  { id: 'epochSeconds',   name: 'Epoch Timestamp (s)',  category: 'DLP-Negative', generate: () => negative(() => String(Math.floor(faker.date.recent({ days: 365 }).getTime() / 1000))), defaultSelected: false },
  { id: 'epochMillis',    name: 'Epoch Timestamp (ms)', category: 'DLP-Negative', generate: () => negative(() => String(faker.date.recent({ days: 365 }).getTime())),                    defaultSelected: false },
  { id: 'orderNumber',    name: 'Order Number',         category: 'DLP-Negative', generate: () => negative(() => `${faker.number.int({ min: 2, max: 9 })}${faker.string.numeric(11)}`),     defaultSelected: false },
  { id: 'trackingNumber', name: 'Tracking Number',      category: 'DLP-Negative', generate: () => negative(() => `1Z${faker.string.alphanumeric({ length: 16, casing: 'upper' })}`),        defaultSelected: false },
  { id: 'skuCode',        name: 'SKU Code',             category: 'DLP-Negative', generate: () => `SKU-${faker.string.alpha({ length: 2, casing: 'upper' })}${faker.string.numeric(2)}-${faker.string.numeric(4)}`, defaultSelected: false },

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
  voterId:     { region: 'IN', validation: 'luhn' },
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
  usItin:          { region: 'US', validation: 'pattern-only' },
  canadaSin:       { region: 'CA', validation: 'luhn' },
  brazilCpf:       { region: 'BR', validation: 'mod-11' },
  brazilCnpj:      { region: 'BR', validation: 'mod-11' },
  ukNino:          { region: 'UK', validation: 'pattern-only' },
  spainDni:        { region: 'ES', validation: 'mod-23' },
  spainNie:        { region: 'ES', validation: 'mod-23' },
  netherlandsBsn:  { region: 'NL', validation: 'mod-11' },
  franceNir:       { region: 'FR', validation: 'mod-97' },
  singaporeNric:   { region: 'SG', validation: 'mod-11' },
  australiaTfn:    { region: 'AU', validation: 'mod-11' },
  chinaResidentId: { region: 'CN', validation: 'mod-11' },
  southAfricaId:   { region: 'ZA', validation: 'luhn' },
  uaeEmiratesId:   { region: 'AE', validation: 'luhn' },
  indiaPassport:   { region: 'IN', validation: 'pattern-only' },
  uan:             { region: 'IN', validation: 'pattern-only' },
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
  cardExpiry:  { validation: 'pattern-only' },
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
  maskedAadhaar:  { region: 'IN', validation: 'pattern-only' },
  // Non-Sensitive
  ean13:       { validation: 'mod-10' },
  isin:        { validation: 'mod-10' },
  swiftBic:    { region: 'INTL', validation: 'pattern-only' },
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
  slackBotToken:   { region: 'INTL', validation: 'pattern-only' },
  openaiKey:       { region: 'INTL', validation: 'pattern-only' },
  anthropicKey:    { region: 'INTL', validation: 'pattern-only' },
  npmToken:        { region: 'INTL', validation: 'pattern-only' },
  sendgridKey:     { region: 'INTL', validation: 'pattern-only' },
  twilioKey:       { region: 'INTL', validation: 'pattern-only' },
  azureStorageKey: { region: 'INTL', validation: 'pattern-only' },
  dbConnectionString: { region: 'INTL', validation: 'pattern-only' },
  sshPrivateKey:   { region: 'INTL', validation: 'pattern-only' },
  gcpServiceAccount: { region: 'INTL', validation: 'pattern-only' },
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
  voterId_invalid:         { region: 'IN', validation: 'near-miss-of:voterId' },
  canadaSin_invalid:       { region: 'CA', validation: 'near-miss-of:canadaSin' },
  brazilCpf_invalid:       { region: 'BR', validation: 'near-miss-of:brazilCpf' },
  spainDni_invalid:        { region: 'ES', validation: 'near-miss-of:spainDni' },
  netherlandsBsn_invalid:  { region: 'NL', validation: 'near-miss-of:netherlandsBsn' },
  franceNir_invalid:       { region: 'FR', validation: 'near-miss-of:franceNir' },
  singaporeNric_invalid:   { region: 'SG', validation: 'near-miss-of:singaporeNric' },
  australiaTfn_invalid:    { region: 'AU', validation: 'near-miss-of:australiaTfn' },
  chinaResidentId_invalid: { region: 'CN', validation: 'near-miss-of:chinaResidentId' },
  southAfricaId_invalid:   { region: 'ZA', validation: 'near-miss-of:southAfricaId' },
  uaeEmiratesId_invalid:   { region: 'AE', validation: 'near-miss-of:uaeEmiratesId' },
  ssn_invalid:           { region: 'US', validation: 'near-miss-of:ssn' },
  aadhaar_prefix:        { region: 'IN', validation: 'near-miss-of:aadhaar' },
  creditCard_transposed: {               validation: 'near-miss-of:creditCard' },
  routingNumber_invalid: { region: 'US', validation: 'near-miss-of:routingNumber' },
  dea_invalid:           { region: 'US', validation: 'near-miss-of:dea' },
  // Hard negatives: shaped, benign, valid as nothing.
  epochSeconds:   { validation: 'pattern-only' },
  epochMillis:    { validation: 'pattern-only' },
  orderNumber:    { validation: 'pattern-only' },
  trackingNumber: { validation: 'pattern-only' },
  skuCode:        { validation: 'pattern-only' },
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
  // An expiry date alone identifies no card.
  cardExpiry: 'context',
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
  'DLP False-Positive Test': ['firstName', 'email', 'aadhaar_invalid', 'creditCard_invalid', 'iban_invalid', 'npi_invalid', 'nhsNumber_invalid', 'gstin_invalid', 'vin_invalid', 'imei_invalid', 'ean13_invalid', 'isin_invalid',
    'ssn_invalid', 'aadhaar_prefix', 'creditCard_transposed', 'routingNumber_invalid', 'dea_invalid', 'voterId_invalid',
    'epochSeconds', 'epochMillis', 'orderNumber', 'trackingNumber', 'skuCode'],
  'Secrets Leak Test': ['awsAccessKey', 'awsSecretKey', 'githubPAT', 'stripeKey', 'googleApiKey', 'jwt', 'bcryptHash', 'privateKeyPem', 'basicAuthUrl',
    'slackBotToken', 'openaiKey', 'anthropicKey', 'npmToken', 'sendgridKey', 'twilioKey', 'azureStorageKey', 'dbConnectionString', 'sshPrivateKey', 'gcpServiceAccount'],
  'App Telemetry': ['crmId', 'ipAddress', 'ipv6Address', 'macAddress', 'userAgent', 'sessionCookie', 'internalHostname', 'cidrBlock', 'geoCoordinates', 'lastLogin', 'deviceType'],
  'Biometric / Special-Category': ['firstName', 'lastName', 'dob', 'fingerprintHash', 'faceEmbeddingId', 'voiceprintId', 'irisScanId'],
  'Chaos / Malformed': ['firstName', 'email', 'chaosEmpty', 'chaosUnicode', 'chaosSqli', 'chaosXss', 'chaosHomoglyph', 'chaosLong', 'chaosCsvBreak', 'chaosNumeric'],
  // Region-focused
  'India PII': ['firstName', 'lastName', 'aadhaar', 'pan', 'voterId', 'upiId', 'vehicleRegIndia', 'dlIndia', 'phone', 'email', 'dob', 'gender'],
  'India Fintech': ['firstName', 'lastName', 'pan', 'aadhaar', 'upiId', 'ifsc', 'accountNumber', 'creditScore', 'loanAmount', 'phone', 'email'],
  'US Healthcare': ['firstName', 'lastName', 'ssn', 'mrn', 'npi', 'dea', 'healthInsuranceId', 'bloodType', 'diagnosisCode', 'dob', 'gender'],
  'National IDs (World)': ['firstName', 'lastName', 'dob', 'gender', 'ssn', 'usItin', 'canadaSin', 'brazilCpf', 'ukNino', 'nhsNumber', 'spainDni', 'netherlandsBsn', 'franceNir',
    'aadhaar', 'pan', 'singaporeNric', 'australiaTfn', 'chinaResidentId', 'southAfricaId', 'uaeEmiratesId', 'iqama'],
  'EU GDPR Sweep': ['firstName', 'lastName', 'iban', 'dlGermany', 'dlUK', 'email', 'phone', 'ipAddress', 'macAddress', 'dob', 'city'],
};

/** One line per preset: what it is for and what a detector should do with it. */
export const PRESET_INFO: Record<string, string> = {
  'Common Users': 'A typical users table: names, contact details, a few dates.',
  'HR / Employees': 'An employee file: SSN, salary, job and performance data.',
  'CRM / Customers': 'Customer records with purchase and login activity.',
  'Bank / Fintech': 'Account, routing and card-token data with balances and scores.',
  'Healthcare / Patients': 'Patient records: identifiers next to diagnoses and notes.',
  'Education / Students': 'Student records with grades and enrolment data.',
  'Technical / IT': 'Device and network telemetry; little that names a person.',
  'DLP Detection Test': 'One of every classic checksum-valid identifier. Everything sensitive should fire.',
  'DLP False-Positive Test': 'Every near-miss and hard negative. Apart from the name and email, nothing should fire.',
  'Secrets Leak Test': 'Every credential and key format. A secret scanner should catch them all.',
  'App Telemetry': 'Log-style network and session fields: IPs, cookies, hostnames.',
  'Biometric / Special-Category': 'Biometric templates next to basic identity fields.',
  'Chaos / Malformed': 'Hostile and malformed values. Nothing should fire, and nothing should break.',
  'India PII': 'Indian identifiers with Indian names and phone numbers.',
  'India Fintech': 'Indian banking and KYC fields: PAN, Aadhaar, UPI, IFSC.',
  'US Healthcare': 'US patient and provider identifiers: SSN, MRN, NPI, DEA.',
  'National IDs (World)': 'One national identifier from each of thirteen countries, on the same person.',
  'EU GDPR Sweep': 'European identifiers and network data, with German names.',
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
