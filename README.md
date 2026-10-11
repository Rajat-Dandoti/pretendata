# Pretendata

**Synthetic, privacy-safe test data — generated entirely in your browser.**

Pretendata builds realistic-but-fake datasets for QA, analytics, and **DLP / DSPM testing**: it ships
data that *looks* sensitive but identifies no real person, so you can exercise data-loss-prevention
and classification tools without touching production data. Every value runs client-side — nothing you
generate ever leaves your machine.

The loop it is built for: **generate** a dataset whose right answers are known, run your detection
tool over it, then **score** the tool's output against the answer key.

🔗 **Live demo:** <https://pretendata.voidkit.workers.dev/>

For the exact shape, algorithm, and validation contract of every column, see **[COLUMNS.md](COLUMNS.md)**.

## Features

- **12 privacy categories**, colour-coded by sensitivity — PII, PHI, PCI, Secrets, Biometric, Network,
  Quasi-Identifier, Statistical, Masked, Non-Sensitive, **DLP-Negative** (checksum-broken false-positive
  controls), and **Chaos** (malformed / hostile values).
- **165 columns, checksum-valid where a checksum exists** so real detectors actually match — Aadhaar
  (Verhoeff), IBAN (mod-97), IMEI/NPI (Luhn), NHS (mod-11), GSTIN (mod-36), VIN, EAN-13, ISIN, and more.
- **An expectation on every column** — should fire, should not fire, or depends on context — shown in
  the picker and written to the answer key.
- **Answer key** — one click downloads what each column holds, what a detector should do with it, and
  the settings that regenerate the exact dataset.
- **Scorecard** — load your tool's per-column results (JSON or CSV), say what each of its labels means,
  and see recall, false positives and whether near-misses were told apart. Export as Markdown or JSON.
- **Masking check** — load a seeded dataset's answer key and the same data after your masking or
  tokenisation tool has run. The originals are rebuilt from the key (never uploaded) and compared: values
  left unchanged, values that leaked into another cell, inconsistent tokens, collisions, format kept.
  It also reports re-identification risk before and after: k-anonymity over the quasi-identifiers you
  pick, and l-diversity of a sensitive column.
- **Text and AI prompts** — emails, support tickets, chat, clinical notes, log lines and prompts with
  identifiers embedded in the prose. Each document lists its entities (start, end, type, value) as its
  own answer key, for testing mail and chat DLP, entity recognisers and AI guardrails.
- **Secrets fixture repository** — a zip of `.env`, YAML, source, SQL and key files with fake secrets
  planted in them and decoys beside them, plus an answer key with file and line, for Gitleaks-style
  scanners and pre-commit hooks.
- **Near-miss / DLP-Negative controls** — the same identifiers with the check digit deliberately broken,
  a never-issued range or two digits swapped, plus hard negatives (timestamps, order and tracking
  numbers) that only look like identifiers. Each is guaranteed valid as nothing, to measure a
  detector's false-positive rate.
- **Secret-scanner bait** — AWS, GitHub, Stripe, Google, Slack, OpenAI, Anthropic, npm, SendGrid, Twilio and
  Azure keys, JWT, bcrypt, PEM and OpenSSH keys, GCP service-account JSON, connection strings.
- **Region-specific IDs with real check rules** — India (Aadhaar, PAN, GSTIN, UPI, Voter ID, IFSC, ABHA,
  vehicle reg, passport…), US (SSN, ITIN, EIN, NPI, DEA), Canada (SIN), Brazil (CPF, CNPJ), UK (NHS, NINO),
  Spain (DNI, NIE), Netherlands (BSN), France (NIR), Singapore (NRIC), Australia (TFN), China (resident ID),
  South Africa, UAE (Emirates ID), Saudi (Iqama). Each validator is tested against a published example.
- **Compliance tagging (beta)** — see which regulations (GDPR / HIPAA / DPDP) each column falls under,
  with a per-column footprint breakdown.
- **Column Reference** drawer — a live example, regex/pattern, and checksum algorithm for every column.
- **Nested-JSON export** — flat, grouped-by-category, semantic record, or deep-nested N levels
  (to test whether a classifier traverses nested structures).
- Chaos / malformed preset, dataset risk summary, reproducible **seeds**, sparsity (null injection),
  locale support, shareable config links, and large-dataset streaming (up to 100M rows) to a single
  file in any browser.
