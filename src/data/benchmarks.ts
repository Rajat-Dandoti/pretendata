// Standard benchmarks: fixed datasets everyone can regenerate byte for byte, so two tools — or
// the same tool on two days — are scored on identical data against the same answer key.
//
// A benchmark is frozen. Its columns are listed out (not "all columns"), its seed is fixed, and
// `sha256` pins the CSV it produces. It is tied to one generator version: when GENERATOR_VERSION
// changes, this set can no longer be reproduced and `npm test` says so. Publish a new
// BENCHMARK_VERSION then; never edit a published one.
import type { LocaleId } from '../lib/locale';

export const BENCHMARK_VERSION = 1;
/** GENERATOR_VERSION these benchmarks were pinned at. */
export const BENCHMARK_GENERATOR: number = 4;

export interface Benchmark {
  id: string;
  name: string;
  description: string;
  columnIds: string[];
  rowCount: number;
  seed: number;
  locale: LocaleId;
  /** SHA-256 of the CSV download (UTF-8 BOM included), as the app and the CLI both write it. */
  sha256: string;
}

export const BENCHMARKS: Benchmark[] = [
  {
    id: 'india',
    name: 'India',
    description: 'Indian identifiers, their near-misses and hard negatives, with Indian names and phone numbers.',
    columnIds: [
      'firstName', 'lastName', 'email', 'phone', 'aadhaar', 'pan', 'upiId', 'voterId', 'dlIndia', 'abha', 'accountNumber', 'ifsc',
      'dob', 'gender', 'city', 'gstin', 'vehicleRegIndia', 'aadhaar_invalid', 'gstin_invalid', 'aadhaar_prefix', 'epochSeconds', 'orderNumber',
    ],
    rowCount: 10_000,
    seed: 1001,
    locale: 'en_IN',
    sha256: 'c20afeef3ef9bbd89341195dbadfc4716bc847fb45e2c97f6b1375b975cd5070',
  },
  {
    id: 'global',
    name: 'Global',
    description: 'The whole catalog as of benchmark version 1: every should-fire column, every negative control, every context column.',
    columnIds: [
    'firstName', 'lastName', 'email', 'phone', 'ssn', 'aadhaar', 'pan', 'ein', 'upiId', 'voterId', 'iqama',
    'dlIndia', 'dlUS', 'dlUK', 'dlGermany', 'passportNumber', 'driversLicense', 'ipAddress', 'macAddress', 'mrn',
    'healthInsuranceId', 'bloodType', 'diagnosisCode', 'medicalNotes', 'npi', 'dea', 'nhsNumber', 'abha',
    'creditCard', 'cvv', 'routingNumber', 'accountNumber', 'iban', 'ifsc', 'zipCode', 'dob', 'gender', 'ethnicity',
    'city', 'jobTitle', 'department', 'major', 'university', 'gstin', 'vin', 'imei', 'vehicleRegIndia', 'salary',
    'age', 'purchaseCount', 'accountBalance', 'creditScore', 'gpa', 'performanceScore', 'loanAmount', 'maskedEmail',
    'hashedId', 'last4SSN', 'tokenizedCard', 'maskedAccount', 'transactionId', 'createdAt', 'deviceType',
    'storeLocation', 'hireDate', 'graduationYear', 'lastLogin', 'subscriptionTier', 'employeeId', 'studentId',
    'crmId', 'ean13', 'isin', 'awsAccessKey', 'awsSecretKey', 'githubPAT', 'stripeKey', 'googleApiKey', 'jwt',
    'bcryptHash', 'privateKeyPem', 'basicAuthUrl', 'fingerprintHash', 'faceEmbeddingId', 'voiceprintId',
    'irisScanId', 'ipv6Address', 'userAgent', 'sessionCookie', 'internalHostname', 'cidrBlock', 'geoCoordinates',
    'aadhaar_invalid', 'creditCard_invalid', 'iban_invalid', 'npi_invalid', 'nhsNumber_invalid', 'gstin_invalid',
    'vin_invalid', 'imei_invalid', 'ean13_invalid', 'isin_invalid', 'iqama_invalid', 'ssn_invalid', 'aadhaar_prefix',
    'creditCard_transposed', 'routingNumber_invalid', 'dea_invalid', 'epochSeconds', 'epochMillis', 'orderNumber',
    'trackingNumber', 'skuCode', 'chaosEmpty', 'chaosUnicode', 'chaosSqli', 'chaosXss', 'chaosHomoglyph',
    'chaosLong', 'chaosCsvBreak', 'chaosNumeric',
    ],
    rowCount: 10_000,
    seed: 1002,
    locale: 'mix',
    sha256: 'b6837ce1558b2efbb1ab376d7cabacd058799c33f7ab1bfbb42a918699065fcf',
  },
  {
    id: 'secrets',
    name: 'Secrets',
    description: 'Credentials and keys, next to opaque business identifiers a secret scanner should leave alone.',
    columnIds: [
      'awsAccessKey', 'awsSecretKey', 'githubPAT', 'stripeKey', 'googleApiKey', 'jwt', 'bcryptHash', 'privateKeyPem', 'basicAuthUrl',
      'sessionCookie', 'hashedId', 'transactionId', 'employeeId', 'fingerprintHash', 'trackingNumber', 'skuCode', 'epochMillis',
    ],
    rowCount: 10_000,
    seed: 1003,
    locale: 'en',
    sha256: 'f37febf5c0873164803220cb8b1403f9618434f655590ecbc35f5a4912645042',
  },
];

export const benchmarkById = (id: string) => BENCHMARKS.find(b => b.id === id);

/** The benchmark whose settings a dataset's answer key matches exactly, if any. */
export function matchBenchmark(m: { columns: { id: string }[]; rowCount: number; seed: number | null; locale: string; sparsityPct?: number; densityPct?: number; headerMode?: string; formatting?: string; uniquenessPct?: number; seeding?: string; generatorVersion?: number }): Benchmark | undefined {
  if ((m.sparsityPct ?? 0) !== 0 || (m.densityPct ?? 100) !== 100 || (m.headerMode ?? 'descriptive') !== 'descriptive' || (m.formatting ?? 'canonical') !== 'canonical' || (m.uniquenessPct ?? 100) !== 100) return undefined;
  if ((m.generatorVersion ?? BENCHMARK_GENERATOR) !== BENCHMARK_GENERATOR) return undefined;
  const ids = m.columns.map(c => c.id).sort().join();
  return BENCHMARKS.find(b => b.rowCount === m.rowCount && b.seed === m.seed && b.locale === m.locale && [...b.columnIds].sort().join() === ids);
}
