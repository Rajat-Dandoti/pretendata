// Node API server: exposes the synthetic-data generator over HTTP and serves the built SPA.
// Optional — the website itself runs fully client-side. Run: `npm run server` (tsx watch).
// Dev SPA proxies /api → here (see vite.config.ts).
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AVAILABLE_COLUMNS, CATEGORY_COLORS, PRESETS, PRESET_LOCALES } from '../src/data/schema';
import { frameworksFor } from '../src/lib/frameworks';
import { generateRows, rowsToCSV } from '../src/lib/generate';
import { nestRows, JsonStructure } from '../src/lib/nesting';
import type { LocaleId } from '../src/lib/locale';

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
    ({ id: c.id, name: c.name, category: c.category, region: c.region, validation: c.validation, frameworks: frameworksFor(c) })),
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
  format?: 'json' | 'csv' | 'ndjson';
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
  if (!columnIds || columnIds.length === 0) return { error: 'columnIds or preset required' };
  const unknown = columnIds.filter(id => !KNOWN_IDS.has(id));
  if (unknown.length) return { error: `unknown columnIds: ${unknown.join(', ')}` };

  const rowCount = Number(body.rowCount ?? 100);
  if (!Number.isFinite(rowCount) || rowCount < 1) return { error: 'rowCount must be >= 1' };
  if (rowCount > MAX_ROWS) return { error: `rowCount exceeds max ${MAX_ROWS}` };
  const sparsity = Number(body.sparsity ?? 0);
  if (!Number.isFinite(sparsity) || sparsity < 0 || sparsity > 100) return { error: 'sparsity must be 0–100' };

  // Region-focused presets carry a locale, same as the UI. An explicit `locale` still wins.
  const locale = body.locale ?? (body.preset ? PRESET_LOCALES[body.preset] : undefined);

  const rows = generateRows({ columnIds, rowCount, sparsity, seed: body.seed ?? null, locale });
  return { columnIds, rows };
}

app.post('/api/generate', async (c) => {
  let body: GenBody;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid JSON body' }, 400); }
  const res = resolveGenerate(body);
  if ('error' in res) return c.json({ error: res.error }, 400);

  const format = body.format ?? 'json';
  const structure = body.structure ?? 'flat';
  if (format === 'json') return c.json(nestRows(res.rows, structure, body.nestingDepth));
  const cols = AVAILABLE_COLUMNS.filter(col => res.columnIds.includes(col.id));
  if (format === 'csv') return c.body(rowsToCSV(res.rows, cols), 200, { 'content-type': 'text/csv; charset=utf-8' });
  if (format === 'ndjson') {
    const nested = nestRows(res.rows, structure, body.nestingDepth);
    return c.body(nested.map(r => JSON.stringify(r)).join('\n') + (nested.length ? '\n' : ''), 200, { 'content-type': 'application/x-ndjson' });
  }
  return c.json({ error: `unknown format: ${format}` }, 400);
});

// ---------- static SPA (prod: one deployable) ----------
app.use('/*', serveStatic({ root: './dist' }));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`API on http://localhost:${info.port}  (generate)`);
});
