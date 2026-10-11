# Changelog

Three numbers move independently:

- the **package version** below follows semantic versioning;
- `GENERATOR_VERSION` changes only when the same seed and settings would produce different values, and is recorded in every answer key;
- each **benchmark version** is tied to one generator version.

## 1.0.0 — 2026-10-11

First release. Generator version 5, benchmark version 2.

- 166 columns across 12 categories, each marked as should fire, should not fire or context. 29 identifiers have validators tested against published examples; 23 are cross-checked against python-stdnum and schwifty ([VALIDATION.md](VALIDATION.md)).
- Negative controls: 32 near-miss and look-alike columns, each valid as nothing.
- Settings for headers, identifier density, formatting variants and quasi-identifier uniqueness.
- Output as CSV, JSON, NDJSON, SQL and gzip; text documents and AI prompts with entity positions; a secrets fixture repository; related tables.
- An answer key that regenerates the dataset, a scorecard, and a masking check with k-anonymity and l-diversity.
- A command-line tool whose output matches the browser's byte for byte, and three pinned benchmarks.

The package has no dependencies: Faker 10.6.0 is bundled into the command, so the same seed gives the same bytes on every install. Upgrading Faker is a generator-version change.

Fixed before release, found by the cross-check: Indian voter IDs now carry their Luhn check digit; Spanish, French and Italian IBANs carry their national check digits; Chinese resident IDs use region codes that exist for every birth year; PAN serials are never `0000`. Benchmark version 1 was retired for this reason.
