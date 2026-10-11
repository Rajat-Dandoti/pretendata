// Related tables: one set of people spread over several tables, the way a real database holds
// them. A person's details are repeated wherever a real system would repeat them (the patient's
// name on a prescription, the customer's email on an order), and the subject index lists every
// place each person appears. For database scanners, for data-subject-request drills ("find
// everything about customer C000042"), and for checking that masking treats the same value
// the same way in every table.
import { AVAILABLE_COLUMNS, ColumnDef, expectationFor } from '../data/schema';
import { GENERATOR_VERSION, RowOptions, UTF8_BOM, csvEscape, makeRow, sqlLiteral } from './generate';
import { applySeed } from './seed';
import { makeZip, ZipEntry } from './zip';

export type SchemaId = 'retail' | 'hospital' | 'bank';

interface TableSpec {
  name: string;
  /** Prefix of this table's own key, e.g. "O" gives order ids O000001… */
  idPrefix: string;
  /** Table whose rows own these rows; absent for the people table. */
  parent?: string;
  /** How many rows each parent row gets. */
  perParent?: [min: number, max: number];
  /** Catalog columns generated fresh for every row. */
  columns: string[];
  /** Catalog columns copied from the person, as a real system would denormalise them. */
  person?: string[];
}

// The first table of each schema holds the people; every other table hangs off it.
const SCHEMAS: Record<SchemaId, { label: string; description: string; tables: TableSpec[] }> = {
  retail: {
    label: 'Retail',
    description: 'Customers, their orders, and a payment per order.',
    tables: [
      { name: 'customers', idPrefix: 'C', columns: ['firstName', 'lastName', 'email', 'phone', 'dob', 'gender', 'city', 'zipCode'] },
      { name: 'orders', idPrefix: 'O', parent: 'customers', perParent: [1, 4], columns: ['transactionId', 'createdAt', 'storeLocation', 'deviceType', 'ipAddress'], person: ['email'] },
      { name: 'payments', idPrefix: 'P', parent: 'orders', perParent: [1, 1], columns: ['creditCard', 'cardExpiry', 'loanAmount'], person: ['firstName', 'lastName'] },
    ],
  },
  hospital: {
    label: 'Hospital',
    description: 'Patients, their visits, and prescriptions written at each visit.',
    tables: [
      { name: 'patients', idPrefix: 'PT', columns: ['firstName', 'lastName', 'dob', 'gender', 'phone', 'email', 'mrn', 'healthInsuranceId', 'ssn', 'zipCode'] },
      { name: 'visits', idPrefix: 'V', parent: 'patients', perParent: [1, 3], columns: ['createdAt', 'diagnosisCode', 'medicalNotes', 'labResult', 'npi'], person: ['mrn'] },
      { name: 'prescriptions', idPrefix: 'RX', parent: 'visits', perParent: [0, 2], columns: ['medication', 'dea', 'createdAt'], person: ['firstName', 'lastName', 'dob'] },
    ],
  },
  bank: {
    label: 'Bank',
    description: 'Customers, their accounts, and transfers on each account.',
    tables: [
      { name: 'customers', idPrefix: 'C', columns: ['firstName', 'lastName', 'email', 'phone', 'dob', 'ssn', 'city', 'zipCode'] },
      { name: 'accounts', idPrefix: 'A', parent: 'customers', perParent: [1, 2], columns: ['accountNumber', 'routingNumber', 'iban', 'accountBalance', 'creditScore'], person: ['ssn'] },
      // "transfers", not "transactions": the table's own key would collide with the transaction_id column.
      { name: 'transfers', idPrefix: 'T', parent: 'accounts', perParent: [1, 5], columns: ['transactionId', 'createdAt', 'loanAmount', 'ipAddress', 'deviceType'], person: ['email'] },
    ],
  },
};

export const SCHEMA_IDS = Object.keys(SCHEMAS) as SchemaId[];
export const schemaInfo = (id: SchemaId) => ({ label: SCHEMAS[id].label, description: SCHEMAS[id].description, tables: SCHEMAS[id].tables.map(t => t.name) });

const snake = (id: string) => id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const singular = (table: string) => table.replace(/s$/, '');
const cols = (ids: string[]): ColumnDef[] => AVAILABLE_COLUMNS.filter(c => ids.includes(c.id));

export interface Table {
  name: string;
  /** Column names in order: own key, foreign keys, then data columns (snake_case of the catalog ids). */
  columns: string[];
  /** For each data column name, the catalog column it holds. Key columns are not listed. */
  catalog: Record<string, string>;
  rows: Record<string, unknown>[];
}

