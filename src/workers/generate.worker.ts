/// <reference lib="webworker" />
import { AVAILABLE_COLUMNS } from '../data/schema';
import { applySeed } from '../lib/seed';
import { LocaleId } from '../lib/locale';
import { makeRow, csvEscape } from '../lib/generate';

type Format = 'csv' | 'ndjson';

type In =
  | { type: 'memory'; columnIds: string[]; rowCount: number; sparsity: number; seed: number | null; locale?: LocaleId }
  | { type: 'stream'; columnIds: string[]; rowCount: number; sparsity: number; seed: number | null; format: Format; locale?: LocaleId }
  | { type: 'cancel' };

type Out =
  | { type: 'progress'; done: number; total: number }
  | { type: 'header'; text: string }
  | { type: 'chunk'; text: string }
  | { type: 'done'; rows?: any[] }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

const ctx_self: DedicatedWorkerGlobalScope = self as any;
let cancelled = false;

ctx_self.onmessage = async (e: MessageEvent<In>) => {
  const msg = e.data;
  if (msg.type === 'cancel') { cancelled = true; return; }
  cancelled = false;
  try {
    applySeed(msg.seed);
    const cols = AVAILABLE_COLUMNS.filter(c => msg.columnIds.includes(c.id));

    if (msg.type === 'memory') {
      const CHUNK = msg.rowCount > 10_000 ? 2_000 : 500;
      const out = new Array(msg.rowCount);
      for (let off = 0; off < msg.rowCount; off += CHUNK) {
        if (cancelled) { post({ type: 'cancelled' }); return; }
        const end = Math.min(off + CHUNK, msg.rowCount);
        for (let i = off; i < end; i++) out[i] = makeRow(cols, msg.sparsity, msg.locale ?? 'en');
        post({ type: 'progress', done: end, total: msg.rowCount });
        await yieldForMessages();
      }
      post({ type: 'done', rows: out });
      return;
    }

    // stream
    const CHUNK = 10_000;
    if (msg.format === 'csv') {
      const header = cols.map(c => csvEscape(c.name)).join(',') + '\n';
      post({ type: 'header', text: header });
    }
    for (let off = 0; off < msg.rowCount; off += CHUNK) {
      if (cancelled) { post({ type: 'cancelled' }); return; }
      const end = Math.min(off + CHUNK, msg.rowCount);
      let buf = '';
      for (let i = off; i < end; i++) {
        const r = makeRow(cols, msg.sparsity, msg.locale ?? 'en');
        if (msg.format === 'csv') {
          buf += cols.map(c => csvEscape(r[c.id])).join(',') + '\n';
        } else {
          buf += JSON.stringify(r) + '\n';
        }
      }
      post({ type: 'chunk', text: buf });
      post({ type: 'progress', done: end, total: msg.rowCount });
      await yieldForMessages();
    }
    post({ type: 'done' });
  } catch (err: any) {
    post({ type: 'error', message: err?.message ?? String(err) });
  }
};

function post(m: Out) { ctx_self.postMessage(m); }
function yieldForMessages(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}
