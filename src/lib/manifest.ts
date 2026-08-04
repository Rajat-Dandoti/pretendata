import { AVAILABLE_COLUMNS, ColumnDef, PrivacyCategory, ValidationKind } from '../data/schema';
import { frameworksFor, ColumnFrameworks } from './frameworks';

export const MANIFEST_VERSION = 1;

export type GenMode = 'offline';

export interface RunMeta {
  seed: number | null;
  rowCount: number;
  sparsityPct: number;
  kAnonymity: number | null;
  mode: GenMode;
}

export interface ManifestColumn {
  id: string;
  name: string;
  category: PrivacyCategory;
  region?: string;
  validation: ValidationKind;
  /** Per-regulation classification (GDPR, HIPAA, DPDPA, …). 'none' entries are omitted. */
  frameworks: ColumnFrameworks;
}

export interface Manifest extends RunMeta {
  version: number;
  generatedAt: string;
  toolName: string;
  columns: ManifestColumn[];
}

function toManifestColumn(c: ColumnDef): ManifestColumn {
  return {
    id: c.id,
    name: c.name,
    category: c.category,
    region: c.region,
    validation: c.validation ?? 'free-form',
    frameworks: frameworksFor(c),
  };
}

export function buildManifest(selectedColumnIds: Iterable<string>, meta: RunMeta): Manifest {
  const ids = new Set(selectedColumnIds);
  return {
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    toolName: 'privacy-test-data-generator',
    ...meta,
    columns: AVAILABLE_COLUMNS.filter(c => ids.has(c.id)).map(toManifestColumn),
  };
}

/** Sidecar filename next to a data file: `foo.csv` → `foo.csv.manifest.json`. */
export function manifestFilename(dataFilename: string): string {
  return `${dataFilename}.manifest.json`;
}

// ponytail: minimal self-check — assert manifest round-trips a known column. Add real tests when there's a 2nd consumer.
export function _selfCheck() {
  const m = buildManifest(['aadhaar', 'email'], {
    seed: 1, rowCount: 10, sparsityPct: 0, kAnonymity: null, mode: 'offline',
  });
  const aadhaar = m.columns.find(c => c.id === 'aadhaar');
  if (!aadhaar || aadhaar.validation !== 'verhoeff' || aadhaar.region !== 'IN') {
    throw new Error('manifest self-check failed: aadhaar metadata missing');
  }
}
