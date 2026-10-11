// Core flow: load, live preview, change preset, generate, export CSV and JSON.
import { readFileSync } from 'node:fs';
export default async (page, check) => {
  await page.goto('/');
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  check((await page.eval('document.title')).includes('Pretendata'), 'page title');
  check(await page.eval('document.querySelectorAll("thead th").length') === 10, 'live preview shows 9 default columns + index');

  // preset dropdown → India PII
  await page.click('button', 'Common Users');
  await page.click('button', 'India PII');
  await page.waitFor('[...document.querySelectorAll("thead th")].some(th => th.textContent.includes("Aadhaar"))');
  check(await page.eval('[...document.querySelectorAll("tbody tr td")].some(td => /^[2-9]\\d{11}$/.test(td.textContent))'), 'India PII preview has a 12-digit Aadhaar');

  // generate 100 rows
  await page.click('button', 'Generate 100 rows');
  await page.waitFor('document.querySelector("h2.text-lg")?.textContent.includes("Generated Data")');
  check(await page.eval('document.querySelectorAll("tbody tr").length') === 100, '100 generated rows shown');

  const csvFile = await page.download(() => page.click('button[aria-label="Export CSV"]'));
  const csv = readFileSync(csvFile.path, 'utf8');
  check(csv.charCodeAt(0) === 0xFEFF && csv.split('\n').length === 102 && csv.endsWith('\n'), `CSV export: BOM, header + 100 rows, trailing newline (${csvFile.name})`);
  check(csv.split('\n')[0].includes('Aadhaar (IN)'), 'CSV header has column names');

  const jsonFile = await page.download(() => page.click('button[aria-label="Export JSON"]'));
  const json = JSON.parse(readFileSync(jsonFile.path, 'utf8'));
  check(Array.isArray(json) && json.length === 100 && /^[2-9]\d{11}$/.test(json[0].aadhaar), 'JSON export: 100 rows with Aadhaar');

  await page.screenshot('baseline.png');
};