- Responsive layout — off-canvas sidebars on mobile, collapsible panels on desktop.
- **Harder tests from four settings** — *Headers*: descriptive, neutral (`col_01` …) or misleading (real
  names on the wrong columns), to see whether a tool reads values or trusts column names.
  *Identifier density*: real identifiers in only 50% down to 1% of rows, to test scanners that sample.
  *Quasi-identifier uniqueness*: make 90% down to 25% of rows share their birth date, gender, zip and city
  with other people, so anonymisation has realistic groups to work on.
  *Identifier formatting*: the same valid values written with spaces, dashes or labels (mixed), or with
  full-width digits, invisible characters, dots and base64 (evasive).
- **One Download button** — pick CSV, JSON, NDJSON or SQL beside it. The table always shows a live sample
  of the current settings; *Preview* shows the first 100 rows of the real dataset without downloading.
  Small datasets are built in memory, large ones are written to the file as they are generated; you do
  not have to choose. (A JSON array cannot be written that way, so large runs use NDJSON in its place.)
- Formats: **CSV / JSON / NDJSON / SQL**. CSV files start with a UTF-8 BOM so Excel reads non-ASCII
  names correctly. The SQL dump is a `CREATE TABLE` plus batched `INSERT`s with unquoted snake_case
  column names, and loads as is into SQLite and PostgreSQL (MySQL needs `NO_BACKSLASH_ESCAPES` if a
  value holds a backslash).
- Remembers your last settings in the browser; a share link always wins over them.

## Quick start

```bash
npm install
npm run dev
```

Open the local URL it prints (e.g. `http://localhost:5173`). That's it — the app is fully client-side.

## Nothing leaves your machine — check it yourself

The site is served with a content security policy ([`public/_headers`](public/_headers)) that allows
connections, scripts, workers and frames from its own origin only. Open your browser's network panel,
generate and download a dataset, and you will see no request to any other host. `npm run smoke` asserts
the same thing in headless Chrome.

## Large datasets (>100k rows)

Above 100k rows the same Download button writes straight to one CSV, NDJSON or SQL file as the rows
are generated:

- **Parallel generation** — a pool of Web Workers (up to 8, one core left free) generates chunks that
  are written in order. Speed depends mostly on how many columns are selected.
- **Periodic saves (Chrome / Edge)** — the file you picked is committed about every 30 seconds, less
  often as it grows, so a reload or crash only loses the rows since the last save. Each save may
  briefly need extra free disk space. Other browsers stream through their normal download instead.
- **Compression** — tick *Compress as .gz* to write the file gzip-compressed with the browser's own
  compressor. Measured on 20,000-row CSVs, the result is 37% to 58% of the original size depending on
  the columns.
- **Keep the tab open** — the browser asks before a reload or close mid-run. Sleep pauses the run. For
  multi-hour runs prefer `npm run build && npm run preview` (or the live demo) over `npm run dev`,
  whose dev server reloads the page when it reconnects.
- **Seeds** — streamed output is seeded per 5,000-row chunk, so the same seed and row count always
  reproduce the same file. `npm test` pins a hash of each column's seeded output, so a change to it is always
  deliberate and comes with a bump of `GENERATOR_VERSION`, which the answer key records. Seeded files above 100k rows made before this scheme do not match.
