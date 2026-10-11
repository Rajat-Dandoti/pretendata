import React, { useMemo, useState } from 'react';
import { X, FileDown } from 'lucide-react';
import { EXPECTATION_LABELS, Expectation } from '../data/schema';
import { PACKS } from '../data/templates';
import { generateDocs, docsToNdjson, Doc, TextPack, TEXT_PACKS } from '../lib/text';
import { generateDocsInWorker } from '../lib/streaming';
import { downloadText } from '../lib/exporters';
import type { LocaleId } from '../lib/locale';
import type { Formatting } from '../lib/variants';
import { Button, Dropdown, T } from '../lib/ui';
import { cn } from '../lib/utils';

const MAX_DOCS = 100_000;
const MARK: Record<Expectation, string> = {
  detect: 'bg-rose-100 text-rose-900',
  context: 'bg-amber-100 text-amber-900',
  ignore: 'bg-slate-200 text-slate-700',
};

// A document with each embedded value highlighted. Offsets are code points, so split on those.
function Highlighted({ doc }: { doc: Doc }) {
  const chars = [...doc.text];
  const parts: React.ReactNode[] = [];
  let at = 0;
  doc.entities.forEach((e, i) => {
    parts.push(chars.slice(at, e.start).join(''));
    parts.push(
      <mark key={i} title={`${e.type} — ${EXPECTATION_LABELS[e.expectation].toLowerCase()}`} className={cn('rounded px-0.5', MARK[e.expectation])}>
        {chars.slice(e.start, e.end).join('')}
      </mark>,
    );
    at = e.end;
  });
  parts.push(chars.slice(at).join(''));
  return <p className="text-[13px] text-slate-700 whitespace-pre-wrap break-words leading-relaxed">{parts}</p>;
}

// Slide-out panel for unstructured test data: prose with identifiers embedded and their
// positions recorded. Seed, locale and formatting come from the main settings.
export default function TextPanel({ onClose, seed, locale, formatting }: {
  onClose: () => void; seed: number | null; locale: LocaleId; formatting: Formatting;
}) {
  const [pack, setPack] = useState<TextPack>('mixed');
  const [count, setCount] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The first documents of exactly what Download will produce.
  const preview = useMemo(() => generateDocs({ pack, count: 4, seed, locale, formatting }), [pack, seed, locale, formatting]);

  const download = async () => {
    setBusy(true); setError(null);
    try {
      const docs = await generateDocsInWorker({ pack, count, seed, locale, formatting });
      downloadText(docsToNdjson(docs), `pretendata.${pack}.ndjson`, 'application/x-ndjson');
    } catch (e: any) {
      setError(e?.message ?? 'Generation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()} role="dialog" aria-label="Text and prompts">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <h2 className={T.h2}>Text &amp; prompts</h2>
          <span className={cn(T.meta, 'ml-1')}>identifiers embedded in prose, with their positions</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto p-1.5 text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
          <p className={T.body}>
            Detectors for mail, chat, documents and AI assistants read text, not columns. Each line of the download is one
            document with an <code className="font-mono text-xs">entities</code> list — the answer key — giving the start, end, type and value of
            everything embedded in it. Seed, locale and identifier formatting follow the main settings.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
            <div className="space-y-1">
              <span className={cn(T.meta, 'block')}>Pack</span>
              <Dropdown<TextPack> value={pack} onChange={setPack}
                options={TEXT_PACKS.map(p => ({ value: p, label: p === 'mixed' ? 'Mixed (all packs)' : PACKS[p].label }))} />
            </div>
            <div className="space-y-1">
              <label htmlFor="doc-count" className={cn(T.meta, 'block')}>Documents</label>
              <input id="doc-count" type="number" min={1} max={MAX_DOCS} value={count}
                onChange={e => setCount(Math.min(MAX_DOCS, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                className="w-28 px-2 py-2.5 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <Button variant="primary" size="md" onClick={download} disabled={busy} aria-label="Download documents">
              <FileDown size={16} /> {busy ? 'Generating…' : 'Download NDJSON'}
            </Button>
          </div>
          {pack !== 'mixed' && <p className={T.meta}>{PACKS[pack].description}{pack === 'prompt' && ' Written as chat messages; offsets are into the message content.'}</p>}
          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}

          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className={T.micro}>Preview</span>
            {(['detect', 'context', 'ignore'] as const).map(e => (
              <span key={e} className="flex items-center gap-1"><span className={cn('w-2.5 h-2.5 rounded-sm', MARK[e].split(' ')[0])} />{EXPECTATION_LABELS[e]}</span>
            ))}
          </div>
          <div className="space-y-3" data-role="docs">
            {preview.map((d, i) => (
              <div key={i} className="border border-slate-200 rounded-lg p-3">
                <div className={cn(T.micro, 'mb-1')}>{PACKS[d.pack].label} · {d.entities.length} embedded</div>
                <Highlighted doc={d} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
