// A fake source repository with secrets planted in it, for testing secret scanners
// (Gitleaks, TruffleHog, GitHub secret scanning, pre-commit hooks). Alongside each real-shaped
// secret sit decoys — placeholders, variable references, a vendor's documented example key —
// that a good scanner leaves alone. The answer key gives file and line for both.
import { AVAILABLE_COLUMNS, Expectation } from '../data/schema';
import { makeRow } from './generate';
import { applySeed } from './seed';
import { makeZip, ZipEntry } from './zip';

export interface Planted {
  file: string;
  /** 1-based line where the value starts. */
  line: number;
  /** Column id for a secret; "decoy" for something that only looks like one. */
  type: string;
  value: string;
  expectation: Expectation;
}

// `{{columnId}}` plants that column's value. `[[text]]` plants a decoy: the text itself, recorded
// as something that must not fire.
const BANNER = 'Pretendata fixture. Every secret in this file is fake and randomly generated.';
const FILES: Record<string, string> = {
  '.env': `# ${BANNER}
AWS_ACCESS_KEY_ID={{awsAccessKey}}
AWS_SECRET_ACCESS_KEY={{awsSecretKey}}
STRIPE_SECRET_KEY={{stripeKey}}
DATABASE_URL={{basicAuthUrl}}/app
GITHUB_TOKEN=[[\${GITHUB_TOKEN}]]
SENDGRID_API_KEY=[[your-api-key-here]]
SESSION_SECRET=[[changeme]]
`,
  'config/settings.yaml': `# ${BANNER}
github:
  token: {{githubPAT}}
google:
  maps_api_key: {{googleApiKey}}
smtp:
  password: "[[<REDACTED>]]"
analytics:
  write_key: [[xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx]]
`,
  'src/client.js': `// ${BANNER}
const fetch = require('node-fetch');

// The documented example from the AWS docs, not a real key: [[AKIAIOSFODNN7EXAMPLE]]
const apiKey = [[process.env.API_KEY]];
const token = '{{jwt}}';

module.exports = (path) => fetch('https://api.example.com' + path, {
  headers: { Authorization: 'Bearer ' + token, 'x-api-key': apiKey },
});
`,
  'deploy/id_rsa.pem': `{{privateKeyPem}}
`,
  'db/seed.sql': `-- ${BANNER}
INSERT INTO users (email, password_hash) VALUES
  ('admin@example.com', '{{bcryptHash}}'),
  ('guest@example.com', '[[!]]');
`,
  'README.md': `# Secrets fixture

${BANNER}

Point a secret scanner at this directory and compare what it reports with \`answer-key.json\`:
entries with expectation \`detect\` are real-shaped secrets it should report, entries with
expectation \`ignore\` are decoys it should leave alone.
`,
};

const SLOT = /\{\{(\w+)\}\}|\[\[([\s\S]*?)\]\]/g;
const SECRET_COLS = AVAILABLE_COLUMNS.filter(c => c.category === 'Secrets');

function plant(file: string, template: string, values: Record<string, unknown>): { text: string; planted: Planted[] } {
  let text = '', last = 0;
  const planted: Planted[] = [];
  for (const m of template.matchAll(SLOT)) {
    text += template.slice(last, m.index);
    const value = m[1] ? String(values[m[1]]) : m[2];
    planted.push({ file, line: text.split('\n').length, type: m[1] ?? 'decoy', value, expectation: m[1] ? 'detect' : 'ignore' });
    text += value;
    last = m.index + m[0].length;
  }
  return { text: text + template.slice(last), planted };
}

export interface SecretsRepo {
  files: ZipEntry[];
  key: Planted[];
}

/**
 * Build the fixture: `services` copies of the file set under services/svc-NN/, each with its
 * own secrets, plus one answer key at the root.
 */
export function buildSecretsRepo(o: { seed?: number | null; services?: number } = {}): SecretsRepo {
  applySeed(o.seed ?? null);
  const services = Math.min(50, Math.max(1, Math.floor(o.services ?? 3)));
  const files: ZipEntry[] = [], key: Planted[] = [];
  for (let s = 1; s <= services; s++) {
    const values = makeRow(SECRET_COLS);
    for (const [name, template] of Object.entries(FILES)) {
      const path = `services/svc-${String(s).padStart(2, '0')}/${name}`;
      const { text, planted } = plant(path, template, values);
      files.push({ name: path, data: text });
      key.push(...planted);
    }
  }
  files.push({ name: 'answer-key.json', data: JSON.stringify({ toolName: 'pretendata', kind: 'secrets-fixture', planted: key }, null, 2) + '\n' });
  return { files, key };
}

const ROOT = 'pretendata-secrets-fixture';
export const SECRETS_ZIP_NAME = `${ROOT}.zip`;
export function secretsRepoZip(repo: SecretsRepo): Blob {
  return makeZip(repo.files.map(f => ({ ...f, name: `${ROOT}/${f.name}` })));
}

// ---------- self-check (run via `npm test`) ----------
export function _selfCheck() {
  const repo = buildSecretsRepo({ seed: 6, services: 2 });
  const text = new Map(repo.files.map(f => [f.name, f.data as string]));
  for (const p of repo.key) {
    const lines = text.get(p.file)!.split('\n');
    const first = p.value.split('\n')[0];
    if (!lines[p.line - 1]?.includes(first)) throw new Error(`FAIL: ${p.type} is not on ${p.file}:${p.line}`);
    if ((p.type === 'decoy') !== (p.expectation === 'ignore')) throw new Error('FAIL: decoys are ignore, secrets are detect');
  }
  // every secret type is planted in every service, and nothing is left unfilled
  for (const c of SECRET_COLS) {
    if (repo.key.filter(p => p.type === c.id).length !== 2) throw new Error(`FAIL: ${c.id} should be planted once per service`);
  }
  if ([...text.values()].some(t => /\{\{\w+\}\}|\[\[|\]\]/.test(t))) throw new Error('FAIL: unfilled slot in a fixture file');
  if (repo.key.filter(p => p.type === 'decoy').length !== 2 * 8) throw new Error('FAIL: decoy count');
  // services differ from each other; the same seed gives the same repo
  const aws = repo.key.filter(p => p.type === 'awsAccessKey').map(p => p.value);
  if (aws[0] === aws[1]) throw new Error('FAIL: services should not share secrets');
  if (JSON.stringify(buildSecretsRepo({ seed: 6, services: 2 }).files) !== JSON.stringify(repo.files)) throw new Error('FAIL: fixture seed determinism');
  if (!JSON.parse(text.get('answer-key.json')!).planted.length) throw new Error('FAIL: answer key file');
  console.log('fixtures: all self-checks passed');
}
