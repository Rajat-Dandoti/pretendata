// F7: keyboard dropdown, tap/keyboard tooltip, remembered settings, error toast, link precedence.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default async (page, check) => {
  await page.goto('/');
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  const trigger = 'document.querySelector("[role=combobox]")';

  // keyboard-only preset change
  await page.eval(`${trigger}.focus()`);
  await page.key('ArrowDown');
  check(await page.eval(`${trigger}.getAttribute("aria-expanded") === "true" && !!document.querySelector("[role=listbox]")`), 'ArrowDown opens the list');
  await page.key('ArrowDown');
  check(await page.eval(`document.getElementById(${trigger}.getAttribute("aria-activedescendant")).textContent`) === 'HR / Employees', 'ArrowDown moves the highlight');
  await page.key('Enter');
  await page.waitFor('[...document.querySelectorAll("thead th")].some(th => th.textContent.includes("SSN"))');
  check(await page.eval(`${trigger}.textContent`) === 'HR / Employees' && await page.eval('!document.querySelector("[role=listbox]")'), 'Enter selects and closes');
  await page.key('Enter');
  await page.key('Escape');
  check(await page.eval(`!document.querySelector("[role=listbox]") && document.activeElement === ${trigger}`), 'Escape closes and focus stays on the trigger');

  // tooltip as popover
  await page.click('button[aria-label^="Affects names"]');
  const tip = await page.eval(`(() => { const p = document.querySelector('[popover]:popover-open'); if (!p) return null; const r = p.getBoundingClientRect(); const b = document.querySelector('button[aria-label^="Affects names"]').getBoundingClientRect(); return { text: p.textContent.slice(0, 30), inView: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, below: r.top >= b.bottom && r.top - b.bottom < 20, w: Math.round(r.width) }; })()`);
  check(tip && tip.text.startsWith('Affects names') && tip.inView && tip.below, `tooltip opens under its icon, inside the viewport (${JSON.stringify(tip)})`);
  await page.screenshot('tip.png');
  await page.key('Escape');
  check(await page.eval(`!document.querySelector('[popover]:popover-open')`), 'Escape closes the tooltip');

  // remembered settings
  await page.fill('input[type="number"]', 250);
  await page.goto('/');
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  check(await page.eval(`document.querySelector('input[type="number"]').value`) === '250' && await page.eval(`${trigger}.textContent`) === 'HR / Employees', 'reload restores rows and preset');

  // error toast instead of alert()
  const bad = join(page.downloads, 'bad.json'); writeFileSync(bad, '{not json');
  await page.upload('input[type="file"]', bad);
  await page.waitFor('document.querySelector("[role=alert]")');
  check((await page.eval('document.querySelector("[role=alert]").textContent')).includes('not a valid preset'), 'bad preset file shows an error toast');

  // a share link beats remembered settings; unknown columns and absurd row counts are dropped
  const hash = Buffer.from(JSON.stringify({ v: 1, p: 'India PII', c: ['aadhaar', 'pan', 'no_such_column'], r: 1e15, s: '7', sp: 500, f: 'csv', l: 'en_IN' })).toString('base64url');
  await page.goto('/#' + hash);
  await page.reload(); // a hash-only navigation does not reload the page
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  const st = await page.eval(`({ preset: ${trigger}.textContent, rows: document.querySelector('input[type="number"]').value, cols: document.querySelectorAll('thead th').length - 1 })`);
  check(st.preset === 'India PII' && st.rows === '100000000' && st.cols === 2, `share link wins and is sanitised (${JSON.stringify(st)})`);
};
