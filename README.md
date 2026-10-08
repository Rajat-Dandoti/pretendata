# Pretendata

**Synthetic, privacy-safe test data — generated entirely in your browser.**

Pretendata builds realistic-but-fake datasets for QA, analytics, and **DLP / DSPM testing**: it ships
data that *looks* sensitive but identifies no real person, so you can exercise data-loss-prevention
and classification tools without touching production data. Every value runs client-side — nothing you
generate ever leaves your machine.

🔗 **Live demo:** <https://pretendata.voidkit.workers.dev/>

For the exact shape, algorithm, and validation contract of every column, see **[COLUMNS.md](COLUMNS.md)**.

## Features

- **11 privacy categories**, colour-coded by sensitivity — PII, PHI, PCI, Secrets, Biometric, Network,
  Quasi-Identifier, Statistical, Masked, Non-Sensitive, and **DLP-Negative** (checksum-broken false-positive controls).
- **Checksum-valid identifiers** so real detectors actually match — Aadhaar (Verhoeff), IBAN (mod-97),
  IMEI/NPI (Luhn), NHS (mod-11), GSTIN (mod-36), VIN, EAN-13, ISIN, Saudi Iqama (Luhn), and more.
- **Near-miss / DLP-Negative controls** — the same identifiers with the check digit deliberately broken,
  to measure a detector's false-positive rate.
- **Secret-scanner bait** — AWS/GitHub/Stripe/Google keys, JWT, bcrypt, PEM, basic-auth URLs in vendor-accurate shapes.
- **Region-specific IDs** — India (Aadhaar, PAN, GSTIN, UPI, Voter ID, IFSC, ABHA, vehicle reg…), US, UK, EU, Saudi.
- **Compliance tagging (beta)** — see which regulations (GDPR / HIPAA / DPDP) each column falls under,
  with a per-column footprint breakdown.
- **Column Reference** drawer — a live example, regex/pattern, and checksum algorithm for every column.
- **Nested-JSON export** — flat, grouped-by-category, semantic record, or deep-nested N levels
  (to test whether a classifier traverses nested structures).
- Chaos / malformed preset, dataset risk summary, reproducible **seeds**, sparsity (null injection),
  locale support, shareable config links, and large-dataset streaming (up to 100M rows) to a single
  file in any browser.
- Responsive layout — off-canvas sidebars on mobile, collapsible panels on desktop.
- Export to **CSV / JSON / NDJSON** with an optional DLP manifest sidecar.

## Quick start

```bash
npm install
npm run dev
```

Open the local URL it prints (e.g. `http://localhost:3000`). That's it — the app is fully client-side.

## Large datasets (>100k rows)

Above 100k rows the app skips the in-memory preview and streams straight to one CSV/NDJSON file:

- **Parallel generation** — a pool of Web Workers (up to 8, one core left free) generates chunks that
  are written in order. Speed depends mostly on how many columns are selected.
- **Periodic saves (Chrome / Edge)** — the file you picked is committed about every 30 seconds, less
  often as it grows, so a reload or crash only loses the rows since the last save. Each save may
  briefly need extra free disk space. Other browsers stream through their normal download instead.
- **Keep the tab open** — the browser asks before a reload or close mid-run. Sleep pauses the run. For
  multi-hour runs prefer `npm run build && npm run preview` (or the live demo) over `npm run dev`,
  whose dev server reloads the page when it reconnects.
- **Seeds** — streamed output is seeded per 5,000-row chunk, so the same seed and row count always
  reproduce the same file. Seeded files above 100k rows made before this scheme do not match.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` | TypeScript type-check (`tsc --noEmit`) |
| `npm test` | Generator/validator self-checks (checksum round-trips, format asserts) |
| `npm run server` | Optional API server (see below) |

## Deploy (free, static)

The site is static — build it and drop `dist/` on any static host.

**Cloudflare Pages** (recommended): connect the repo and set
- **Build command:** `npm run build`
- **Output directory:** `dist`

This is a single-page app — the host needs to fall back to `index.html` for unknown paths (Cloudflare
Pages/Workers and Netlify do this automatically for a Vite SPA; GitHub Pages needs a `base` path in
`vite.config.ts` plus a deploy action). `public/` ships `sw.js` + `mitm.html` — a self-hosted
[streamsaver](https://github.com/jimmywarting/StreamSaver.js) service worker used as the >100k-row
export fallback in browsers without the File System Access API — make sure your host serves these as
static files at the site root.

## Optional API server

The generator is also exposed over HTTP for automation (scripts, CI, seeding a database) — **the website
does not need it.** Run `npm run server` (Hono, port 8787). In production it can also serve the built
SPA from `dist/`.

- `GET /api/columns` — column catalog (id, name, category, region, validation, framework tags) + colors.
- `GET /api/presets` — named column bundles.
- `POST /api/generate` — body: `{ columnIds?|preset?, rowCount, sparsity?, seed?, locale?, format?, structure?, nestingDepth? }`.
  `format` ∈ `json` (default) · `csv` · `ndjson`; `structure` ∈ `flat` · `grouped` · `semantic` · `deep`.

```bash
curl -X POST localhost:8787/api/generate -H 'content-type: application/json' \
  -d '{"preset":"India PII","rowCount":3}'

curl -X POST localhost:8787/api/generate -H 'content-type: application/json' \
  -d '{"columnIds":["email","ssn"],"rowCount":100,"seed":42,"format":"csv"}'
```

Set `API_KEY` to require an `x-api-key` header on `/api/*` in shared deployments.

## License

[MIT](LICENSE) © Rajat Dandoti
