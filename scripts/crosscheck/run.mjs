// Runs the cross-check: `npm run crosscheck`. Needs Python 3 on the PATH.
// Builds a virtual environment beside this file, generates values with the command-line tool,
// has independent libraries judge them, and writes VALIDATION.md. Exits non-zero on any
// disagreement that is not documented in crosscheck.py.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const venv = join(here, '.venv');
const python = join(venv, 'bin', 'python');
// Pinned, so a change in the table is a change in Pretendata, not in a witness.
const WITNESSES = ['python-stdnum==2.2', 'schwifty==2026.7.3'];

if (!existsSync(python)) execFileSync('python3', ['-m', 'venv', venv], { stdio: 'inherit' });
execFileSync(python, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', ...WITNESSES], { stdio: 'inherit' });

const columns = [
  'ssn', 'usItin', 'routingNumber', 'aadhaar', 'pan', 'gstin', 'voterId', 'creditCard', 'iban', 'nhsNumber', 'imei', 'ean13', 'isin',
  'canadaSin', 'brazilCpf', 'brazilCnpj', 'spainDni', 'spainNie', 'netherlandsBsn', 'franceNir', 'australiaTfn', 'chinaResidentId', 'southAfricaId',
  'ssn_invalid', 'routingNumber_invalid', 'aadhaar_invalid', 'aadhaar_prefix', 'gstin_invalid', 'voterId_invalid', 'creditCard_invalid', 'creditCard_transposed',
  'iban_invalid', 'nhsNumber_invalid', 'imei_invalid', 'ean13_invalid', 'isin_invalid', 'canadaSin_invalid', 'brazilCpf_invalid', 'spainDni_invalid',
  'netherlandsBsn_invalid', 'franceNir_invalid', 'australiaTfn_invalid', 'chinaResidentId_invalid', 'southAfricaId_invalid',
];
const data = join(mkdtempSync(join(tmpdir(), 'pretendata-crosscheck-')), 'rows.json');
execFileSync('npx', ['tsx', join(repo, 'bin', 'pretendata.ts'), '--columns', columns.join(','), '--rows', '5000', '--seed', '77', '--format', 'json', '--out', data], { stdio: 'inherit' });

let report, ok = true;
try {
  report = execFileSync(python, [join(here, 'crosscheck.py'), data], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
} catch (e) {
  report = e.stdout; ok = false; // still write the table, so the disagreement can be read
}
writeFileSync(join(repo, 'VALIDATION.md'), report);
console.log(ok ? 'crosscheck: every value agrees or is documented — wrote VALIDATION.md' : 'crosscheck: FAILED — see VALIDATION.md');
process.exit(ok ? 0 : 1);
