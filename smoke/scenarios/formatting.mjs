// K3: identifier formatting through the UI, the export and the answer key.
import { readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
const pick = async (page, current, option) => { await page.click('[role=combobox]', current); await page.click('[role=option]', option); };
export default async (page, check) => {
  await page.goto('/');
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  await pick(page, 'Common Users', 'HR / Employees');
  await pick(page, 'Canonical', 'Evasive');
  await page.fill('input[type="number"]', 500);
  await page.click('button', 'Generate 500 rows');
  await page.waitFor('document.querySelector("h2.text-lg")?.textContent.includes("Generated Data")');
  const data = await page.download(() => page.click('button[aria-label="Export JSON"]'));
  const key = await page.download(() => page.click('button[aria-label="Answer key"]'));
  const rows = JSON.parse(readFileSync(data.path, 'utf8')), k = JSON.parse(readFileSync(key.path, 'utf8'));
  const canonical = rows.filter(r => /^\d{3}-\d{2}-\d{4}$/.test(r.ssn)).length;
  check(k.formatting === 'evasive', 'answer key records the formatting');
  check(canonical > 0 && canonical < rows.length * 0.5, `SSNs are written many ways: ${canonical} of ${rows.length} in the canonical form`);
  check(rows.some(r => /[０-９]/.test(r.ssn)) && rows.some(r => r.ssn.includes('​')), 'full-width and zero-width forms present');
  copyFileSync(data.path, join(page.out, 'fm-data.json')); copyFileSync(key.path, join(page.out, 'fm-key.json'));
  await pick(page, 'Evasive', 'Canonical');
  check(await page.eval('document.querySelector("h2.text-lg").textContent.includes("Live Preview")'), 'changing formatting falls back to the live preview');
};
