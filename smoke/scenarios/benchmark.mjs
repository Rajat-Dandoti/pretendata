// R3: a benchmark loaded in the app produces the pinned file, and is recognised from its answer key.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const PINNED = { india: 'cbe88c09d242c2a30f57f262ea79ba7d0a6d41682c38ecc1a59354f2f0c86d95' };
export default async (page, check) => {
  await page.goto('/');
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  // start from different settings, to prove the benchmark overrides them
  await page.fill('input[inputmode="numeric"]', '9');
  await page.click('[data-format="json"]');
  await page.click('button[aria-label="Score a tool"]');
  await page.click('button[aria-label="Use the India benchmark"]');
  await page.waitFor('!document.querySelector(\'[role="dialog"]\')');
  const st = await page.eval(`({ rows: document.querySelector('input[type="number"]').value, seed: document.querySelector('input[inputmode="numeric"]').value, cols: document.querySelectorAll('thead th').length - 1, csv: document.querySelector('[data-format="csv"]').getAttribute('aria-checked') })`);
  check(st.rows === '10000' && st.seed === '1001' && st.cols === 22 && st.csv === 'true', `benchmark settings applied (${JSON.stringify(st)})`);

  const file = await page.download(() => page.click('button[aria-label="Download"]'), 60000);
  const sha = createHash('sha256').update(readFileSync(file.path)).digest('hex');
  check(sha === PINNED.india, `the file Chrome downloads has the pinned SHA-256 (${sha.slice(0, 12)}…)`);

  const key = await page.download(() => page.click('button[aria-label="Answer key"]'));
  const k = JSON.parse(readFileSync(key.path, 'utf8'));
  // a tool that calls everything "PII": enough to load the scorecard against this key
  const results = join(page.downloads, 'everything-is-pii.json');
  writeFileSync(results, JSON.stringify(k.columns.map(c => ({ column: c.header, label: c.id === 'city' ? 'NONE' : 'PII' }))));
  await page.click('button[aria-label="Score a tool"]');
  await page.upload('input[data-role="key"]', key.path);
  await page.upload('input[data-role="results"]', results);
  await page.waitFor('document.querySelector(\'[data-role="benchmark"]\')');
  check((await page.eval(`document.querySelector('[data-role="benchmark"]').textContent`)) === 'Benchmark v1 · India', 'the scorecard recognises the benchmark from its answer key');
  check((await page.eval(`document.querySelector('[data-stat="ignore"]').textContent`)).includes('5 false positives'), 'a tool that flags everything gets all five controls wrong');
};
