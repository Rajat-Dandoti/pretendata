import React, { useEffect, useMemo, useState } from 'react';
import { X, Upload, FileDown, KeyRound } from 'lucide-react';
import { EXPECTATION_LABELS } from '../data/schema';
import {
  parseResults, guessFields, guessLevel, distinctLabels, score, toMarkdown, keyFromCatalog, keyFromManifest,
  FieldMap, KeyColumn, Level, PairOutcome, Table, Verdict, PAIR_LABELS, VERDICT_LABELS,
} from '../lib/scorecard';
import { downloadText } from '../lib/exporters';
import { Button, Dropdown, T } from '../lib/ui';
import { cn } from '../lib/utils';

// The field and label choices for the last tool scored, so a re-run needs no setup.
const PROFILE_KEY = 'pretendata:tool-profile';
type Profile = { fields: FieldMap; levels: Record<string, Level> };
function loadProfile(): Profile | null {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null'); } catch { return null; }
}

const LEVELS: { value: Level; label: string }[] = [
  { value: 'detected', label: 'Detected' },
  { value: 'weak', label: 'Weak' },
  { value: 'none', label: 'Not flagged' },
];

const VERDICT_CHIP: Record<Verdict, string> = {
  'correct': 'bg-green-100 text-green-800 border-green-200',
  'generic': 'bg-amber-100 text-amber-800 border-amber-200',
  'soft-flag': 'bg-amber-100 text-amber-800 border-amber-200',
  'missed': 'bg-red-100 text-red-800 border-red-200',
  'false-positive': 'bg-red-100 text-red-800 border-red-200',
  'context': 'bg-slate-100 text-slate-600 border-slate-200',
};
const PROBLEMS: Verdict[] = ['generic', 'soft-flag', 'missed', 'false-positive'];

function Stat({ id, title, main, rest }: { id: string; title: string; main: string; rest: string }) {
  return (
    <div data-stat={id} className="flex-1 min-w-40 border border-slate-200 rounded-lg p-3">
      <div className={T.micro}>{title}</div>
      <div className="text-lg font-semibold text-slate-800 mt-0.5">{main}</div>
      <div className={T.meta}>{rest}</div>
    </div>
  );
}

