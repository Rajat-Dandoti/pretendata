// L1–L3: expectation marks, answer key download, and that the key alone reproduces the data.
import { readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default async (page, check) => {
  await page.init(`window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('out.csv', { create: true });`);
  await page.goto('/');
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  check(await page.eval('!document.querySelector(\'input[type="checkbox"].accent-slate-700\') && ![...document.querySelectorAll("label,button")].some(e => e.textContent.includes("DLP manifest"))'), 'manifest checkbox is gone');
  const marks = await page.eval(`({ fire: document.querySelectorAll('[aria-label="Should fire"]').length, quiet: document.querySelectorAll('[aria-label="Should not fire"]').length, ctx: document.querySelectorAll('[aria-label="Depends on context"]').length })`);
  check(marks.fire > 0 && marks.ctx > 0, `expectation marks in the picker (${JSON.stringify(marks)})`);

  // key before generating: describes the current settings
  const k1 = await page.download(() => page.click('button[aria-label="Answer key"]'));
  const key1 = JSON.parse(readFileSync(k1.path, 'utf8'));
  check(k1.name === 'pretendata.answer-key.json' && key1.version === 2 && key1.generatorVersion === 1 && key1.seeding === 'whole' && key1.seed === 42 && key1.locale === 'en' && key1.rowCount === 100, `answer key before generating (${k1.name}, v${key1.version}, ${key1.seeding}, seed ${key1.seed})`);
  check(key1.columns.length === 9 && key1.columns.every(c => c.expectation && c.header === c.name) && key1.columns.find(c => c.id === 'email').expectation === 'detect', 'key lists 9 columns with header and expectation');
  check(!('kAnonymity' in key1) && !('mode' in key1), 'old fields removed');

  // in-memory run: key + data
  await page.click('button', 'Generate 100 rows');
  await page.waitFor('document.querySelector("h2.text-lg")?.textContent.includes("Generated Data")');
  const data = await page.download(() => page.click('button[aria-label="Export JSON"]'));
  const key = await page.download(() => page.click('button[aria-label="Answer key"]'));
  copyFileSync(data.path, join(page.out, 'ak-data.json')); copyFileSync(key.path, join(page.out, 'ak-key.json'));

  // streamed run: key + hash of the file the browser wrote
  await page.fill('input[type="number"]', 150000);
  await page.waitFor('[...document.querySelectorAll("button")].some(b => b.textContent.includes("Stream 150k"))');
  await page.click('button', 'Stream 150k');
  await page.waitFor('[...document.querySelectorAll("div")].some(d => d.textContent.startsWith("Streamed 150,000 rows"))', 120000);
  const hash = await page.eval(`(async () => { const f = await (await (await navigator.storage.getDirectory()).getFileHandle('out.csv')).getFile(); const h = await crypto.subtle.digest('SHA-256', await f.arrayBuffer()); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); })()`);
  const bigKey = await page.download(() => page.click('button[aria-label="Answer key"]'));
  const big = JSON.parse(readFileSync(bigKey.path, 'utf8'));
  check(big.seeding === 'chunked' && big.chunkRows === 5000 && big.rowCount === 150000, `streamed key: ${big.seeding}, ${big.chunkRows} rows per chunk`);
  copyFileSync(bigKey.path, join(page.out, 'ak-bigkey.json')); writeFileSync(join(page.out, 'ak-bighash.txt'), hash);
  await page.screenshot('answerkey.png');
};