- **Seeded dates** — with a seed, relative dates (date of birth, age, created-at, hire date, last
  login, graduation year) are measured from a fixed reference date, 2026-01-01 UTC, not today, so
  the output is the same on any day. Leave the seed blank for dates relative to now.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` | TypeScript type-check (`tsc --noEmit`) |
| `npm test` | Self-checks: checksum round-trips, format asserts, the pinned seed contract, the streaming writer, the answer key, the scorecard, and that COLUMNS.md covers every column |
| `npm run cli -- …` | The command-line tool (see below) |
| `npm run build:cli` | Bundle the command-line tool into `dist-cli/pretendata.js` |
| `npm run pin-seed` | Records the seeded output of new columns in `src/lib/seed-contract.json`. Refuses to overwrite a changed column until `GENERATOR_VERSION` is bumped |
| `npm run smoke` | Builds, then drives the real app in headless Chrome: generate, export, both large-file paths, keyboard use, answer key, scorecard. Needs Chrome; set `CHROME` to its path if it is not found |
| `npm run server` | Optional API server (see below) |

## Deploy (free, static)

The site is static — build it and drop `dist/` on any static host.

**Cloudflare Pages** (recommended): connect the repo and set
- **Build command:** `npm run build`
- **Output directory:** `dist`

This is a single-page app — the host needs to fall back to `index.html` for unknown paths (Cloudflare
Pages/Workers and Netlify do this automatically for a Vite SPA; GitHub Pages needs a `base` path in
`vite.config.ts` plus a deploy action). `public/` ships `_headers` (the content security policy, read by Cloudflare) and `sw.js` + `mitm.html` + `mitm.js` — a self-hosted
[streamsaver](https://github.com/jimmywarting/StreamSaver.js) service worker used as the >100k-row
export fallback in browsers without the File System Access API — make sure your host serves these as
static files at the site root.

## Standard benchmarks

Three fixed datasets that anyone can regenerate byte for byte, so two tools, or one tool on two days,
are scored on identical data against the same answer key. They are defined in
[`src/data/benchmarks.ts`](src/data/benchmarks.ts), each pinned by the SHA-256 of its CSV.

| Benchmark | Rows | Columns | What it holds |
|---|---|---|---|
| `india` | 10,000 | 22 | Indian identifiers, their near-misses and hard negatives |
| `global` | 10,000 | 121 | The whole catalog as of benchmark version 1 |
| `secrets` | 10,000 | 17 | Credentials and keys, next to opaque business identifiers |

In the app: *Score a tool* → *Use*, then Download and *Answer key*. From a terminal:

```bash
npm run cli -- benchmark india --out india.csv --answer-key india.key.json
shasum -a 256 india.csv   # c20afeef3ef9bbd89341195dbadfc4716bc847fb45e2c97f6b1375b975cd5070
```

Run your tool over the file, then load its results and the answer key in *Score a tool*. A benchmark
is tied to one generator version; when the generator changes, a new benchmark version is published
and the old one is retired. A synthetic benchmark complements a trial on your own data. It does not
replace one.

## Command line

The same generator runs from a terminal, for CI pipelines and scripts. For the same settings it writes
the same bytes as the app's Download button, so one answer key fits both.

```bash
npm run cli -- --preset "India PII" --rows 1000000 --seed 42 --out india.csv --answer-key india.key.json
npm run cli -- --columns email,ssn --rows 100 --format ndjson
npm run cli -- text --pack prompt --count 500 --seed 7 > prompts.ndjson
npm run cli -- list presets
npm run cli -- --help
```

`npm run build:cli` bundles it into `dist-cli/pretendata.js`, a single Node script (the `bin` entry of this
package), so `npm link` gives you a `pretendata` command. Output goes to standard output unless `--out`
is given; large runs are written chunk by chunk and never held in memory.

## Optional API server

The generator is also exposed over HTTP for automation (scripts, CI, seeding a database) — **the website
does not need it.** Run `npm run server` (Hono, port 8787). In production it can also serve the built
SPA from `dist/`.

- `GET /api/columns` — column catalog (id, name, category, region, validation, expectation, framework tags) + colors.
- `GET /api/presets` — named column bundles.
- `POST /api/generate` — body: `{ columnIds?|preset?, rowCount, sparsity?, seed?, locale?, density?, headers?, formatting?, uniqueness?, format?, structure?, nestingDepth? }`.
  `format` ∈ `json` (default) · `csv` · `ndjson` · `sql`; `structure` ∈ `flat` · `grouped` · `semantic` · `deep`;
  `rowCount` is an integer up to 100,000; `nestingDepth` is clamped to 1–10; `density` is 1–100;
  `headers` ∈ `descriptive` · `neutral` · `misleading` (CSV and flat JSON/NDJSON);
  `formatting` ∈ `canonical` · `mixed` · `evasive`; `uniqueness` is 1–100.

```bash
curl -X POST localhost:8787/api/generate -H 'content-type: application/json' \
  -d '{"preset":"India PII","rowCount":3}'

curl -X POST localhost:8787/api/generate -H 'content-type: application/json' \
  -d '{"columnIds":["email","ssn"],"rowCount":100,"seed":42,"format":"csv"}'
```

- `POST /api/text` — body: `{ pack?, count?, seed?, locale?, formatting? }`; `pack` ∈ `email` · `ticket` · `chat` ·
  `clinical` · `log` · `prompt` · `mixed` (default). Returns NDJSON, one document per line with its `entities`.

Set `API_KEY` to require an `x-api-key` header on `/api/*` in shared deployments.

## License

[MIT](LICENSE) © Rajat Dandoti
