// Unstructured test data: prose with identifiers embedded in it, and the position of each one.
// Detectors for mail, chat, documents and AI prompts work on text like this, not on tidy columns.
// Each document carries its own answer key as `entities`.
import { AVAILABLE_COLUMNS, ColumnDef, Expectation, expectationFor } from '../data/schema';
import { PACKS, PACK_IDS, PackId } from '../data/templates';
import { makeRow, RowOptions } from './generate';
import { applySeed } from './seed';

export type TextPack = PackId | 'mixed';
export const TEXT_PACKS: TextPack[] = [...PACK_IDS, 'mixed'];

export interface Entity {
  /** Offsets in Unicode code points, end exclusive — `text[start:end]` in Python gives the value. */
  start: number;
  end: number;
  /** Column id of what is embedded there, e.g. "creditCard". */
  type: string;
  value: string;
  expectation: Expectation;
}

export interface Doc {
  pack: PackId;
  text: string;
  entities: Entity[];
}

const SLOT = /\{\{(\w+)\}\}/g;
const COLUMN = new Map(AVAILABLE_COLUMNS.map(c => [c.id, c]));
// Columns each template needs, in catalog order (the order makeRow draws them in).
const NEEDS = new Map<string, ColumnDef[]>();
function columnsOf(template: string): ColumnDef[] {
  let cols = NEEDS.get(template);
  if (!cols) {
    const ids = new Set([...template.matchAll(SLOT)].map(m => m[1]));
    cols = AVAILABLE_COLUMNS.filter(c => ids.has(c.id));
    NEEDS.set(template, cols);
  }
  return cols;
}

const codePoints = (s: string) => [...s].length;

/** Fill a template's `{{columnId}}` slots and record where each value landed. */
export function render(template: string, values: Record<string, unknown>): { text: string; entities: Entity[] } {
  let text = '', at = 0, last = 0;
  const entities: Entity[] = [];
  for (const m of template.matchAll(SLOT)) {
    const before = template.slice(last, m.index);
    text += before; at += codePoints(before);
    const col = COLUMN.get(m[1])!;
    const value = String(values[col.id]);
    entities.push({ start: at, end: at + codePoints(value), type: col.id, value, expectation: expectationFor(col) });
    text += value; at += codePoints(value);
    last = m.index + m[0].length;
  }
  return { text: text + template.slice(last), entities };
}

export interface TextOptions extends RowOptions {
  pack: TextPack;
  count: number;
  seed?: number | null;
}

/**
 * Generate documents. Locale and formatting apply as in tabular data; sparsity and density do
 * not — a document with its identifier missing would have nothing to find.
 */
export function generateDocs(o: TextOptions): Doc[] {
  applySeed(o.seed ?? null);
  const row: RowOptions = { locale: o.locale, formatting: o.formatting };
  const out: Doc[] = new Array(o.count);
  for (let i = 0; i < o.count; i++) {
    const pack = o.pack === 'mixed' ? PACK_IDS[Math.floor(Math.random() * PACK_IDS.length)] : o.pack;
    const templates = PACKS[pack].templates;
    const template = templates[Math.floor(Math.random() * templates.length)];
    out[i] = { pack, ...render(template, makeRow(columnsOf(template), row)) };
  }
  return out;
}

/**
 * One JSON document per line. The prompt pack is written as chat messages, the shape AI
 * gateways and guardrails take; entity offsets are into the message content.
 */
export function docsToNdjson(docs: Doc[]): string {
  return docs.map(d => JSON.stringify(
    d.pack === 'prompt' ? { pack: d.pack, messages: [{ role: 'user', content: d.text }], entities: d.entities } : d,
  )).join('\n') + (docs.length ? '\n' : '');
}

// ---------- self-check (run via `npm test`) ----------
export function _selfCheck() {
  // every slot names a real column
  for (const [id, pack] of Object.entries(PACKS)) {
    for (const t of pack.templates) {
      const unknown = [...t.matchAll(SLOT)].map(m => m[1]).filter(s => !COLUMN.has(s));
      if (unknown.length) throw new Error(`FAIL: template in pack ${id} uses unknown columns: ${unknown}`);
      if (!t.includes('{{')) throw new Error(`FAIL: template in pack ${id} embeds nothing`);
    }
  }
  // offsets are code points, exact, in order and non-overlapping — in every locale and formatting
  for (const locale of ['en', 'ja', 'mix'] as const) {
    for (const formatting of ['canonical', 'evasive'] as const) {
      for (const d of generateDocs({ pack: 'mixed', count: 400, seed: 5, locale, formatting })) {
        const chars = [...d.text];
        let prev = 0;
        for (const e of d.entities) {
          if (chars.slice(e.start, e.end).join('') !== e.value) throw new Error(`FAIL: entity offsets (${locale}, ${formatting}): ${JSON.stringify(e)} in ${JSON.stringify(d.text)}`);
          if (e.start < prev || e.end <= e.start) throw new Error('FAIL: entities out of order or empty');
          prev = e.end;
        }
        // (a chaos value may itself be "{{7*7}}" — only a leftover column slot counts)
        if (d.entities.length === 0 || [...d.text.matchAll(SLOT)].some(m => COLUMN.has(m[1]))) throw new Error('FAIL: unfilled template');
      }
    }
  }
  // astral characters before an entity shift UTF-16 indices but not code-point offsets
  const r = render('{{chaosUnicode}} then {{ssn}}', { chaosUnicode: '🔥💀🎭', ssn: '078-05-1120' });
  if (r.entities[1].start !== 9 || [...r.text].slice(9, 20).join('') !== '078-05-1120') throw new Error('FAIL: code-point offsets after astral characters');
  // seeded and reproducible; every pack reachable; prompts come out as chat messages
  const a = docsToNdjson(generateDocs({ pack: 'mixed', count: 300, seed: 9 }));
  if (a !== docsToNdjson(generateDocs({ pack: 'mixed', count: 300, seed: 9 }))) throw new Error('FAIL: text seed determinism');
  if (PACK_IDS.some(p => !a.includes(`"pack":"${p}"`))) throw new Error('FAIL: mixed pack should draw from every pack');
  const prompt = JSON.parse(docsToNdjson(generateDocs({ pack: 'prompt', count: 1, seed: 2 })));
  const content = prompt.messages?.[0]?.content;
  if (prompt.messages[0].role !== 'user' || [...content].slice(prompt.entities[0].start, prompt.entities[0].end).join('') !== prompt.entities[0].value) throw new Error('FAIL: prompt documents');
  console.log('text: all self-checks passed');
}