/** Where one person's data sits: every row that is theirs, in every table. */
export interface SubjectLocations {
  subjectId: string;
  locations: { table: string; row: number; columns: string[] }[];
}

export interface Related {
  schema: SchemaId;
  tables: Table[];
  subjects: SubjectLocations[];
}

export interface RelatedOptions extends Pick<RowOptions, 'locale' | 'formatting'> {
  schema: SchemaId;
  /** Number of people (rows of the first table). */
  people: number;
  seed?: number | null;
}

const rand = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

export function generateRelated(o: RelatedOptions): Related {
  applySeed(o.seed ?? null);
  const row: RowOptions = { locale: o.locale, formatting: o.formatting };
  const specs = SCHEMAS[o.schema].tables;
  const people = specs[0];
  const subjectKey = `${singular(people.name)}_id`;
  const tables = new Map<string, Table>(specs.map(t => {
    const fks: string[] = [];
    for (let p = t.parent; p; p = specs.find(s => s.name === p)!.parent) fks.push(`${singular(p)}_id`);
    const data = [...(t.person ?? []), ...t.columns];
    return [t.name, { name: t.name, columns: [`${singular(t.name)}_id`, ...fks, ...data.map(snake)], catalog: Object.fromEntries(data.map(id => [snake(id), id])), rows: [] }];
  }));
  const counters = new Map<string, number>();
  const nextId = (t: TableSpec) => { const n = (counters.get(t.name) ?? 0) + 1; counters.set(t.name, n); return `${t.idPrefix}${String(n).padStart(6, '0')}`; };
  const subjects: SubjectLocations[] = [];

  // Depth-first: a person, then each of their rows in each child table, so one person's data is contiguous.
  const addChildren = (parent: TableSpec, keys: Record<string, string>, person: Record<string, unknown>, where: SubjectLocations) => {
    for (const t of specs.filter(s => s.parent === parent.name)) {
      for (let i = rand(...t.perParent!); i > 0; i--) {
        const own = makeRow(cols(t.columns), row);
        const id = nextId(t);
        const table = tables.get(t.name)!;
        const mine = { ...keys, [`${singular(t.name)}_id`]: id };
        table.rows.push({ ...mine, ...Object.fromEntries((t.person ?? []).map(c => [snake(c), person[c]])), ...Object.fromEntries(t.columns.map(c => [snake(c), own[c]])) });
        // Everything in a child row belongs to the person: the copied details and what was recorded about them.
        where.locations.push({ table: t.name, row: table.rows.length, columns: table.columns.filter(c => c in table.catalog) });
        addChildren(t, mine, person, where);
      }
    }
  };
  for (let p = 0; p < o.people; p++) {
    const person = makeRow(cols(people.columns), row);
    const id = nextId(people);
    const table = tables.get(people.name)!;
    table.rows.push({ [subjectKey]: id, ...Object.fromEntries(people.columns.map(c => [snake(c), person[c]])) });
    const where: SubjectLocations = { subjectId: id, locations: [{ table: people.name, row: table.rows.length, columns: table.columns.filter(c => c in table.catalog) }] };
    addChildren(people, { [subjectKey]: id }, person, where);
    subjects.push(where);
  }
  return { schema: o.schema, tables: [...tables.values()], subjects };
}

export function tableToCSV(t: Table): string {
  return UTF8_BOM + t.columns.join(',') + '\n' + t.rows.map(r => t.columns.map(c => csvEscape(r[c])).join(',')).join('\n') + (t.rows.length ? '\n' : '');
}

/** One SQL script: tables in dependency order with primary and foreign keys, then the rows. */
export function relatedToSQL(r: Related): string {
  let out = '';
  for (const t of r.tables) {
    const [pk, ...rest] = t.columns;
    const defs = [`  ${pk} TEXT PRIMARY KEY`, ...rest.map(c => {
      if (c in t.catalog) return `  ${c} ${typeof t.rows[0]?.[c] === 'number' ? 'NUMERIC' : 'TEXT'}`;
      const parent = r.tables.find(p => p.columns[0] === c)!;
      return `  ${c} TEXT NOT NULL REFERENCES ${parent.name}(${c})`;
    })];
    out += `CREATE TABLE ${t.name} (\n${defs.join(',\n')}\n);\n`;
  }
  for (const t of r.tables) {
    for (let i = 0; i < t.rows.length; i += 500) {
      out += `INSERT INTO ${t.name} (${t.columns.join(', ')}) VALUES\n` + t.rows.slice(i, i + 500).map(row => `  (${t.columns.map(c => sqlLiteral(row[c])).join(', ')})`).join(',\n') + ';\n';
    }
  }
  return out;
}

