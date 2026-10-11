// Node side: rebuild the browser's data from the answer keys alone.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const REPO = import.meta.dirname + '/..', H = import.meta.dirname + '/.out';
const { rowsFromManifest } = await import(`${REPO}/src/lib/manifest.ts`);
const { rowsToCSV, UTF8_BOM } = await import(`${REPO}/src/lib/generate.ts`);
const { AVAILABLE_COLUMNS } = await import(`${REPO}/src/data/schema.ts`);
const key = JSON.parse(readFileSync(`${H}/ak-key.json`, 'utf8'));
const same = JSON.stringify(rowsFromManifest(key)) === JSON.stringify(JSON.parse(readFileSync(`${H}/ak-data.json`, 'utf8')));
console.log(`${same ? '  ok  ' : '  FAIL'} in-memory: 100 rows rebuilt in Node from the key match the browser's JSON export`);
const big = JSON.parse(readFileSync(`${H}/ak-bigkey.json`, 'utf8'));
const cols = AVAILABLE_COLUMNS.filter((c: any) => big.columns.some((k: any) => k.id === c.id));
const csv = UTF8_BOM + rowsToCSV(rowsFromManifest(big), cols);
const h = createHash('sha256').update(csv).digest('hex');
const ok = h === readFileSync(`${H}/ak-bighash.txt`, 'utf8');
console.log(`${ok ? '  ok  ' : '  FAIL'} streamed: 150,000-row CSV rebuilt in Node from the key has the same SHA-256 as the file Chrome wrote`);
// The command-line tool, as a real process with the same settings, writes the same file as Chrome did.
const { execFileSync } = await import('node:child_process');
const cliOut = `${H}/ak-cli.csv`;
execFileSync('npx', ['tsx', `${REPO}/bin/pretendata.ts`, '--columns', big.columns.map((c: any) => c.id).join(','), '--rows', String(big.rowCount), '--seed', String(big.seed), '--out', cliOut], { stdio: ['ignore', 'ignore', 'ignore'] });
const cli = createHash('sha256').update(readFileSync(cliOut)).digest('hex') === readFileSync(`${H}/ak-bighash.txt`, 'utf8');
console.log(`${cli ? '  ok  ' : '  FAIL'} the CLI, run as a process with the same settings, writes a byte-identical 150,000-row file`);
process.exit(same && ok && cli ? 0 : 1);
