// Compliance framework tagging — projects the column catalog through each regulation's lens.
// Scope: the three most-referenced privacy laws (GDPR / HIPAA / DPDP). Rule-derived from category
// + a few hand-curated overrides, so adding a column needs no per-framework data entry.
// Consumed by the manifest, the /api/columns route, and the stats-bar compliance summary.
//
// Caveat (beta): "personal data" is contextual — a bare metric like a purchase count isn't personal
// on its own, only once it sits in a row with an identifier. This classifier tags what a column is
// *inherently* (direct identifiers, sensitive categories); it does not model dataset context.
import { AVAILABLE_COLUMNS, ColumnDef, PrivacyCategory } from '../data/schema';

export type FrameworkId = 'gdpr' | 'hipaa' | 'dpdpa';

/** Display metadata, in the order we surface them. */
export const FRAMEWORKS: { id: FrameworkId; label: string; region: string }[] = [
  { id: 'gdpr',  label: 'GDPR',  region: 'EU' },
  { id: 'hipaa', label: 'HIPAA', region: 'US' },
  { id: 'dpdpa', label: 'DPDP',  region: 'IN' },
];

/** Per-column classification. 'none' is omitted from the map entirely. */
export type ColumnFrameworks = Partial<Record<FrameworkId, string>>;

// Sensitivity tier by category. 'special' = GDPR Art.9-style special category (health, biometric, …).
const CATEGORY_TIER: Record<PrivacyCategory, 'special' | 'personal' | 'none'> = {
  'PII': 'personal',
  'PHI': 'special',
  'PCI': 'personal',           // payment data is personal; PCI-DSS itself is out of scope here
  'Secrets': 'none',           // security credentials, not personal data about a subject
  'Biometric': 'special',
  'Network': 'personal',       // IP/MAC are personal data under GDPR
  'Quasi-Identifier': 'personal',
  'Statistical': 'personal',   // financial/age attributes are personal (metrics overridden below)
  'Masked': 'personal',        // pseudonymized data is still personal under GDPR
  'Non-Sensitive': 'none',
  'DLP-Negative': 'none',      // near-miss values identify no real person
  'Chaos': 'none',
};

// Racial/ethnic origin is Art.9 special even though the column lives under Quasi-Identifier.
const SPECIAL_OVERRIDE = new Set<string>(['ethnicity']);

// Force plain 'personal' regardless of category:
//  - npi/dea identify a healthcare *provider* (public registries), not a patient → not special/PHI.
//  - employee/student/crm IDs are unique identifiers assigned to a person → personal, not "none".
const FORCE_PERSONAL = new Set<string>(['npi', 'dea', 'employeeId', 'studentId', 'crmId']);

// Columns that are NOT inherently personal data — behavioral metrics (personal only by association
// with an identifier) and network infrastructure (about systems, not a person). Kept out so the
// classifier doesn't over-flag, e.g. Purchase Count or an internal hostname.
const NOT_INHERENTLY_PERSONAL = new Set<string>([
  'purchaseCount', 'performanceScore', 'gpa',   // derived/behavioral metrics
  'internalHostname', 'cidrBlock',              // network infrastructure, not a person
]);

// HIPAA Safe Harbor: the column ids that ARE one of the 18 patient identifiers.
// This is the one hand-curated set — it also powers the (later) de-identification test.
// NHS number is a patient identifier (like MRN); provider IDs (NPI/DEA) are NOT patient identifiers.
const HIPAA_SAFE_HARBOR = new Set<string>([
  'firstName', 'lastName', 'email', 'phone', 'ssn', 'zipCode', 'city', 'dob',
  'mrn', 'healthInsuranceId', 'nhsNumber', 'abha', 'accountNumber',
  'driversLicense', 'dlUS', 'dlUK', 'dlIndia', 'dlGermany', 'passportNumber',
  'vin', 'imei', 'ipAddress', 'ipv6Address', 'macAddress',
  'fingerprintHash', 'faceEmbeddingId', 'voiceprintId', 'irisScanId',
]);

function tierOf(col: ColumnDef): 'special' | 'personal' | 'none' {
  if (NOT_INHERENTLY_PERSONAL.has(col.id)) return 'none';
  if (FORCE_PERSONAL.has(col.id)) return 'personal';
  if (SPECIAL_OVERRIDE.has(col.id)) return 'special';
  return CATEGORY_TIER[col.category];
}

/** Classify one column across GDPR / HIPAA / DPDP. */
export function frameworksFor(col: ColumnDef): ColumnFrameworks {
  const out: ColumnFrameworks = {};
  const tier = tierOf(col);

  if (tier !== 'none') {
    out.gdpr = tier;          // 'special' (Art.9) | 'personal'
    out.dpdpa = 'personal';   // the DPDP Act defines no separate "sensitive personal data" category
  }

  // HIPAA: 'safe-harbor-id' is a de-identification strip-target, NOT a sensitivity level.
  // Provider identifiers (NPI/DEA) live under PHI but aren't patient health data → excluded.
  if (HIPAA_SAFE_HARBOR.has(col.id)) out.hipaa = 'safe-harbor-id';
  else if (col.category === 'PHI' && !FORCE_PERSONAL.has(col.id)) out.hipaa = 'phi';

  return out;
}

/** Human-readable label for each classification value. */
export const VALUE_LABELS: Record<string, string> = {
  'personal': 'Personal data',
  'special': 'Special category (Art.9)',
  'safe-harbor-id': 'Safe Harbor identifier',
  'phi': 'Protected Health Info',
};

