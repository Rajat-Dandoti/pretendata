// R2: the single-file build, opened straight from disk — no server, no second file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
export default async (page, check) => {
  await page.gotoUrl(pathToFileURL(join(page.repo, 'dist-offline', 'pretendata.html')).href);
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  check(await page.eval('location.protocol') === 'file:', 'running from a file:// URL');
  // generation runs in the embedded worker
  await page.click('button[aria-label="Preview rows"]');
  await page.waitFor('document.querySelector("h2.text-lg")?.textContent.includes("Generated Data")', 30000);
  check(await page.eval('document.querySelectorAll("tbody tr").length') === 100, 'the embedded worker generated 100 rows');
  const csv = await page.download(() => page.click('button[aria-label="Download"]'));
  check(readFileSync(csv.path, 'utf8').split('\n').length === 102, 'CSV download works from the file');
  // the tools work too
  await page.click('button[aria-label="More kinds of data"]');
  await page.waitFor('document.querySelectorAll(\'[data-role="docs"] > div\').length === 4');
  const docs = await page.download(() => page.click('button[aria-label="Download documents"]'));
  check(readFileSync(docs.path, 'utf8').trim().split('\n').length === 1000, 'text documents generate in the embedded worker');
};
