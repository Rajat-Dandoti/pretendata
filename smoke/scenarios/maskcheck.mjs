// M1 + M2: generate in the app, "mask" the export here with planted defects, check it in the app.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const pick = async (page, current, option) => { await page.click('[role=combobox]', current); await page.click('[role=option]', option); };
const cell = (id, n) => `document.querySelector('[data-column="${id}"]').children[${n}].textContent`;
export default async (page, check) => {
  await page.goto('/');
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  await pick(page, 'Common Users', 'HR / Employees');
  await page.fill('input[type="number"]', 500);
  await page.click('button[aria-label="Preview rows"]');
  await page.waitFor('document.querySelector("h2.text-lg")?.textContent.includes("Generated Data")');
  const data = await page.download(() => page.click('[data-format="csv"]').then(() => page.click('button[aria-label="Download"]')));
  const key = await page.download(() => page.click('button[aria-label="Answer key"]'));

  // A stand-in masking tool: tokenise names, emails and phones, keep the SSN's shape — and slip up three times.
  const [header, ...lines] = readFileSync(data.path, 'utf8').replace(/^﻿/, '').trim().split('\n');
  const cols = header.split(',');
  const at = name => cols.indexOf(name);
  const rows = lines.map(l => l.split(','));
  const originalEmail = rows[9][at('Email Address')];
  const masked = rows.map((r, i) => r.map((v, j) => {
    if (cols[j] === 'SSN') return i === 4 || i === 5 ? v : `900-00-${v.slice(-4)}`;       // two SSNs left as they were
    if (['First Name', 'Last Name', 'Email Address', 'Phone Number'].includes(cols[j])) return 'tok_' + Buffer.from(v).toString('hex').slice(0, 16).padEnd(16, '0') + v.length;
    return v;
  }));
  masked[10][at('Job Title')] = originalEmail;                                              // an email copied into a free-text column
  const file = join(page.downloads, 'masked-by-acme.csv');
  writeFileSync(file, [header, ...masked.map(r => r.join(','))].join('\n'));

  await page.click('button[aria-label="Check masking"]');
  await page.upload('input[data-role="key"]', key.path);
  await page.upload('input[data-role="masked"]', file);
  await page.waitFor('document.querySelector(\'[data-stat="leaks"]\')', 30000);
  const head = await page.eval(`document.querySelector('[data-stat="leaks"]').textContent`);
  check(head.includes('3 original values survived') && head.includes('500 masked rows against 500 originals'), `summary: ${head.slice(0, 70)}`);
  check((await page.eval(cell('ssn', 1))) === '2 / 500', `SSN unchanged: ${await page.eval(cell('ssn', 1))}`);
  check((await page.eval(cell('email', 2))) === '1', 'the email found in another column');
  check((await page.eval(cell('ssn', 3))) === '498' && (await page.eval(cell('ssn', 6))) === '100%' && (await page.eval(cell('ssn', 7))) === '0%', 'SSN: last four kept, format kept, no longer valid');
  check((await page.eval(cell('firstName', 1))) === '0 / 500', 'tokenised names: none unchanged');
  await page.screenshot('maskcheck.png');
  const md = await page.download(() => page.click('button[aria-label="Export masking report"]'));
  check(readFileSync(md.path, 'utf8').startsWith('# Masking check: masked-by-acme') , `report exported as ${md.name}`);

  // an unseeded dataset cannot be checked, and says why
  const unseeded = join(page.downloads, 'unseeded.json');
  writeFileSync(unseeded, JSON.stringify({ ...JSON.parse(readFileSync(key.path, 'utf8')), seed: null }));
  await page.upload('input[data-role="key"]', unseeded);
  await page.waitFor('document.querySelector(\'[role="dialog"] [role="alert"]\')');
  check((await page.eval('document.querySelector(\'[role="dialog"] [role="alert"]\').textContent')).includes('without a seed'), 'an unseeded key is refused with the reason');
};
