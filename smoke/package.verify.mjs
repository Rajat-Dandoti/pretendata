// The npm package as a user gets it: pack it, install the tarball into an empty project, and
// run the installed command. Two bugs only show up here and both shipped-in-waiting once:
// the command doing nothing behind npm's symlink, and a clean install resolving a different
// Faker version and so different data.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..');
const out = join(import.meta.dirname, '.out', 'package');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'project'), { recursive: true });
let failed = false;
const check = (ok, label) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}`); if (!ok) failed = true; };

execFileSync('npm', ['pack', '--silent', '--pack-destination', out], { cwd: repo, stdio: ['ignore', 'ignore', 'inherit'] });
const tarball = readdirSync(out).find(f => f.endsWith('.tgz'));
writeFileSync(join(out, 'project', 'package.json'), '{ "name": "try", "private": true }');
execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund', join(out, tarball)], { cwd: join(out, 'project'), stdio: ['ignore', 'ignore', 'inherit'] });

const installed = readdirSync(join(out, 'project', 'node_modules')).filter(n => !n.startsWith('.'));
check(installed.join() === 'pretendata', `the package installs with no dependencies (${installed.join(', ')})`);

const bin = join(out, 'project', 'node_modules', '.bin', 'pretendata');
const run = (...args) => spawnSync(bin, args, { encoding: 'buffer', maxBuffer: 1 << 28 });
const pinned = /id: 'india'[\s\S]*?sha256: '([0-9a-f]{64})'/.exec(readFileSync(join(repo, 'src', 'data', 'benchmarks.ts'), 'utf8'))[1];
const made = createHash('sha256').update(run('benchmark', 'india').stdout).digest('hex');
check(made === pinned, `the installed command writes the pinned India benchmark (${made.slice(0, 12)}…)`);
check(run('--columns', 'ssn', '--rows', '3', '--seed', '1', '--no-bom').stdout.toString().split('\n').length === 5, 'it generates rows on request');
check(run('--bogus').status === 2, 'a bad flag exits with code 2');
check(run('--help').stdout.toString().startsWith('pretendata —'), '--help prints usage');

console.log(failed ? 'PACKAGE CHECK FAILED' : 'PACKAGE CHECK PASSED');
process.exit(failed ? 1 : 0);
