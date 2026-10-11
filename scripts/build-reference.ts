// Writes the static reference pages into dist/reference/. Opt-in: `npm run build:reference`
// after `npm run build` (or add it to the host's build command). Not part of the default build.
import { mkdirSync, writeFileSync } from 'node:fs';
import { referencePages } from '../src/lib/referencePages';

const out = new URL('../dist/reference/', import.meta.url);
mkdirSync(out, { recursive: true });
const pages = referencePages('../');
for (const [path, html] of pages) writeFileSync(new URL(path, out), html);
console.log(`Wrote ${pages.size} reference pages to dist/reference/`);
