// K1 + K2: header modes and density through the real UI, exports, answer key, share link and stream.
import { readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
const pick = async (page, current, option) => { await page.click('[role=combobox]', current); await page.click('[role=option]', option); };
const heads = `[...document.querySelectorAll('thead th')].slice(1).map(th => th.querySelector('span').textContent)`;
export default async (page, check) => {
  await page.init(`window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('out.ndjson', { create: true });`);
  await page.goto('/');
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  await pick(page, 'Common Users', 'HR / Employees');

  // neutral headers
  await pick(page, 'Descriptive', 'Neutral');
  check((await page.eval(heads)).slice(0, 3).join() === 'col_01,col_02,col_03', `preview shows neutral headers: ${(await page.eval(heads)).slice(0, 3)}`);
  // density 10%
  await pick(page, 'Every row', '10% of rows');
  await page.fill('input[type="number"]', 2000);
  await page.click('button', 'Generate 2k rows');
  await page.waitFor('document.querySelector("h2.text-lg")?.textContent.includes("Generated Data")');

  const csvF = await page.download(() => page.click('button[aria-label="Export CSV"]'));
  const csv = readFileSync(csvF.path, 'utf8');
  check(csv.slice(1, 25).startsWith('col_01,col_02,col_03'), 'CSV header is neutral');
  const jsonF = await page.download(() => page.click('button[aria-label="Export JSON"]'));
  const rows = JSON.parse(readFileSync(jsonF.path, 'utf8'));
  check(Object.keys(rows[0]).join() === Array.from({ length: 13 }, (_, i) => `col_${String(i + 1).padStart(2, '0')}`).join(), 'JSON keys are neutral');
  const keyF = await page.download(() => page.click('button[aria-label="Answer key"]'));
  const key = JSON.parse(readFileSync(keyF.path, 'utf8'));
  const ssn = key.columns.find(c => c.id === 'ssn');
  const share = rows.filter(r => /^\d{3}-\d{2}-\d{4}$/.test(r[ssn.key])).length / rows.length;
  check(key.headerMode === 'neutral' && key.densityPct === 10 && ssn.header.startsWith('col_') && ssn.key === ssn.header, `answer key records neutral headers and 10% density (SSN is ${ssn.header})`);
  check(share > 0.07 && share < 0.13, `real SSNs in ${(share * 100).toFixed(1)}% of 2,000 rows (asked for 10%)`);
  copyFileSync(jsonF.path, join(page.out, 'kn-data.json')); copyFileSync(keyF.path, join(page.out, 'kn-key.json'));

  // changing density drops the stale rows
  await pick(page, '10% of rows', '50% of rows');
  check(await page.eval('document.querySelector("h2.text-lg").textContent.includes("Live Preview")'), 'changing density falls back to the live preview');

  // misleading headers: no column keeps its own name
  await pick(page, 'Neutral', 'Misleading');
  const mis = await page.eval(heads);
  const real = await page.eval(`[...document.querySelectorAll('thead th')].slice(1).map(th => th.querySelector('span').title.replace('Holds: ', ''))`);
  check(mis.every((h, i) => h !== real[i]) && [...mis].sort().join() === [...real].sort().join(), `misleading: every header is another column's name (first is "${mis[0]}" over ${real[0]})`);

  // share link carries both settings
  // (headless Chrome has no clipboard, so take the link's payload from where the app also saves it)
  const hash = await page.eval(`localStorage.getItem('pretendata:config')`);
  await page.eval('localStorage.clear()');
  await page.goto('/#' + hash);
  await page.reload();
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  const combos = await page.eval(`[...document.querySelectorAll('[role=combobox]')].map(b => b.textContent)`);
  check(combos.includes('Misleading (names swapped)') && combos.includes('50% of rows'), 'share link restores header mode and density');

  // streamed NDJSON under misleading headers
  await page.fill('input[type="number"]', 120000);
  await page.click('button', 'NDJSON');
  await page.click('button', 'Stream 120k');
  await page.waitFor('[...document.querySelectorAll("div")].some(d => d.textContent.startsWith("Streamed 120,000 rows"))', 120000);
  const first = await page.eval(`(async () => { const f = await (await (await navigator.storage.getDirectory()).getFileHandle('out.ndjson')).getFile(); const t = await f.slice(0, 4000).text(); return JSON.parse(t.split('\\n')[0]); })()`);
  const sk = JSON.parse(readFileSync((await page.download(() => page.click('button[aria-label="Answer key"]'))).path, 'utf8'));
  check(Object.keys(first).join() === sk.columns.map(c => c.key).join() && sk.columns.every(c => c.key !== c.id), 'streamed NDJSON keys match the answer key and none is its own id');
  await page.screenshot('knobs.png');
};