// Slide-out panel: load a detection tool's results, say how its labels map to "detected",
// and see where it was right. Everything is read and scored in the browser.
export default function Scorecard({ onClose }: { onClose: () => void }) {
  const [table, setTable] = useState<Table | null>(null);
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<{ columns: KeyColumn[]; name: string } | null>(null);
  const [fields, setFields] = useState<FieldMap | null>(null);
  const [levels, setLevels] = useState<Record<string, Level>>({});
  const [problemsOnly, setProblemsOnly] = useState(false);
  const columns = useMemo(() => key?.columns ?? keyFromCatalog(), [key]);

  const load = (text: string, name: string) => {
    try {
      const t = parseResults(text);
      const saved = loadProfile();
      // Reuse the saved field choices when this file has those fields; otherwise guess.
      const f = saved && [saved.fields.name, saved.fields.label].every(x => t.fields.includes(x))
        ? { ...saved.fields, score: saved.fields.score && t.fields.includes(saved.fields.score) ? saved.fields.score : null }
        : guessFields(t, columns);
      if (!f) throw new Error('None of the names in this file match a Pretendata column. Check that it lists one result per column.');
      setTable(t); setFields(f); setSource(name); setError(null);
      setLevels(Object.fromEntries(distinctLabels(t, f).map(l => [l.label, saved?.levels[l.label] ?? guessLevel(l.label)])));
    } catch (e: any) {
      setTable(null); setFields(null); setError(e?.message ?? 'Could not read that file.');
    }
  };
  const readFile = (e: React.ChangeEvent<HTMLInputElement>, then: (text: string, name: string) => void) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) file.text().then(text => then(text, file.name));
  };
  const loadKey = (text: string, name: string) => {
    try {
      const m = JSON.parse(text);
      if (!Array.isArray(m?.columns) || !m.columns.every((c: any) => c?.id && c?.expectation)) throw new Error();
      setKey({ columns: keyFromManifest(m), name }); setError(null);
    } catch {
      setError('That is not a Pretendata answer key (version 2 or later).');
    }
  };

  // A label field change brings a new set of labels; keep any level already chosen.
  const labels = useMemo(() => (table && fields ? distinctLabels(table, fields) : []), [table, fields]);
  const levelOf = (label: string) => levels[label] ?? guessLevel(label);
  useEffect(() => {
    if (!fields) return;
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ fields, levels } satisfies Profile)); } catch { /* storage blocked */ }
  }, [fields, levels]);

  const card = useMemo(
    () => (table && fields ? score(table, fields, Object.fromEntries(labels.map(l => [l.label, levelOf(l.label)])), columns) : null),
    [table, fields, labels, levels, columns],
  );
  const pairs = (o: PairOutcome) => card?.pairs.filter(p => p.outcome === o).length ?? 0;
  const shown = card?.columns.filter(c => !problemsOnly || PROBLEMS.includes(c.verdict)) ?? [];
  const fieldOptions = table?.fields.map(f => ({ value: f, label: f })) ?? [];
  const tool = source.replace(/\.[^.]+$/, '');

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="bg-white w-full max-w-3xl h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()} role="dialog" aria-label="Score a tool">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <h2 className={T.h2}>Score a tool</h2>
          <span className={cn(T.meta, 'ml-1')}>read and scored in your browser — nothing is uploaded</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto p-1.5 text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">
          <div className="space-y-2">
            <p className={T.body}>
              Run your detection tool on a Pretendata dataset, export its result for each column as JSON or CSV, and load it here.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg border border-indigo-600 bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 cursor-pointer">
                <Upload size={16} /> {table ? 'Load other results' : 'Load results'}
                <input type="file" accept=".json,.csv,.txt" className="hidden" data-role="results" onChange={e => readFile(e, load)} />
              </label>
              <label title="Score against the answer key of the exact dataset the tool scanned. Needed when headers were changed; otherwise columns are matched by name."
                className="inline-flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 cursor-pointer">
                <KeyRound size={16} /> {key ? key.name : 'Answer key (optional)'}
                <input type="file" accept=".json" className="hidden" data-role="key" onChange={e => readFile(e, loadKey)} />
              </label>
              {source && <span className={T.meta}>{source} · {table?.rows.length} results</span>}
            </div>
            {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
          </div>

          {table && fields && card && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {([['name', 'Column name field'], ['label', 'Label field']] as const).map(([k, title]) => (
                  <div key={k} className="space-y-1">
                    <span className={cn(T.meta, 'block')}>{title}</span>
                    <Dropdown value={fields[k]} options={fieldOptions} onChange={v => setFields({ ...fields, [k]: v })} />
                  </div>
                ))}
                <div className="space-y-1">
                  <span className={cn(T.meta, 'block')}>Score field (optional)</span>
                  <Dropdown value={fields.score ?? ''} options={[{ value: '', label: 'None' }, ...fieldOptions]} onChange={v => setFields({ ...fields, score: v || null })} />
                </div>
              </div>

              <div className="space-y-2">
                <div>
                  <span className={cn(T.label, 'block')}>What each label means</span>
                  <span className={T.meta}>"Weak" is a hedged or generic flag, such as "possible" or "unique identifier". These start as guesses from the label's wording — correct them for your tool.</span>
                </div>
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {labels.map(({ label, count }) => (
                    <div key={label} data-label={label} className="flex items-center gap-3 px-3 py-1.5">
                      <span className="font-mono text-xs text-slate-700 truncate">{label || '(empty)'}</span>
                      <span className={T.meta}>{count}</span>
                      <div className="ml-auto flex shrink-0 rounded-md border border-slate-200 overflow-hidden" role="radiogroup" aria-label={`Meaning of ${label}`}>
                        {LEVELS.map(l => (
                          <button key={l.value} type="button" role="radio" aria-checked={levelOf(label) === l.value}
                            onClick={() => setLevels({ ...levels, [label]: l.value })}
                            className={cn('text-xs px-2.5 py-1', levelOf(label) === l.value ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>
                            {l.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Stat id="detect" title="Should fire" main={`${card.detect.correct} of ${card.detect.total} correct`}
                  rest={`${card.detect.generic} flagged generically · ${card.detect.missed} missed`} />
                <Stat id="ignore" title="Should not fire" main={`${card.ignore.correct} of ${card.ignore.total} quiet`}
                  rest={`${card.ignore.soft} soft flags · ${card.ignore.falsePositive} false positives`} />
                <Stat id="pairs" title="Near-miss pairs" main={`${pairs('told-apart')} of ${card.pairs.length} told apart`}
                  rest={`${pairs('not-told-apart')} not told apart · ${pairs('inverted')} inverted`} />
              </div>
              {(card.unmatched.length > 0 || (key && card.missing.length > 0)) && (
                <p className={T.meta}>
                  {card.unmatched.length > 0 && <>Names that match no column: {card.unmatched.join(', ')}. </>}
                  {key && card.missing.length > 0 && <>In the answer key but not in the results: {card.missing.join(', ')}.</>}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                  <input type="checkbox" checked={problemsOnly} onChange={e => setProblemsOnly(e.target.checked)} className="accent-indigo-600" />
                  Problems only
                </label>
                <span className={T.meta}>{shown.length} of {card.columns.length} columns</span>
                <div className="ml-auto flex gap-2">
                  <Button aria-label="Export scorecard as Markdown"
                    onClick={() => downloadText(toMarkdown(card, { tool, scoredAgainstKey: !!key }), 'pretendata.scorecard.md', 'text/markdown')}>
                    <FileDown size={14} /> Markdown
                  </Button>
                  <Button aria-label="Export scorecard as JSON"
                    onClick={() => downloadText(JSON.stringify({ tool, fields, levels, ...card }, null, 2), 'pretendata.scorecard.json', 'application/json')}>
                    <FileDown size={14} /> JSON
                  </Button>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      {['Column', 'Expected', 'Tool said', 'Verdict'].map(h => <th key={h} className="px-3 py-2 font-medium border-b border-slate-200">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.map(c => {
                      const pair = card.pairs.find(p => p.id === c.id);
                      return (
                        <tr key={c.id} data-column={c.id}>
                          <td className="px-3 py-1.5 text-slate-700">{c.name}</td>
                          <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{EXPECTATION_LABELS[c.expectation]}</td>
                          <td className="px-3 py-1.5">
                            <span className="font-mono text-xs text-slate-700">{c.label}</span>
                            <span className={cn(T.meta, 'block')}>{[c.detail, c.score].filter(x => x !== '' && x !== null).join(' · ')}</span>
                          </td>
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            <span className={cn('text-[11px] font-medium px-1.5 py-0.5 rounded border', VERDICT_CHIP[c.verdict])}>{VERDICT_LABELS[c.verdict]}</span>
                            {pair && <span className={cn(T.meta, 'block mt-0.5')}>{PAIR_LABELS[pair.outcome]}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
