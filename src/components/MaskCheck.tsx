import React, { useEffect, useState } from 'react';
import { X, Upload, KeyRound, FileDown } from 'lucide-react';
import type { Manifest } from '../lib/manifest';
import { checkMasking, maskReportMarkdown, parseTable, reidentRisk, MaskReport, Row } from '../lib/maskcheck';
import { QUASI_IDS } from '../lib/generate';
import { Dropdown } from '../lib/ui';
import { regenerateInWorker } from '../lib/streaming';
import { downloadText } from '../lib/exporters';
import { Button, T } from '../lib/ui';
import { cn } from '../lib/utils';

// Rebuilding and comparing happens in memory; beyond this it would not fit comfortably in a tab.
const MAX_ROWS = 200_000;
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const flag = (n: number) => cn('px-3 py-1.5 font-mono text-xs', n > 0 ? 'text-red-700 font-semibold' : 'text-slate-500');

// Slide-out panel: give it a dataset's answer key and the same dataset after a masking tool
// has run over it. The originals are rebuilt from the key, so they are never uploaded anywhere.
export default function MaskCheck({ onClose }: { onClose: () => void }) {
  const [manifest, setManifest] = useState<{ m: Manifest; name: string } | null>(null);
  const [masked, setMasked] = useState<{ rows: Row[]; name: string } | null>(null);
  const [originals, setOriginals] = useState<Row[] | null>(null);
  const [includeContext, setIncludeContext] = useState(false);
  // Quasi-identifiers to measure k-anonymity over (null: the usual ones present in the dataset), and one sensitive column for l-diversity.
  const [quasi, setQuasi] = useState<string[] | null>(null);
  const [sensitive, setSensitive] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readFile = (e: React.ChangeEvent<HTMLInputElement>, then: (text: string, name: string) => void) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) file.text().then(text => { try { then(text, file.name); } catch (err: any) { setError(err?.message ?? 'Could not read that file.'); } });
  };
  const loadKey = (text: string, name: string) => {
    const m = JSON.parse(text) as Manifest;
    if (!Array.isArray(m?.columns) || typeof m.rowCount !== 'number' || !m.columns.every(c => c?.id && c?.expectation)) throw new Error('That is not a Pretendata answer key (version 2 or later).');
    if (m.seed === null) throw new Error('This dataset was generated without a seed, so its originals cannot be rebuilt. Generate with a seed and mask that.');
    if (m.rowCount > MAX_ROWS) throw new Error(`This check handles up to ${MAX_ROWS.toLocaleString()} rows; the dataset has ${m.rowCount.toLocaleString()}.`);
    setError(null); setOriginals(null); setManifest({ m, name });
  };
  const loadMasked = (text: string, name: string) => { setError(null); setMasked({ rows: parseTable(text), name }); };

  // Rebuild the originals once per answer key, off the main thread.
  useEffect(() => {
    if (!manifest) return;
    let stale = false;
    setBusy(true);
    regenerateInWorker(manifest.m)
      .then(rows => { if (!stale) setOriginals(rows); })
      .catch(e => { if (!stale) setError(e?.message ?? 'Could not rebuild the original data.'); })
      .finally(() => { if (!stale) setBusy(false); });
    return () => { stale = true; };
  }, [manifest]);

  const report: MaskReport | null = manifest && masked && originals ? checkMasking(manifest.m, originals, masked.rows, { includeContext }) : null;
  const tool = masked?.name.replace(/\.[^.]+$/, '') ?? '';
  const quasiIds = quasi ?? manifest?.m.columns.filter(c => QUASI_IDS.includes(c.id)).map(c => c.id) ?? [];
  const risk = report && originals && quasiIds.length > 0 ? reidentRisk(manifest!.m, originals, masked!.rows, quasiIds, sensitive || undefined) : null;
  const share = (x: number) => `${(x * 100).toFixed(1)}%`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="bg-white w-full max-w-3xl h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()} role="dialog" aria-label="Check masking">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <h2 className={T.h2}>Check masking</h2>
          <span className={cn(T.meta, 'ml-1')}>compared in your browser — nothing is uploaded</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto p-1.5 text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">
          <div className="space-y-2">
            <p className={T.body}>
              Generate a dataset <strong>with a seed</strong>, download its answer key, and run your masking, tokenisation or anonymisation
              tool over the data. Load the key and the masked file here: the originals are rebuilt from the key and compared with what
              came out. Keep the row order; CSV, JSON and NDJSON are read.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 cursor-pointer">
                <KeyRound size={16} /> {manifest ? manifest.name : '1. Answer key'}
                <input type="file" accept=".json" className="hidden" data-role="key" onChange={e => readFile(e, loadKey)} />
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg border border-indigo-600 bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 cursor-pointer">
                <Upload size={16} /> {masked ? masked.name : '2. Masked file'}
                <input type="file" accept=".csv,.json,.ndjson,.jsonl,.txt" className="hidden" data-role="masked" onChange={e => readFile(e, loadMasked)} />
              </label>
              {busy && <span className={T.meta}>Rebuilding the originals…</span>}
            </div>
            {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
          </div>

          {report && (
            <>
              <div data-stat="leaks" className={cn('rounded-lg border p-3', report.leaks ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50')}>
                <div className={cn('text-lg font-semibold', report.leaks ? 'text-red-800' : 'text-green-800')}>
                  {report.leaks ? `${report.leaks.toLocaleString()} original values survived` : 'No original value survived'}
                </div>
                <div className={T.meta}>
                  {report.maskedRows.toLocaleString()} masked rows against {report.originalRows.toLocaleString()} originals
                  {!report.aligned && ' — the row counts differ, so rows could not be compared in place; only the search for surviving values ran'}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                  <input type="checkbox" checked={includeContext} onChange={e => setIncludeContext(e.target.checked)} className="accent-indigo-600" />
                  Also check context columns (dates, cities, job titles…)
                </label>
                <Button className="ml-auto" aria-label="Export masking report"
                  onClick={() => downloadText(maskReportMarkdown(report, tool, risk ?? undefined), 'pretendata.masking-check.md', 'text/markdown')}>
                  <FileDown size={14} /> Markdown
                </Button>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      {[['Column', ''], ['Unchanged', 'Same row and column, identical to the original'], ['Elsewhere', 'Original values of this column found in another cell'],
                        ['Last four', 'Masked value still ends with the original\'s last four characters'], ['Inconsistent', 'The same original was given more than one masked value'],
                        ['Collisions', 'One masked value stands for several different originals'], ['Format', 'Share of masked values that still fit the column\'s pattern'],
                        ['Valid', 'Share of masked values that still pass the checksum or rules']].map(([h, tip]) => (
                        <th key={h} title={tip} className="px-3 py-2 font-medium border-b border-slate-200 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.columns.map(c => (
                      <tr key={c.id} data-column={c.id}>
                        <td className="px-3 py-1.5 text-slate-700">
                          {c.name}
                          {c.maskedHeader === null && <span className={cn(T.meta, 'block')}>not in the masked file</span>}
                        </td>
                        <td className={flag(c.unchanged)}>{c.maskedHeader === null ? '—' : `${c.unchanged} / ${c.rows}`}</td>
                        <td className={flag(c.leakedElsewhere)}>{c.leakedElsewhere}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{c.keptLastFour}</td>
                        <td className={flag(c.inconsistent)} title={c.repeatedOriginals ? `${c.repeatedOriginals} originals occur more than once` : 'No original occurs twice, so this could not be tested'}>
                          {c.repeatedOriginals ? c.inconsistent : 'n/a'}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{c.collisions}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{pct(c.formatKept)}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{pct(c.stillValid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-200 pt-4 space-y-3" data-role="risk">
                <div>
                  <span className={cn(T.label, 'block')}>Re-identification risk</span>
                  <span className={T.meta}>How many rows share each combination of quasi-identifiers, before and after. k is the size of the smallest group; a row that is alone in its group can be re-identified from these columns alone.</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {manifest!.m.columns.filter(c => c.expectation !== 'ignore' || QUASI_IDS.includes(c.id)).map(c => {
                    const on = quasiIds.includes(c.id);
                    return (
                      <button key={c.id} type="button" aria-pressed={on} data-quasi={c.id}
                        onClick={() => setQuasi(on ? quasiIds.filter(q => q !== c.id) : [...quasiIds, c.id])}
                        className={cn('text-xs px-2 py-1 rounded-md border', on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')}>
                        {c.name}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <span className={T.meta}>Sensitive column for l-diversity</span>
                  <Dropdown className="w-56" value={sensitive} onChange={setSensitive}
                    options={[{ value: '', label: 'None' }, ...manifest!.m.columns.filter(c => !quasiIds.includes(c.id)).map(c => ({ value: c.id, label: c.name }))]} />
                </div>
                {risk ? (
                  <table className="text-sm border border-slate-200 rounded-lg overflow-hidden w-full">
                    <thead className="bg-slate-50 text-slate-500 text-left"><tr>{['Measure', 'Original', 'After masking'].map(h => <th key={h} className="px-3 py-2 font-medium border-b border-slate-200">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {([
                        ['k (smallest group)', risk.before.k, risk.after.k],
                        ['Rows unique on these columns', `${risk.before.uniqueRows.toLocaleString()} (${share(risk.before.uniqueShare)})`, `${risk.after.uniqueRows.toLocaleString()} (${share(risk.after.uniqueShare)})`],
                        ['Rows in groups smaller than 5', risk.before.rowsUnder5.toLocaleString(), risk.after.rowsUnder5.toLocaleString()],
                        ...(risk.sensitive ? [
                          [`l for ${risk.sensitive.name}`, risk.sensitive.before.l, risk.sensitive.after ? risk.sensitive.after.l : 'column dropped'],
                          [`Rows whose group gives ${risk.sensitive.name} away`, risk.sensitive.before.rowsDisclosed.toLocaleString(), risk.sensitive.after ? risk.sensitive.after.rowsDisclosed.toLocaleString() : '—'],
                        ] : []),
                      ] as [string, React.ReactNode, React.ReactNode][]).map(([m, a, b]) => (
                        <tr key={m}><td className="px-3 py-1.5 text-slate-700">{m}</td><td className="px-3 py-1.5 font-mono text-xs text-slate-600" data-before>{a}</td><td className="px-3 py-1.5 font-mono text-xs text-slate-600" data-after>{b}</td></tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className={T.meta}>Pick at least one quasi-identifier.</p>}
                {risk && risk.quasi.some(q => q.maskedHeader === null) && (
                  <p className={T.meta}>Not in the masked file, so left out of "after": {risk.quasi.filter(q => q.maskedHeader === null).map(q => q.name).join(', ')}.</p>
                )}
              </div>

              <p className={T.meta}>
                Values are compared cell by cell, with and without separators; an original embedded inside longer text is not found.
                Consistency can only be judged where an original value occurs more than once.
                {report.extraHeaders.length > 0 && ` Columns in the masked file that are not in the answer key: ${report.extraHeaders.join(', ')}.`}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
