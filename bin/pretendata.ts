#!/usr/bin/env node
// Command-line front end to the same generator the browser uses. For the same settings it
// writes the same bytes as the app's Download button, so a dataset made in CI and one made in
// the browser are interchangeable, and one answer key fits both.
//
//   pretendata --preset "India PII" --rows 1000000 --seed 42 --out india.csv --answer-key india.key.json
//   pretendata --columns email,ssn --rows 100 --format ndjson
//   pretendata text --pack prompt --count 500 --seed 7
//   pretendata benchmark india --out india.csv --answer-key india.key.json
//   pretendata list presets
import { createWriteStream, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AVAILABLE_COLUMNS, PRESETS, PRESET_LOCALES, expectationFor } from '../src/data/schema';
import { BENCHMARKS, BENCHMARK_GENERATOR, BENCHMARK_VERSION, benchmarkById } from '../src/data/benchmarks';
import {
  EXPORT_FORMATS, ExportFormat, GENERATOR_VERSION, HEADER_MODES, HeaderMode, IN_MEMORY_THRESHOLD, STREAM_CHUNK_ROWS, UTF8_BOM,
  csvEscape, generateChunkText, generateRows, headersFor, rekeyRows, rowsToCSV, rowsToNdjson, rowsToSQL, sqlCreateTable,
} from '../src/lib/generate';
import { LOCALES, LocaleId } from '../src/lib/locale';
import { buildManifest } from '../src/lib/manifest';
import { JsonStructure, nestRows } from '../src/lib/nesting';
import { docsToNdjson, generateDocs, TEXT_PACKS, TextPack } from '../src/lib/text';
import { generateRelated, relatedFiles, SCHEMA_IDS, SchemaId } from '../src/lib/relational';
import { FORMATTINGS, Formatting } from '../src/lib/variants';

const HELP = `pretendata — synthetic, privacy-safe test data with a known answer key

Usage
  pretendata [generate] [options]     tabular data (the default command)
  pretendata text [options]           prose with embedded identifiers, as NDJSON
  pretendata tables [options]         related tables: one set of people across several tables
  pretendata benchmark <id>           a standard benchmark dataset (see: pretendata list benchmarks)
  pretendata list columns|presets|benchmarks

Generate
  --preset <name>          a named column bundle (see: pretendata list presets)
  --columns <a,b,c>        column ids, instead of a preset
  --rows <n>               number of rows (default 100)
  --seed <n>               make the output reproducible
  --format <f>             ${EXPORT_FORMATS.join(' | ')} (default csv)
  --locale <id>            ${LOCALES.map(l => l.id).join(' | ')}
  --sparsity <0-90>        % of cells left empty
  --density <1-100>        % of rows in which a should-fire column holds the real value
  --formatting <f>         ${FORMATTINGS.join(' | ')}
  --uniqueness <1-100>     % of rows with their own birth date, gender, zip and city; the rest share them in groups
  --headers <mode>         ${HEADER_MODES.join(' | ')}
  --structure <s>          flat | grouped | semantic | deep (JSON and NDJSON up to ${IN_MEMORY_THRESHOLD.toLocaleString()} rows)
  --depth <1-10>           nesting depth for --structure deep
  --no-bom                 leave the UTF-8 byte-order mark off CSV output
  --out <file>             write to a file instead of standard output
  --answer-key <file>      also write the answer key for this dataset

Text
  --pack <p>               ${TEXT_PACKS.join(' | ')} (default mixed)
  --count <n>              number of documents (default 100)
  --seed, --locale, --formatting, --out   as above

Tables
  --schema <s>             ${SCHEMA_IDS.join(' | ')} (default retail)
  --people <n>             number of people (default 1000)
  --out-dir <dir>          where to write a CSV per table, schema.sql, subject-index.json and answer-key.json
  --seed, --locale, --formatting   as above

Up to ${IN_MEMORY_THRESHOLD.toLocaleString()} rows the output matches the app's in-memory download; above that it
matches the app's streamed file (seeded per ${STREAM_CHUNK_ROWS.toLocaleString()}-row chunk), byte for byte.`;

class UsageError extends Error {}
const fail = (message: string): never => { throw new UsageError(message); };

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], flag: string, fallback: T): T {
  if (value === undefined) return fallback;
  return allowed.includes(value as T) ? (value as T) : fail(`--${flag} must be one of: ${allowed.join(', ')}`);
}
function integer(value: string | undefined, flag: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fail(`--${flag} must be a whole number from ${min} to ${max.toLocaleString()}`);
}

export interface Io {
  /** Write a piece of output; may return a promise to apply backpressure. */
  write(chunk: string): void | Promise<void>;
  writeFile(path: string, content: string): void;
}

