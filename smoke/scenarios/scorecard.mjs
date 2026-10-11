// L4: load a tool's results, check the guesses and numbers, remap a label, export, reload.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// A made-up tool's output: stray whitespace, mixed case, one column it invented.
const RESULTS = [
  ['Aadhaar (IN)\n', 'PII', 'Aadhaar Number', 100],
  ['aadhaar (near-miss)', 'POTENTIAL_PII', 'Potential PII', 90],
  ['IBAN', 'QUASI_IDENTIFIER', 'Quasi Text', 60],
  ['IBAN (near-miss)', 'QUASI_IDENTIFIER', 'Quasi Text', 60],
  ['VIN (Vehicle)', 'PSEUDONYMIZED_PII', 'Pseudonymized PII', 50],
  ['VIN (near-miss)', 'UNIQUE_IDENTIFIER', 'ID Text', 80],
  ['GSTIN (IN)', 'UNIQUE_IDENTIFIER', 'Gst No', 80],
  ['GSTIN (near-miss)', 'UNIQUE_IDENTIFIER', 'ID Text', 80],
  ['Email Address', 'PII', 'Email', 100],
  ['SSN', 'STATISTICAL', 'Statistical Text', 20],
  ['Salary', 'STATISTICAL_SENSITIVE', 'Salary', 30],
  ['Created At', 'TIME', 'Added Time', 30],
  ['SQL Injection', 'STATISTICAL', 'Statistical Text', 20],
  ['Gender', 'QUASI_IDENTIFIER', 'Gender', 60],
  ['Mystery Column', 'PII', 'Name', 100],
].map(([n, t, s, r]) => ({ Attribute_Name: n, Attribute_Type: t, Attribute_SubType: s, Risk_Level: r, Confidence: null }));
const stat = id => `document.querySelector('[data-stat="${id}"]')?.textContent`;
export default async (page, check) => {
  const results = join(page.downloads, 'example-tool.json'); writeFileSync(results, JSON.stringify(RESULTS));
  await page.goto('/');
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  await page.click('button[aria-label="Score a tool"]');
  await page.waitFor('document.querySelector(\'[role="dialog"][aria-label="Score a tool"]\')');

  // a file that is not results
  const bad = join(page.downloads, 'bad.csv'); writeFileSync(bad, 'foo,bar\n1,2\n');
  await page.upload('input[data-role="results"]', bad);
  await page.waitFor('document.querySelector(\'[role="dialog"] [role="alert"]\')');
  check((await page.eval('document.querySelector(\'[role="dialog"] [role="alert"]\').textContent')).includes('match a Pretendata column'), 'unrelated file is rejected with a reason');

  await page.upload('input[data-role="results"]', results);
  await page.waitFor(stat('pairs'));
  const combos = await page.eval(`[...document.querySelectorAll('[role="dialog"] [role=combobox]')].map(b => b.textContent)`);
  check(combos.join() === 'Attribute_Name,Attribute_Type,Risk_Level', `fields guessed: ${combos.join(', ')}`);
  check(await page.eval(`document.querySelectorAll('[data-label]').length`) === 8, '8 distinct labels listed');
  check((await page.eval(stat('pairs'))).includes('2 of 4 told apart') && (await page.eval(stat('pairs'))).includes('1 not told apart · 1 inverted'), `near-miss pairs: ${await page.eval(stat('pairs'))}`);
  check((await page.eval(stat('detect'))).includes('2 of 6 correct'), `should fire: ${await page.eval(stat('detect'))}`);
  const fpBefore = await page.eval(stat('ignore'));
  check(fpBefore.includes('1 false positives'), `should not fire: ${fpBefore}`);

  // remap one label: the tool's "statistical sensitive" is not a detection
  await page.click('[data-label="STATISTICAL_SENSITIVE"] [role=radio]', 'Not flagged');
  check((await page.eval(stat('ignore'))).includes('0 false positives'), `after remapping STATISTICAL_SENSITIVE: ${await page.eval(stat('ignore'))}`);
  check(await page.eval(`document.querySelector('[data-column="vin_invalid"]').textContent.includes('Inverted')`), 'VIN near-miss row says Inverted');

  await page.click('[role="dialog"] input[type=checkbox]');
  const shown = await page.eval(`document.querySelectorAll('[role="dialog"] tbody tr').length`);
  check(shown > 0 && shown < 14, `problems-only filter (${shown} rows)`);
  await page.screenshot('scorecard.png');

  const md = await page.download(() => page.click('button[aria-label="Export scorecard as Markdown"]'));
  const text = readFileSync(md.path, 'utf8');
  check(md.name === 'pretendata.scorecard.md' && text.startsWith('# Scorecard: example-tool') && text.includes('| VIN (near-miss) | VIN (Vehicle) | Inverted |') && text.includes('Names in the results that match no column: Mystery Column.'), 'Markdown export has the summary, pairs and all columns');
  const js = await page.download(() => page.click('button[aria-label="Export scorecard as JSON"]'));
  const j = JSON.parse(readFileSync(js.path, 'utf8'));
  check(j.columns.length === 14 && j.levels.STATISTICAL_SENSITIVE === 'none' && j.fields.label === 'Attribute_Type', 'JSON export carries columns and the tool profile');

  // the remapped label is remembered for the next run
  await page.reload();
  await page.click('button[aria-label="Score a tool"]');
  await page.upload('input[data-role="results"]', results);
  await page.waitFor(stat('ignore'));
  check((await page.eval(stat('ignore'))).includes('0 false positives'), 'label mapping remembered after reload');

  // score against an answer key: only its columns count, absent ones are listed
  const key = join(page.downloads, 'key.json');
  writeFileSync(key, JSON.stringify({ version: 2, columns: [
    { id: 'aadhaar', name: 'Aadhaar (IN)', header: 'Aadhaar (IN)', expectation: 'detect' },
    { id: 'aadhaar_invalid', name: 'Aadhaar (near-miss)', header: 'Aadhaar (near-miss)', expectation: 'ignore', nearMissOf: 'aadhaar' },
    { id: 'future', name: 'Future Column', header: 'col_03', expectation: 'detect' } ] }));
  await page.upload('input[data-role="key"]', key);
  await page.waitFor(`${stat('detect')}.includes('of 1 correct')`);
  check((await page.eval(stat('pairs'))).includes('1 of 1 told apart') && await page.eval(`document.querySelector('[role="dialog"]').textContent.includes('In the answer key but not in the results: Future Column')`), 'answer key narrows the scoring and lists what is absent');
  await page.key('Escape');
};