/** The files of the download: a CSV per table, the same data as one SQL script, the subject index and the answer key. */
export function relatedFiles(r: Related, o: RelatedOptions): ZipEntry[] {
  const key = {
    toolName: 'pretendata', kind: 'related-tables', generatorVersion: GENERATOR_VERSION,
    schema: r.schema, people: o.people, seed: o.seed ?? null, locale: o.locale ?? 'en', formatting: o.formatting ?? 'canonical',
    tables: r.tables.map(t => ({
      name: t.name, rows: t.rows.length, primaryKey: t.columns[0], foreignKeys: t.columns.slice(1).filter(c => !(c in t.catalog)),
      columns: Object.entries(t.catalog).map(([header, id]) => { const c = AVAILABLE_COLUMNS.find(x => x.id === id)!; return { header, id, name: c.name, category: c.category, expectation: expectationFor(c) }; }),
    })),
  };
  return [
    ...r.tables.map(t => ({ name: `${t.name}.csv`, data: tableToCSV(t) })),
    { name: 'schema.sql', data: relatedToSQL(r) },
    { name: 'subject-index.json', data: JSON.stringify(r.subjects) + '\n' },
    { name: 'answer-key.json', data: JSON.stringify(key, null, 2) + '\n' },
  ];
}

export const relatedZipName = (schema: SchemaId) => `pretendata-${schema}.zip`;
export function relatedZip(r: Related, o: RelatedOptions): Blob {
  return makeZip(relatedFiles(r, o).map(f => ({ ...f, name: `pretendata-${r.schema}/${f.name}` })));
}

// ---------- self-check (run via `npm test`) ----------
export function _selfCheck() {
  for (const schema of SCHEMA_IDS) {
    const o: RelatedOptions = { schema, people: 120, seed: 14, locale: 'en_IN' };
    const r = generateRelated(o);
    const byName = new Map(r.tables.map(t => [t.name, t]));
    const [people, ...children] = r.tables;
    if (people.rows.length !== 120) throw new Error(`FAIL: ${schema} should have 120 people`);
    for (const t of r.tables) {
      if (new Set(t.columns).size !== t.columns.length) throw new Error(`FAIL: ${schema}.${t.name} has two columns with the same name`);
      if (new Set(t.rows.map(x => x[t.columns[0]])).size !== t.rows.length) throw new Error(`FAIL: ${schema}.${t.name} primary key is not unique`);
      if (t.rows.some(x => t.columns.some(c => !(c in x)))) throw new Error(`FAIL: ${schema}.${t.name} has a row missing a column`);
    }
    // every foreign key resolves, and a copied detail equals the person's own
    const personOf = new Map(people.rows.map(p => [p[people.columns[0]], p]));
    for (const t of children) {
      for (const fk of t.columns.slice(1).filter(c => !(c in t.catalog))) {
        const parent = r.tables.find(p => p.columns[0] === fk)!;
        const keys = new Set(parent.rows.map(x => x[fk]));
        if (t.rows.some(x => !keys.has(x[fk]))) throw new Error(`FAIL: ${schema}.${t.name}.${fk} does not resolve`);
      }
      for (const x of t.rows) {
        const p = personOf.get(x[people.columns[0]])!;
        for (const c of Object.keys(t.catalog)) if (c in people.catalog && x[c] !== p[c]) throw new Error(`FAIL: ${schema}.${t.name}.${c} differs from the person's`);
      }
    }
    // the subject index lists every row that carries the person's id, and nothing else
    const total = r.tables.reduce((n, t) => n + t.rows.length, 0);
    if (r.subjects.reduce((n, s) => n + s.locations.length, 0) !== total) throw new Error(`FAIL: ${schema} subject index does not cover every row`);
    for (const s of r.subjects) {
      for (const l of s.locations) {
        if (byName.get(l.table)!.rows[l.row - 1][people.columns[0]] !== s.subjectId) throw new Error(`FAIL: ${schema} subject index points at someone else's row`);
      }
    }
    if (JSON.stringify(generateRelated(o).tables) !== JSON.stringify(r.tables)) throw new Error(`FAIL: ${schema} seed determinism`);
    const files = relatedFiles(r, o);
    if (files.map(f => f.name).join() !== [...r.tables.map(t => `${t.name}.csv`), 'schema.sql', 'subject-index.json', 'answer-key.json'].join()) throw new Error('FAIL: related files');
  }
  console.log('relational: all self-checks passed');
}