/** Run the CLI. Returns the process exit code; throws nothing. */
export async function main(argv: string[], io: Io, log: (line: string) => void = console.error): Promise<number> {
  try {
    const { values: v, positionals } = parseArgs({
      args: argv, allowPositionals: true, options: {
        preset: { type: 'string' }, columns: { type: 'string' }, rows: { type: 'string' }, seed: { type: 'string' }, format: { type: 'string' },
        locale: { type: 'string' }, sparsity: { type: 'string' }, density: { type: 'string' }, formatting: { type: 'string' }, headers: { type: 'string' }, uniqueness: { type: 'string' },
        structure: { type: 'string' }, depth: { type: 'string' }, 'no-bom': { type: 'boolean' }, 'answer-key': { type: 'string' },
        pack: { type: 'string' }, count: { type: 'string' }, schema: { type: 'string' }, people: { type: 'string' }, 'out-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' },
      },
    });
    const [command = 'generate', what] = positionals;
    if (v.help) { await io.write(HELP + '\n'); return 0; }

    const seed = v.seed === undefined ? null : (Number.isFinite(Number(v.seed)) ? Math.floor(Number(v.seed)) : fail('--seed must be a number'));
    const formatting = oneOf<Formatting>(v.formatting, FORMATTINGS, 'formatting', 'canonical');
    const localeIds = LOCALES.map(l => l.id) as LocaleId[];

    if (command === 'list') {
      if (what === 'presets') await io.write(Object.entries(PRESETS).map(([name, ids]) => `${name}\t${ids.join(',')}`).join('\n') + '\n');
      else if (what === 'columns') await io.write(AVAILABLE_COLUMNS.map(c => [c.id, c.name, c.category, expectationFor(c)].join('\t')).join('\n') + '\n');
      else if (what === 'benchmarks') await io.write(BENCHMARKS.map(b => `${b.id}\tv${BENCHMARK_VERSION}\t${b.rowCount} rows, ${b.columnIds.length} columns\t${b.description}`).join('\n') + '\n');
      else fail('list what? columns, presets or benchmarks');
      return 0;
    }

    if (command === 'text') {
      const docs = generateDocs({
        pack: oneOf<TextPack>(v.pack, TEXT_PACKS, 'pack', 'mixed'), count: integer(v.count, 'count', 1, IN_MEMORY_THRESHOLD, 100),
        seed, locale: oneOf(v.locale, localeIds, 'locale', 'en'), formatting,
      });
      await io.write(docsToNdjson(docs));
      return 0;
    }
    if (command === 'tables') {
      const dir = v['out-dir'] ?? fail('tables writes several files: give --out-dir <dir>');
      const o = { schema: oneOf<SchemaId>(v.schema, SCHEMA_IDS, 'schema', 'retail'), people: integer(v.people, 'people', 1, 200_000, 1000), seed, locale: oneOf(v.locale, localeIds, 'locale', 'en'), formatting };
      for (const f of relatedFiles(generateRelated(o), o)) io.writeFile(`${dir.replace(/\/$/, '')}/${f.name}`, f.data as string);
      return 0;
    }
    if (command === 'benchmark') {
      const b = benchmarkById(what ?? '') ?? fail(`unknown benchmark "${what ?? ''}" (see: pretendata list benchmarks)`);
      if (GENERATOR_VERSION !== BENCHMARK_GENERATOR) fail(`benchmark version ${BENCHMARK_VERSION} was pinned at generator version ${BENCHMARK_GENERATOR}; this build is version ${GENERATOR_VERSION} and cannot reproduce it`);
      // Fixed in every respect: a CSV with default settings, exactly as the app's Download writes it.
      const cols = AVAILABLE_COLUMNS.filter(c => b.columnIds.includes(c.id));
      await io.write(UTF8_BOM + rowsToCSV(generateRows({ columnIds: b.columnIds, rowCount: b.rowCount, seed: b.seed, locale: b.locale }), cols));
      if (v['answer-key']) {
        const key = buildManifest(b.columnIds, { seed: b.seed, rowCount: b.rowCount, sparsityPct: 0, locale: b.locale, seeding: 'whole', densityPct: 100, headerMode: 'descriptive', formatting: 'canonical', uniquenessPct: 100 });
        io.writeFile(v['answer-key'], JSON.stringify(key, null, 2));
      }
      return 0;
    }
    if (command !== 'generate') fail(`unknown command "${command}" (try --help)`);

    if (v.preset && v.columns) fail('give --preset or --columns, not both');
    if (v.preset && !PRESETS[v.preset]) fail(`unknown preset "${v.preset}" (see: pretendata list presets)`);
    const wanted = v.preset ? PRESETS[v.preset] : v.columns ? v.columns.split(',').map(s => s.trim()).filter(Boolean) : fail('give --preset or --columns (see --help)');
    const unknown = wanted.filter(id => !AVAILABLE_COLUMNS.some(c => c.id === id));
    if (unknown.length) fail(`unknown columns: ${unknown.join(', ')} (see: pretendata list columns)`);
    const cols = AVAILABLE_COLUMNS.filter(c => wanted.includes(c.id));
    const columnIds = cols.map(c => c.id);

    const rowCount = integer(v.rows, 'rows', 1, 100_000_000, 100);
    const format = oneOf<ExportFormat>(v.format, EXPORT_FORMATS, 'format', 'csv');
    const headers = oneOf<HeaderMode>(v.headers, HEADER_MODES, 'headers', 'descriptive');
    const structure = oneOf<JsonStructure>(v.structure, ['flat', 'grouped', 'semantic', 'deep'], 'structure', 'flat');
    const depth = integer(v.depth, 'depth', 1, 10, 3);
    // A region-focused preset carries its locale, as in the app; an explicit --locale wins.
    const locale = oneOf(v.locale, localeIds, 'locale', (v.preset && PRESET_LOCALES[v.preset]) || 'en');
    const row = { sparsity: integer(v.sparsity, 'sparsity', 0, 90, 0), locale, density: integer(v.density, 'density', 1, 100, 100), formatting, uniqueness: integer(v.uniqueness, 'uniqueness', 1, 100, 100) };
    const bom = v['no-bom'] ? '' : UTF8_BOM;
    const large = rowCount > IN_MEMORY_THRESHOLD;

    if (!large) {
      // The app's in-memory path: one seeded stream for the whole dataset.
      const rows = generateRows({ columnIds, rowCount, seed, ...row });
      const shaped = () => (structure === 'flat' ? rekeyRows(rows, cols, headers) : nestRows(rows, structure, depth));
      await io.write(
        format === 'csv' ? bom + rowsToCSV(rows, cols, headers)
        : format === 'sql' ? rowsToSQL(rows, cols, headers)
        : format === 'ndjson' ? rowsToNdjson(shaped())
        : JSON.stringify(shaped(), null, 2),
      );
    } else {
      // The app's streamed path: a header, then independently seeded chunks, never held in memory together.
      if (format === 'json') fail(`a JSON array cannot be streamed; above ${IN_MEMORY_THRESHOLD.toLocaleString()} rows use --format ndjson`);
      if (structure !== 'flat') fail(`--structure applies up to ${IN_MEMORY_THRESHOLD.toLocaleString()} rows`);
      const head = format === 'csv' ? bom + headersFor(cols, headers).map(csvEscape).join(',') + '\n' : format === 'sql' ? sqlCreateTable(cols, headers) : '';
      if (head) await io.write(head);
      for (let chunk = 0; chunk * STREAM_CHUNK_ROWS < rowCount; chunk++) {
        const rows = Math.min(STREAM_CHUNK_ROWS, rowCount - chunk * STREAM_CHUNK_ROWS);
        await io.write(generateChunkText(cols, { seed, chunk, rows, format: format as Exclude<ExportFormat, 'json'>, headers, ...row }));
      }
    }

    if (v['answer-key']) {
      const key = buildManifest(columnIds, { seed, rowCount, sparsityPct: row.sparsity, locale, seeding: large ? 'chunked' : 'whole', densityPct: row.density, headerMode: headers, formatting, uniquenessPct: row.uniqueness });
      io.writeFile(v['answer-key'], JSON.stringify(key, null, 2));
    }
    return 0;
  } catch (e: any) {
    // parseArgs reports unknown flags as TypeError with a code; both are the user's to fix.
    if (e instanceof UsageError || e?.code?.startsWith?.('ERR_PARSE_ARGS')) { log(`pretendata: ${e.message}`); return 2; }
    log(`pretendata: ${e?.stack ?? e}`);
    return 1;
  }
}

// Run when executed directly (not when imported by the tests). npm installs the command as a symlink,
// so compare real paths: without that the installed command would start and do nothing.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const outAt = argv.indexOf('--out');
  const outPath = outAt >= 0 ? argv.splice(outAt, 2)[1] : null;
  const stream = outPath ? createWriteStream(outPath) : process.stdout;
  // Wait for the pipe to drain, so 100M rows never pile up in memory.
  const write = (chunk: string) => (stream.write(chunk) ? undefined : new Promise<void>(r => stream.once('drain', () => r())));
  // A closed pipe (`| head`) is a normal way to stop.
  process.stdout.on('error', e => { if ((e as NodeJS.ErrnoException).code === 'EPIPE') process.exit(0); });
  const writeFile = (path: string, content: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
  main(argv, { write, writeFile }).then(code => {
    if (outPath) (stream as ReturnType<typeof createWriteStream>).end(() => process.exit(code));
    else process.exitCode = code;
  });
}
