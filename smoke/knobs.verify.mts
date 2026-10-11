import { readFileSync } from 'node:fs';
const REPO = import.meta.dirname + '/..', H = import.meta.dirname + '/.out';
const { rowsFromManifest } = await import(`${REPO}/src/lib/manifest.ts`);
const key = JSON.parse(readFileSync(`${H}/kn-key.json`, 'utf8'));
const rebuilt = rowsFromManifest(key).map((r: any) => Object.fromEntries(key.columns.map((c: any) => [c.key, r[c.id]])));
const ok = JSON.stringify(rebuilt) === JSON.stringify(JSON.parse(readFileSync(`${H}/kn-data.json`, 'utf8')));
console.log(`${ok ? '  ok  ' : '  FAIL'} 2,000 thinned rows rebuilt in Node from the key (density 10%, neutral keys) match the browser's export`);
process.exit(ok ? 0 : 1);
