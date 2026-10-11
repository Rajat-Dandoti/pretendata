// Re-identification risk of a table, measured the standard ways: how many rows share each
// combination of quasi-identifiers (k-anonymity), and how varied the sensitive value is
// within each such group (l-diversity). Pure functions over rows.
export type Row = Record<string, unknown>;

const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function classes(rows: Row[], quasi: string[]): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = quasi.map(q => cell(r[q])).join('\u0001');
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  return groups;
}

export interface KAnonymity {
  /** Size of the smallest group: every row is indistinguishable from at least k−1 others. 0 for an empty table. */
  k: number;
  /** Number of distinct quasi-identifier combinations. */
  groups: number;
  /** Rows that are the only one with their combination — re-identifiable from the quasi-identifiers alone. */
  uniqueRows: number;
  /** uniqueRows as a share of all rows (0–1). */
  uniqueShare: number;
  /** Rows in groups smaller than 5, a common minimum. */
  rowsUnder5: number;
}

export function kAnonymity(rows: Row[], quasi: string[]): KAnonymity {
  const sizes = [...classes(rows, quasi).values()].map(g => g.length);
  const count = (pred: (n: number) => boolean) => sizes.filter(pred).reduce((a, n) => a + n, 0);
  const uniqueRows = count(n => n === 1);
  return {
    k: sizes.length ? Math.min(...sizes) : 0,
    groups: sizes.length,
    uniqueRows,
    uniqueShare: rows.length ? uniqueRows / rows.length : 0,
    rowsUnder5: count(n => n < 5),
  };
}

export interface LDiversity {
  /** Fewest distinct sensitive values in any group. 1 means some group gives the value away. */
  l: number;
  /** Groups of two or more rows that all hold the same sensitive value: membership alone discloses it. */
  homogeneousGroups: number;
  /** Rows in those groups. */
  rowsDisclosed: number;
}

/** A k value alone is not evidence of safety: if a whole group shares one diagnosis, knowing the group is enough. */
export function lDiversity(rows: Row[], quasi: string[], sensitive: string): LDiversity {
  const groups = [...classes(rows, quasi).values()];
  const distinct = groups.map(g => new Set(g.map(r => cell(r[sensitive]))).size);
  const homogeneous = groups.filter((g, i) => g.length >= 2 && distinct[i] === 1);
  return {
    l: distinct.length ? Math.min(...distinct) : 0,
    homogeneousGroups: homogeneous.length,
    rowsDisclosed: homogeneous.reduce((a, g) => a + g.length, 0),
  };
}

// ---------- self-check (run via `npm test`) ----------
export function _selfCheck() {
  const t: Row[] = [
    { zip: '10001', sex: 'f', dx: 'flu' }, { zip: '10001', sex: 'f', dx: 'flu' }, { zip: '10001', sex: 'f', dx: 'flu' },   // 3 alike, one diagnosis
    { zip: '10002', sex: 'm', dx: 'flu' }, { zip: '10002', sex: 'm', dx: 'asthma' },                                      // 2 alike, two diagnoses
    { zip: '10003', sex: 'f', dx: 'hiv' },                                                                                // alone
  ];
  const k = kAnonymity(t, ['zip', 'sex']);
  if (k.k !== 1 || k.groups !== 3 || k.uniqueRows !== 1 || k.rowsUnder5 !== 6 || Math.abs(k.uniqueShare - 1 / 6) > 1e-9) throw new Error(`FAIL: kAnonymity ${JSON.stringify(k)}`);
  if (kAnonymity(t.slice(0, 5), ['zip', 'sex']).k !== 2) throw new Error('FAIL: k without the lone row');
  if (kAnonymity(t, ['sex']).k !== 2 || kAnonymity(t, []).k !== 6 || kAnonymity([], ['zip']).k !== 0) throw new Error('FAIL: k edge cases');
  const l = lDiversity(t, ['zip', 'sex'], 'dx');
  if (l.l !== 1 || l.homogeneousGroups !== 1 || l.rowsDisclosed !== 3) throw new Error(`FAIL: lDiversity ${JSON.stringify(l)}`);
  console.log('reident: all self-checks passed');
}
