import React, { useMemo, useState } from 'react';
import { X, FileDown, FolderArchive } from 'lucide-react';
import { EXPECTATION_LABELS, Expectation } from '../data/schema';
import { PACKS } from '../data/templates';
import { generateDocs, docsToNdjson, Doc, TextPack, TEXT_PACKS } from '../lib/text';
import { generateDocsInWorker } from '../lib/streaming';
import { downloadText, downloadBlob } from '../lib/exporters';
import { buildSecretsRepo, secretsRepoZip, SECRETS_ZIP_NAME } from '../lib/fixtures';
import { generateRelated, relatedZip, relatedZipName, schemaInfo, SCHEMA_IDS, SchemaId } from '../lib/relational';
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
  const [schema, setSchema] = useState<SchemaId>('retail');
  const [people, setPeople] = useState(1000);
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
      <div className="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()} role="dialog" aria-label="More kinds of data">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <h2 className={T.h2}>More kinds of data</h2>
          <span className={cn(T.meta, 'ml-1')}>text and prompts · a secrets repository · related tables</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto p-1.5 text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
          <span className={cn(T.label, 'block')}>Text and AI prompts</span>
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

          <div className="border-t border-slate-200 pt-4 space-y-2">
            <span className={cn(T.label, 'block')}>Secrets fixture repository</span>
            <p className={T.body}>
              For secret scanners: a zip of <code className="font-mono text-xs">.env</code>, YAML, source, SQL and key files for three
              services, each with fake secrets planted in it and decoys a good scanner leaves alone (placeholders, variable
              references, a vendor's documented example key). <code className="font-mono text-xs">answer-key.json</code> gives the file and
              line of every one.
            </p>
            <Button size="md" aria-label="Download secrets fixture"
              onClick={() => downloadBlob(secretsRepoZip(buildSecretsRepo({ seed })), SECRETS_ZIP_NAME)}>
              <FolderArchive size={16} /> Download zip
            </Button>
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-2">
            <span className={cn(T.label, 'block')}>Related tables</span>
            <p className={T.body}>
              One set of people spread over several tables, as a real database holds them, with details repeated where a real system
              repeats them. The zip has a CSV per table, the same data as one <code className="font-mono text-xs">schema.sql</code> with
              primary and foreign keys, an answer key, and <code className="font-mono text-xs">subject-index.json</code> listing every row
              that belongs to each person — the right answer to "find everything about this customer".
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1 w-44">
                <span className={cn(T.meta, 'block')}>Schema</span>
                <Dropdown<SchemaId> value={schema} onChange={setSchema} options={SCHEMA_IDS.map(s => ({ value: s, label: schemaInfo(s).label }))} />
              </div>
              <div className="space-y-1">
                <label htmlFor="people-count" className={cn(T.meta, 'block')}>People</label>
                <input id="people-count" type="number" min={1} max={50000} value={people}
                  onChange={e => setPeople(Math.min(50000, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                  className="w-28 px-2 py-2.5 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>
              <Button size="md" aria-label="Download related tables"
                onClick={() => { const o = { schema, people, seed, locale, formatting }; downloadBlob(relatedZip(generateRelated(o), o), relatedZipName(schema)); }}>
                <FolderArchive size={16} /> Download zip
              </Button>
            </div>
            <p className={T.meta}>{schemaInfo(schema).description} Tables: {schemaInfo(schema).tables.join(', ')}.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