/** Notes surfaced in the compliance popover for frameworks whose model needs a caveat. */
export const FRAMEWORK_NOTES: Partial<Record<FrameworkId, string>> = {
  dpdpa: 'The DPDP Act defines no separate "sensitive personal data" category — all personal data is treated alike.',
};

// Visual/severity tier a classification value maps to. Decouples *identifying* (HIPAA Safe
// Harbor) from *sensitive* (special / health) — they are orthogonal.
export type VisualTier = 'sensitive' | 'identifier' | 'personal';
const SENSITIVE_VALUES = new Set(['special', 'phi']);
export function valueTier(value: string): VisualTier {
  if (value === 'safe-harbor-id') return 'identifier';
  if (SENSITIVE_VALUES.has(value)) return 'sensitive';
  return 'personal';
}
const TIER_RANK: Record<VisualTier, number> = { sensitive: 2, identifier: 1, personal: 0 };

/** For a set of selected columns: which frameworks are triggered, at their highest tier
 *  (sensitive > identifier > personal). Drives the stats-bar chip color. */
export function triggeredFrameworks(cols: ColumnDef[]): { id: FrameworkId; label: string; tier: VisualTier }[] {
  const top = new Map<FrameworkId, VisualTier>();
  for (const col of cols) {
    for (const [id, value] of Object.entries(frameworksFor(col))) {
      const fwId = id as FrameworkId;
      const t = valueTier(value);
      const cur = top.get(fwId);
      if (!cur || TIER_RANK[t] > TIER_RANK[cur]) top.set(fwId, t);
    }
  }
  return FRAMEWORKS.filter(f => top.has(f.id)).map(f => ({ id: f.id, label: f.label, tier: top.get(f.id)! }));
}

/** Per-framework breakdown for the popover: which selected columns triggered it, grouped by classification. */
export function frameworkBreakdown(cols: ColumnDef[]): {
  id: FrameworkId; label: string; region: string;
  groups: { value: string; label: string; columns: string[] }[];
}[] {
  const perFw = new Map<FrameworkId, Map<string, string[]>>();
  for (const col of cols) {
    for (const [id, value] of Object.entries(frameworksFor(col))) {
      const fwId = id as FrameworkId;
      if (!perFw.has(fwId)) perFw.set(fwId, new Map());
      const vm = perFw.get(fwId)!;
      vm.set(value, [...(vm.get(value) ?? []), col.name]);
    }
  }
  return FRAMEWORKS.filter(f => perFw.has(f.id)).map(f => ({
    id: f.id, label: f.label, region: f.region,
    groups: [...perFw.get(f.id)!.entries()].map(([value, columns]) => ({ value, label: VALUE_LABELS[value] ?? value, columns })),
  }));
}

// ---------- self-check (run via `npm test`) ----------
export function _selfCheck() {
  const byId = (id: string) => AVAILABLE_COLUMNS.find(c => c.id === id)!;
  // SSN: HIPAA identifier (not sensitive), GDPR/DPDP ordinary personal.
  const ssn = frameworksFor(byId('ssn'));
  if (ssn.hipaa !== 'safe-harbor-id' || ssn.gdpr !== 'personal' || ssn.dpdpa !== 'personal') throw new Error('FAIL: ssn frameworks');
  // Diagnosis: genuine health data — GDPR special, HIPAA phi, but DPDP has no sensitive tier.
  const dx = frameworksFor(byId('diagnosisCode'));
  if (dx.hipaa !== 'phi' || dx.gdpr !== 'special' || dx.dpdpa !== 'personal') throw new Error('FAIL: PHI classification');
  const eth = frameworksFor(byId('ethnicity'));
  if (eth.gdpr !== 'special') throw new Error('FAIL: ethnicity Art.9 override');
  // NPI/DEA are provider identifiers — personal, not special/PHI.
  const npi = frameworksFor(byId('npi'));
  if (npi.gdpr !== 'personal' || npi.hipaa !== undefined) throw new Error('FAIL: NPI provider identifier');
  // System IDs are unique personal identifiers, not unclassified.
  if (frameworksFor(byId('employeeId')).gdpr !== 'personal') throw new Error('FAIL: employeeId personal');
  // NHS number is a patient identifier (like MRN), not health content.
  if (frameworksFor(byId('nhsNumber')).hipaa !== 'safe-harbor-id') throw new Error('FAIL: NHS safe-harbor-id');
  // Purchase Count: a behavioral metric — NOT inherently personal, so unclassified.
  const pc = frameworksFor(byId('purchaseCount'));
  if (Object.keys(pc).length !== 0) throw new Error('FAIL: purchaseCount should be unclassified');
  // Salary: a personal financial attribute — still personal.
  if (frameworksFor(byId('salary')).gdpr !== 'personal') throw new Error('FAIL: salary personal');
  const nearMiss = frameworksFor(byId('aadhaar_invalid'));
  if (Object.keys(nearMiss).length !== 0) throw new Error('FAIL: near-miss should be unregulated');
  const secret = frameworksFor(byId('awsAccessKey'));
  if (Object.keys(secret).length !== 0) throw new Error('FAIL: secrets are not personal data');
  if (valueTier('safe-harbor-id') !== 'identifier' || valueTier('special') !== 'sensitive' || valueTier('personal') !== 'personal') throw new Error('FAIL: valueTier');
  console.log('frameworks: all self-checks passed');
}
