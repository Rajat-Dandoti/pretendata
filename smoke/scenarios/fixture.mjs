// T3: the secrets fixture zip is a real archive whose answer key matches its files.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
export default async (page, check) => {
  await page.goto('/');
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  await page.click('button[aria-label="More kinds of data"]');
  const zip = await page.download(() => page.click('button[aria-label="Download secrets fixture"]'));
  check(zip.name === 'pretendata-secrets-fixture.zip', `downloaded ${zip.name}`);
  const dir = join(page.out, 'fixture'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);
  execFileSync('unzip', ['-q', '-o', zip.path, '-d', dir]); // throws if the archive is malformed
  const root = join(dir, 'pretendata-secrets-fixture');
  const key = JSON.parse(readFileSync(join(root, 'answer-key.json'), 'utf8')).planted;
  const onLine = p => readFileSync(join(root, p.file), 'utf8').split('\n')[p.line - 1]?.includes(p.value.split('\n')[0]);
  check(key.length === 3 * (19 + 8) && key.every(onLine), `${key.length} planted values, each on the file and line the answer key gives`);
  const env = readFileSync(join(root, 'services/svc-01/.env'), 'utf8');
  check(/^AWS_ACCESS_KEY_ID=AKIA[A-Z2-7]{16}$/m.test(env) && env.includes('GITHUB_TOKEN=${GITHUB_TOKEN}'), '.env has a real-shaped AWS key and a variable-reference decoy');
  check(readFileSync(join(root, 'services/svc-02/deploy/id_rsa.pem'), 'utf8').startsWith('-----BEGIN RSA PRIVATE KEY-----'), 'PEM file present');
};
