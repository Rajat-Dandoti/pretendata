import { useMemo, useState } from 'react';
import { X, RefreshCw, Search, ChevronRight } from 'lucide-react';
import { AVAILABLE_COLUMNS, CATEGORY_COLORS, PrivacyCategory, EXPECTATION_LABELS, expectationFor } from '../data/schema';
import { describeValidation, sampleValues, patternFor } from '../lib/reference';
import { identify, MatchStatus } from '../lib/identify';
import { frameworksFor, valueTier, FrameworkId, FRAMEWORKS } from '../lib/frameworks';
import { Chip, T, TIER_CHIP } from '../lib/ui';
import { LocaleId } from '../lib/locale';
import { cn } from '../lib/utils';

const MATCH_LABEL: Record<MatchStatus, string> = { valid: 'Valid', invalid: 'Fails check', shape: 'Shape only' };
const MATCH_CHIP: Record<MatchStatus, string> = {
  valid: 'bg-green-100 text-green-800 border-green-200',
  invalid: 'bg-red-100 text-red-800 border-red-200',
  shape: 'bg-slate-100 text-slate-600 border-slate-200',
};

// Slide-out reference for every column: a live example + its pattern/algorithm, region,
// category and framework tags. All derived from the schema — single source of truth.
export default function ColumnReference({ onClose, locale }: { onClose: () => void; locale: LocaleId }) {
  const [query, setQuery] = useState('');
  const [nonce, setNonce] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [probe, setProbe] = useState('');
  const matches = useMemo(() => identify(probe), [probe]);
  const samples = useMemo(() => sampleValues(locale), [locale, nonce]);
  const toggle = (cat: string) => setCollapsed(prev => {
    const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n;
  });

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const byCat = new Map<PrivacyCategory, typeof AVAILABLE_COLUMNS>();
    for (const col of AVAILABLE_COLUMNS) {
      if (q && !col.name.toLowerCase().includes(q) && !col.id.toLowerCase().includes(q)) continue;
      const arr = byCat.get(col.category) ?? [];
      arr.push(col);
      byCat.set(col.category, arr);
    }
    return [...byCat.entries()];
  }, [q]);

  const fwLabel = (id: FrameworkId) => FRAMEWORKS.find(f => f.id === id)?.label ?? id.toUpperCase();

  const fmt = (v: any) => {
    const s = v === null || v === undefined ? '∅ (null)' : String(v);
    return s.length > 80 ? s.slice(0, 80) + '…' : (s === '' ? '∅ (empty)' : s);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <h2 className={T.h2}>Column Reference</h2>
          <span className={cn(T.meta, 'ml-1')}>{AVAILABLE_COLUMNS.length} columns</span>
          <button onClick={() => setNonce(n => n + 1)} title="Reroll examples"
            className="ml-auto p-1.5 text-slate-500 hover:text-slate-700 rounded hover:bg-slate-100">
            <RefreshCw size={15} />
          </button>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="px-4 py-3 border-b border-slate-200 shrink-0 space-y-2 bg-slate-50">
          <label className={cn(T.meta, 'block')} htmlFor="identify-value">Paste a value to see which identifiers it fits, and whether it passes their checks</label>
          <input id="identify-value" value={probe} onChange={e => setProbe(e.target.value)} placeholder="e.g. 4111 1111 1111 1111" spellCheck={false} autoComplete="off"
            className="w-full px-2 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          {probe.trim() !== '' && (
            <ul data-role="matches" className="space-y-1">
              {matches.length === 0 && <li className={cn(T.meta, 'italic')}>Fits no identifier's shape.</li>}
              {matches.map(m => (
                <li key={m.id} data-status={m.status} className="flex items-center gap-2 text-xs">
                  <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded border shrink-0', MATCH_CHIP[m.status])}>{MATCH_LABEL[m.status]}</span>
                  <span className="text-slate-700 truncate">{m.name}</span>
                  <span className={cn(T.meta, 'ml-auto shrink-0')}>{m.check}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-4 py-3 border-b border-slate-200 shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search columns…"
              className="w-full pl-8 pr-2 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5 min-h-0">
          {groups.length === 0 && <p className="text-xs text-slate-400 italic px-1">No columns match "{query}".</p>}
          {groups.map(([category, cols]) => {
            const isCollapsed = q === '' && collapsed.has(category);
            return (
              <div key={category} className="space-y-2">
                <button onClick={() => toggle(category)} className="w-full flex items-center gap-2 py-1">
                  <ChevronRight size={14} className={cn('text-slate-400 transition-transform', !isCollapsed && 'rotate-90')} />
                  <Chip className={CATEGORY_COLORS[category]}>{category}</Chip>
                  <span className={T.meta}>{cols.length}</span>
                </button>
                {!isCollapsed && cols.map(col => {
                  const v = describeValidation(col.validation);
                  const pattern = patternFor(col.id);
                  const fws = Object.entries(frameworksFor(col)) as [FrameworkId, string][];
                  return (
                    <div key={col.id} className="border-t border-slate-100 pt-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800">{col.name}</span>
                        {col.region && <span className="text-[10px] text-slate-400 font-mono shrink-0">{col.region}</span>}
                      </div>
                      <div className="text-xs font-mono text-slate-600 truncate mt-0.5" title={String(samples[col.id])}>{fmt(samples[col.id])}</div>
                      {pattern && (
                        <div className="text-[11px] mt-0.5"><span className="text-slate-400">Pattern </span><span className="font-mono text-slate-500">{pattern}</span></div>
                      )}
                      <div className="flex items-baseline gap-1.5 mt-1">
                        <span className="text-[10px] font-semibold text-slate-500 shrink-0">{v.label}</span>
                        {v.note && <span className="text-[11px] text-slate-500 leading-snug">{v.note}</span>}
                      </div>
                      <div className="text-[11px] mt-0.5"><span className="text-slate-400">Detector </span><span className="text-slate-600">{EXPECTATION_LABELS[expectationFor(col)].toLowerCase()}</span></div>
                      {fws.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {fws.map(([id, value]) => (
                            <span key={id} title={value}
                              className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded border', TIER_CHIP[valueTier(value)])}>
                              {fwLabel(id)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
