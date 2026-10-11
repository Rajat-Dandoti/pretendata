// Node API server: exposes the synthetic-data generator over HTTP and serves the built SPA.
// Optional — the website itself runs fully client-side. Run: `npm run server` (tsx watch).
// Dev SPA proxies /api → here (see vite.config.ts).
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AVAILABLE_COLUMNS, CATEGORY_COLORS, PRESETS, PRESET_LOCALES, expectationFor } from '../src/data/schema';
import { frameworksFor } from '../src/lib/frameworks';
import { generateRows, rowsToCSV, rowsToSQL, rekeyRows, HEADER_MODES, HeaderMode } from '../src/lib/generate';
import { nestRows, JsonStructure } from '../src/lib/nesting';
import type { LocaleId } from '../src/lib/locale';
import { FORMATTINGS, Formatting } from '../src/lib/variants';
import { generateDocs, docsToNdjson, TEXT_PACKS, TextPack } from '../src/lib/text';

// Load .env if present — Node built-in, no dotenv dep.
try { process.loadEnvFile(); } catch { /* no .env, or Node < 20.12 */ }

const PORT = Number(process.env.PORT ?? 8787);
const MAX_ROWS = 100_000;
// Optional shared-secret guard for shared deploys. Off by default for localhost.
const API_KEY = process.env.API_KEY ?? '';

const KNOWN_IDS = new Set(AVAILABLE_COLUMNS.map(c => c.id));

const app = new Hono();
app.use('/api/*', cors());
app.use('/api/*', async (c, next) => {
  if (API_KEY && c.req.header('x-api-key') !== API_KEY) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

// ---------- discovery ----------
app.get('/api/columns', (c) => c.json({
  categories: CATEGORY_COLORS,
  columns: AVAILABLE_COLUMNS.map((c) =>
    ({ id: c.id, name: c.name, category: c.category, region: c.region, validation: c.validation, expectation: expectationFor(c), frameworks: frameworksFor(c) })),
}));

app.get('/api/presets', (c) => c.json(PRESETS));

// ---------- generation ----------
interface GenBody {
  columnIds?: string[];
  preset?: string;
  rowCount?: number;
  sparsity?: number;
  seed?: number | null;
  locale?: LocaleId;
  format?: 'json' | 'csv' | 'ndjson' | 'sql';
  density?: number;           // % of rows where a should-fire column holds the real value (1–100)
  headers?: HeaderMode;       // descriptive | neutral | misleading (CSV and flat JSON/NDJSON)
  formatting?: Formatting;    // canonical | mixed | evasive: how identifiers are written
  structure?: JsonStructure;  // JSON/NDJSON nesting: flat | grouped | semantic | deep
  nestingDepth?: number;      // depth for 'deep'
}

/** Resolve+validate a generate request into concrete rows. Returns an error string or the rows. */
function resolveGenerate(body: GenBody): { error: string } | { columnIds: string[]; rows: Record<string, any>[] } {
  let columnIds = body.columnIds;
  if (body.preset) {
    if (!PRESETS[body.preset]) return { error: `unknown preset: ${body.preset}` };
    columnIds = PRESETS[body.preset];
  }
  if (!Array.isArray(columnIds) || columnIds.length === 0) return { error: 'columnIds (array) or preset required' };
  const unknown = columnIds.filter(id => !KNOWN_IDS.has(id));
  if (unknown.length) return { error: `unknown columnIds: ${unknown.join(', ')}` };

  const rowCount = Number(body.rowCount ?? 100);
  if (!Number.isInteger(rowCount) || rowCount < 1) return { error: 'rowCount must be an integer >= 1' };
  if (rowCount > MAX_ROWS) return { error: `rowCount exceeds max ${MAX_ROWS}` };
  const sparsity = Number(body.sparsity ?? 0);
  if (!Number.isFinite(sparsity) || sparsity < 0 || sparsity > 100) return { error: 'sparsity must be 0–100' };
  if (body.seed != null && !Number.isFinite(body.seed)) return { error: 'seed must be a number' };
  const density = Number(body.density ?? 100);
  if (!Number.isFinite(density) || density < 1 || density > 100) return { error: 'density must be 1–100' };
  if (body.headers != null && !HEADER_MODES.includes(body.headers)) return { error: `headers must be one of: ${HEADER_MODES.join(', ')}` };
  if (body.formatting != null && !FORMATTINGS.includes(body.formatting)) return { error: `formatting must be one of: ${FORMATTINGS.join(', ')}` };

  // Region-focused presets carry a locale, same as the UI. An explicit `locale` still wins.
  const locale = body.locale ?? (body.preset ? PRESET_LOCALES[body.preset] : undefined);

  const rows = generateRows({ columnIds, rowCount, sparsity, seed: body.seed ?? null, locale, density, formatting: body.formatting });
  return { columnIds, rows };
}

app.post('/api/generate', async (c) => {
  let body: GenBody;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (!body || typeof body !== 'object') return c.json({ error: 'body must be a JSON object' }, 400);
  const res = resolveGenerate(body);
  if ('error' in res) return c.json({ error: res.error }, 400);

  const format = body.format ?? 'json';
  const structure = body.structure ?? 'flat';
  const cols = AVAILABLE_COLUMNS.filter(col => res.columnIds.includes(col.id));
  // Header modes rename flat output only; nested structures are named after what they hold.
  const shaped = () => (structure === 'flat' ? rekeyRows(res.rows, cols, body.headers) : nestRows(res.rows, structure, body.nestingDepth));
  if (format === 'json') return c.json(shaped());
  if (format === 'csv') return c.body(rowsToCSV(res.rows, cols, body.headers), 200, { 'content-type': 'text/csv; charset=utf-8' });
  if (format === 'sql') return c.body(rowsToSQL(res.rows, cols, body.headers), 200, { 'content-type': 'application/sql; charset=utf-8' });
  if (format === 'ndjson') {
    const nested = shaped();
    return c.body(nested.map(r => JSON.stringify(r)).join('\n') + (nested.length ? '\n' : ''), 200, { 'content-type': 'application/x-ndjson' });
  }
  return c.json({ error: `unknown format: ${format}` }, 400);
});

// ---------- text documents ----------
app.post('/api/text', async (c) => {
  let body: { pack?: TextPack; count?: number; seed?: number | null; locale?: LocaleId; formatting?: Formatting };
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (!body || typeof body !== 'object') return c.json({ error: 'body must be a JSON object' }, 400);
  const pack = body.pack ?? 'mixed';
  if (!TEXT_PACKS.includes(pack)) return c.json({ error: `pack must be one of: ${TEXT_PACKS.join(', ')}` }, 400);
  const count = Number(body.count ?? 100);
  if (!Number.isInteger(count) || count < 1 || count > MAX_ROWS) return c.json({ error: `count must be an integer from 1 to ${MAX_ROWS}` }, 400);
  if (body.seed != null && !Number.isFinite(body.seed)) return c.json({ error: 'seed must be a number' }, 400);
  if (body.formatting != null && !FORMATTINGS.includes(body.formatting)) return c.json({ error: `formatting must be one of: ${FORMATTINGS.join(', ')}` }, 400);
  const docs = generateDocs({ pack, count, seed: body.seed ?? null, locale: body.locale, formatting: body.formatting });
  return c.body(docsToNdjson(docs), 200, { 'content-type': 'application/x-ndjson' });
});

// ---------- static SPA (prod: one deployable) ----------
app.use('/*', serveStatic({ root: './dist' }));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`API on http://localhost:${info.port}  (generate)`);
});
