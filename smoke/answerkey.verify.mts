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
process.exit(same && ok ? 0 : 1);
