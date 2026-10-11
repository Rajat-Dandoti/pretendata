// U2, U3, U5: picker filters, inline details, preset description, keyboard shortcuts.
import { readFileSync } from 'node:fs';
const names = `[...document.querySelectorAll('aside button[aria-label^="Details for "]')].map(b => b.getAttribute('aria-label').slice(12))`;
const select = (label, value) => `(() => { const s = document.querySelector('select[aria-label="${label}"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '${value}'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`;
export default async (page, check) => {
  await page.goto('/');
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  check((await page.eval(`document.querySelector('[data-role="preset-info"]').textContent`)).startsWith('A typical users table'), 'preset has a one-line description');

  await page.eval(select('Filter columns by region', 'SG'));
  check((await page.eval(names)).join() === 'NRIC (SG),NRIC (near-miss)', `region filter: Singapore → ${await page.eval(names)}`);
  await page.eval(select('Filter columns by what a detector should do', 'detect'));
  check((await page.eval(names)).join() === 'NRIC (SG)', 'adding "should fire" leaves the valid one');

  await page.click('button[aria-label="Details for NRIC (SG)"]');
  const d = await page.eval(`document.querySelector('[data-role="column-details"]').innerText`);
  check(/^[ST]\d{7}[A-Z]\n/.test(d) && d.includes('[ST]\\d{7}[A-Z]') && d.includes('Mod-11') && d.includes('Should fire · SG'), `details show an example, the pattern, the check and the region (${d.split('\n')[0]})`);

  await page.eval(select('Filter columns by region', ''));
  await page.eval(select('Filter columns by what a detector should do', ''));
  await page.eval('document.activeElement.blur()');
  await page.key('/');
  check(await page.eval(`document.activeElement.placeholder?.startsWith('Search columns')`), '"/" focuses the column search');
  await page.fill('input[placeholder^="Search columns"]', 'emirates');
  check((await page.eval(names)).join() === 'Emirates ID (AE),Emirates ID (near-miss)', 'search still works with the filters cleared');

  // Ctrl+Enter downloads with the current format
  await page.eval('document.activeElement.blur()');
  const file = await page.download(() => page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))`));
  check(file.name === 'pretendata.csv' && readFileSync(file.path, 'utf8').split('\n').length === 102, 'Ctrl+Enter downloads the dataset');
  await page.screenshot('picker.png');
};
