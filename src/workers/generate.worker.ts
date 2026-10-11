/// <reference lib="webworker" />
import { AVAILABLE_COLUMNS, ColumnDef } from '../data/schema';
import { applySeed } from '../lib/seed';
import { makeRow, generateChunkText, HeaderMode, RowOptions, StreamFormat } from '../lib/generate';
import { generateDocs, TextOptions } from '../lib/text';
import { rowsFromManifest, Manifest } from '../lib/manifest';

type In =
  | ({ type: 'memory'; columnIds: string[]; rowCount: number; seed: number | null } & RowOptions)
  | ({ type: 'init'; columnIds: string[]; seed: number | null; format: StreamFormat; headers?: HeaderMode } & RowOptions)
  | ({ type: 'text' } & TextOptions)
  | { type: 'regenerate'; manifest: Manifest }
  | { type: 'job'; chunk: number; rows: number }
  | { type: 'cancel' };

type Out =
  | { type: 'progress'; done: number; total: number }
  | { type: 'chunk'; chunk: number; bytes: Uint8Array }
  | { type: 'done'; rows?: any[] }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

const ctx_self: DedicatedWorkerGlobalScope = self as any;
const encoder = new TextEncoder();
let cancelled = false;
// Stream mode: one worker of a pool. `init` fixes the run's settings, then each `job`
// produces one independently-seeded chunk; the main thread owns ordering and pacing.
let stream: ({ cols: ColumnDef[]; seed: number | null; format: StreamFormat; headers?: HeaderMode } & RowOptions) | null = null;

ctx_self.onmessage = async (e: MessageEvent<In>) => {
  const msg = e.data;
  if (msg.type === 'cancel') { cancelled = true; return; }
  try {
    if (msg.type === 'init') {
      if (msg.seed === null) applySeed(null);
      const { type: _type, columnIds, ...settings } = msg;
      stream = { cols: AVAILABLE_COLUMNS.filter(c => columnIds.includes(c.id)), ...settings };
      return;
    }
    if (msg.type === 'job') {
      if (!stream) throw new Error('stream job before init');
      const bytes = encoder.encode(generateChunkText(stream.cols, { ...stream, chunk: msg.chunk, rows: msg.rows }));
      // Encoded here and transferred, so the main thread neither copies nor encodes the chunk.
      ctx_self.postMessage({ type: 'chunk', chunk: msg.chunk, bytes } satisfies Out, [bytes.buffer]);
      return;
    }

    if (msg.type === 'regenerate') {
      post({ type: 'done', rows: rowsFromManifest(msg.manifest) });
      return;
    }
    if (msg.type === 'text') {
      post({ type: 'done', rows: generateDocs(msg) });
      return;
    }

    cancelled = false;
    applySeed(msg.seed);
    const cols = AVAILABLE_COLUMNS.filter(c => msg.columnIds.includes(c.id));
    const CHUNK = msg.rowCount > 10_000 ? 2_000 : 500;
    const out = new Array(msg.rowCount);
    for (let off = 0; off < msg.rowCount; off += CHUNK) {
      if (cancelled) { post({ type: 'cancelled' }); return; }
      const end = Math.min(off + CHUNK, msg.rowCount);
      for (let i = off; i < end; i++) out[i] = makeRow(cols, msg);
      post({ type: 'progress', done: end, total: msg.rowCount });
      await yieldForMessages();
    }
    post({ type: 'done', rows: out });
  } catch (err: any) {
    post({ type: 'error', message: err?.message ?? String(err) });
  }
};

function post(m: Out) { ctx_self.postMessage(m); }
function yieldForMessages(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}
