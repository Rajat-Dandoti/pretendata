// T1 + T2: the text panel — preview with highlighted entities, download, offsets.
import { readFileSync } from 'node:fs';
const pick = async (page, current, option) => { await page.click('[role="dialog"] [role=combobox]', current); await page.click('[role=option]', option); };
export default async (page, check) => {
  await page.goto('/');
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  await page.click('button[aria-label="More kinds of data"]');
  await page.waitFor('document.querySelectorAll(\'[data-role="docs"] > div\').length === 4');
  check(await page.eval(`document.querySelectorAll('[data-role="docs"] mark').length`) >= 4, 'preview highlights the embedded values');

  await pick(page, 'Mixed', 'AI prompts');
  await page.fill('#doc-count', 250);
  await page.screenshot('text.png');
  const file = await page.download(() => page.click('button[aria-label="Download documents"]'));
  const lines = readFileSync(file.path, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  check(file.name === 'pretendata.prompt.ndjson' && lines.length === 250, `downloaded ${lines.length} prompts as ${file.name}`);
  const exact = lines.every(d => d.messages[0].role === 'user' && d.entities.length > 0 && d.entities.every(e => [...d.messages[0].content].slice(e.start, e.end).join('') === e.value));
  check(exact, 'every entity offset points at its value in the message content');
  check(lines.some(d => d.entities.some(e => e.type === 'awsSecretKey')) && lines.some(d => d.messages[0].content.includes('Ignore all previous instructions')), 'prompts include pasted secrets and an injection attempt');
  // the preview is the head of the download (seed 42)
  const first = await page.eval(`document.querySelector('[data-role="docs"] p').textContent`);
  check(first === lines[0].messages[0].content, 'preview shows the first document of the download');

  await pick(page, 'AI prompts', 'Clinical notes');
  const clinical = await page.download(() => page.click('button[aria-label="Download documents"]'));
  const c = readFileSync(clinical.path, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  check(c.length === 250 && c.every(d => d.pack === 'clinical' && typeof d.text === 'string' && d.entities.every(e => [...d.text].slice(e.start, e.end).join('') === e.value)), 'clinical notes: plain documents with exact offsets');
};
