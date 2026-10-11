// M3: related tables downloaded from the panel form a consistent database.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const pick = async (page, current, option) => { await page.click('[role="dialog"] [role=combobox]', current); await page.click('[role=option]', option); };
export default async (page, check) => {
  await page.goto('/');
  await page.waitFor('document.querySelectorAll("tbody tr").length === 5');
  await page.click('button[aria-label="More kinds of data"]');
  await pick(page, 'Retail', 'Hospital');
  await page.fill('#people-count', 300);
  const zip = await page.download(() => page.click('button[aria-label="Download related tables"]'));
  check(zip.name === 'pretendata-hospital.zip', `downloaded ${zip.name}`);
  const dir = join(page.out, 'tables'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);
  execFileSync('unzip', ['-q', '-o', zip.path, '-d', dir]);
  const root = join(dir, 'pretendata-hospital');
  const csv = name => readFileSync(join(root, name), 'utf8').replace(/^﻿/, '').trim().split('\n').map(l => l.split(','));
  const patients = csv('patients.csv'), visits = csv('visits.csv');
  const ids = new Set(patients.slice(1).map(r => r[0]));
  check(patients.length === 301 && visits[0].slice(0, 3).join() === 'visit_id,patient_id,mrn' && visits.slice(1).every(r => ids.has(r[1])), `${patients.length - 1} patients; every one of ${visits.length - 1} visits points at a patient`);
  const mrnOf = new Map(patients.slice(1).map(r => [r[0], r[patients[0].indexOf('mrn')]]));
  check(visits.slice(1).every(r => r[2] === mrnOf.get(r[1])), 'the MRN copied onto each visit is the patient\'s own');
  const index = JSON.parse(readFileSync(join(root, 'subject-index.json'), 'utf8'));
  const total = ['patients.csv', 'visits.csv', 'prescriptions.csv'].reduce((n, f) => n + readFileSync(join(root, f), 'utf8').trim().split('\n').length - 1, 0);
  check(index.length === 300 && index.reduce((n, s) => n + s.locations.length, 0) >= total - 5, 'the subject index accounts for the rows in all three tables');
  const sql = readFileSync(join(root, 'schema.sql'), 'utf8');
  check(sql.includes('patient_id TEXT NOT NULL REFERENCES patients(patient_id)') && JSON.parse(readFileSync(join(root, 'answer-key.json'), 'utf8')).tables.length === 3, 'schema.sql declares the foreign keys; the answer key describes three tables');
};
