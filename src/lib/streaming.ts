import type { LocaleId } from './locale';
import type { Formatting } from './variants';
import type { Doc, TextOptions } from './text';
import type { Manifest } from './manifest';
import { newWorker } from './workerFactory';
import { AVAILABLE_COLUMNS } from '../data/schema';
import { csvEscape, generateChunkText, headersFor, HeaderMode, sqlCreateTable, StreamFormat, STREAM_CHUNK_ROWS, UTF8_BOM } from './generate';
import { applySeed } from './seed';

export type { StreamFormat };

export interface StreamOptions {
  columnIds: string[];
  rowCount: number;
  sparsity: number;
  seed: number | null;
  format: StreamFormat;
  locale?: LocaleId;
  density?: number;
  formatting?: Formatting;
  uniqueness?: number;
  headers?: HeaderMode;
  /** Write the file gzip-compressed (.gz). Needs the browser's CompressionStream. */
  gzip?: boolean;
  onProgress?: (written: number, total: number) => void;
  signal?: AbortSignal;
}

export interface MemoryOptions {
  columnIds: string[];
  rowCount: number;
  sparsity: number;
  seed: number | null;
  locale?: LocaleId;
  density?: number;
  formatting?: Formatting;
  uniqueness?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export function isStreamingSupported(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

function wireAbort(worker: Worker, signal?: AbortSignal): () => void {
  if (!signal) return () => {};
  const handler = () => worker.postMessage({ type: 'cancel' });
  signal.addEventListener('abort', handler);
  return () => signal.removeEventListener('abort', handler);
}

/** Run one job in a fresh Worker and return what it produced. */
function runInWorker<T>(message: object, o: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal }): Promise<T[]> {
  const worker = newWorker();
  const detach = wireAbort(worker, o.signal);
  return new Promise<T[]>((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') o.onProgress?.(m.done, m.total);
      else if (m.type === 'done') resolve(m.rows ?? []);
      else if (m.type === 'cancelled') reject(new Error('Cancelled'));
      else if (m.type === 'error') reject(new Error(m.message));
    };
    worker.onerror = (e) => reject(new Error(e.message));
    worker.postMessage(message);
  }).finally(() => { detach(); worker.terminate(); });
}

/** Generate rows in a Worker, return the full array to the main thread. */
export function generateInWorker(opts: MemoryOptions): Promise<any[]> {
  const { onProgress, signal, ...settings } = opts;
  return runInWorker({ type: 'memory', ...settings }, opts);
}

/** Rebuild a seeded dataset from its answer key in a Worker. */
export function regenerateInWorker(manifest: Manifest): Promise<Record<string, unknown>[]> {
  return runInWorker<Record<string, unknown>>({ type: 'regenerate', manifest }, {});
}

/** Generate text documents in a Worker. */
export function generateDocsInWorker(opts: TextOptions): Promise<Doc[]> {
  return runInWorker<Doc>({ type: 'text', ...opts }, {});
}

interface Sink {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export function isGzipSupported(): boolean {
  return typeof CompressionStream !== 'undefined';
}

/**
 * Compress on the way into a sink, with the platform's own gzip. Closing finishes the gzip
 * stream first, so even a cancelled run leaves a valid archive of what was written.
 */
function gzipped(sink: Sink): Sink {
  const gz = new CompressionStream('gzip');
  const writer = gz.writable.getWriter();
  const pump = (async () => {
    const reader = gz.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      await sink.write(value);
    }
  })();
  return {
    write: (bytes) => writer.write(bytes),
    close: async () => { await writer.close(); await pump; await sink.close(); },
  };
}

const CHECKPOINT_MIN_MS = 30_000;

/** Workers used for a streamed run: leave one core for the page, cap at 8. */
export function streamPoolSize(): number {
  return Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
}

/**
 * Open a streaming write target for one file. Chrome/Edge get a native save-location
 * picker (File System Access API). Everywhere else falls back to streamsaver — still a
 * single streamed file (never buffered in full, never split into chunks), just delivered
 * to the browser's default downloads folder instead of a chosen path.
 */
async function openSink(suggestedName: string, format: StreamFormat, gzip: boolean): Promise<Sink> {
  if (isStreamingSupported()) {
    const fileHandle = await (window as any).showSaveFilePicker({
      suggestedName,
      types: [gzip ? { description: 'Gzip', accept: { 'application/gzip': ['.gz'] } } : {
        csv: { description: 'CSV', accept: { 'text/csv': ['.csv'] } },
        ndjson: { description: 'NDJSON', accept: { 'application/x-ndjson': ['.ndjson', '.jsonl'] } },
        sql: { description: 'SQL', accept: { 'application/sql': ['.sql'] } },
      }[format]],
    });
    let writable = await fileHandle.createWritable();
    let size = 0;
    let lastCheckpoint = performance.now();
    let checkpointCost = 0;
    let inFlight: Promise<void> = Promise.resolve();
    const write = async (bytes: Uint8Array) => {
      await writable.write(bytes);
      size += bytes.byteLength;
      // Chrome writes to a hidden swap file and only moves it onto the picked file at
      // close(), so a tab that reloads or dies mid-run leaves 0 bytes. Checkpoint = close
      // (commits everything so far) + reopen at the end of the file.
      // ponytail: a checkpoint costs O(file size) (Chrome re-scans the file, and may copy
      // it → up to 2× disk), so they are spaced ≥10× the last one's duration (~10% overhead
      // cap). If that hurts on huge files, write numbered part files into a folder instead.
      if (performance.now() - lastCheckpoint >= Math.max(CHECKPOINT_MIN_MS, checkpointCost * 10)) {
        const t = performance.now();
        await writable.close();
        writable = await fileHandle.createWritable({ keepExistingData: true });
        await writable.seek(size);
        lastCheckpoint = performance.now();
        checkpointCost = lastCheckpoint - t;
      }
    };
    return {
      write: (bytes) => (inFlight = write(bytes)),
      // A cancelled run closes while a write may still be mid-checkpoint (closed, not yet
      // reopened). Let it land first, or the reopened swap file is never closed.
      close: () => inFlight.catch(() => {}).then(() => writable.close()),
    };
  }
  // The fallback downloads through a service worker, which a page opened from a file cannot register.
  if (location.protocol === 'file:') {
    throw new Error('Opened from a file, large datasets need a browser with the File System Access API (Chrome or Edge). Up to 100,000 rows works in any browser.');
  }
  // Imported on demand: only browsers without the File System Access API need it, and it
  // touches `document` at import, which would keep this module out of `npm test`.
  const { default: streamSaver } = await import('streamsaver');
  // Self-hosted mitm+service-worker (public/mitm.html, public/sw.js — vendored from the
  // streamsaver package) instead of its default third-party GitHub Pages iframe: keeps the
  // fallback download path same-origin, consistent with "nothing leaves your machine".
  streamSaver.mitm = '/mitm.html';
  const writer = streamSaver.createWriteStream(suggestedName).getWriter();
  return {
    write: (bytes) => writer.write(bytes),
    close: () => writer.close(),
  };
}

/**
 * Stream-generate to a single file. A pool of workers generates independently-seeded
 * chunks in parallel; the main thread writes them strictly in chunk order.
 */
export async function streamGenerateToFile(opts: StreamOptions): Promise<{ written: number }> {
  const gzip = !!opts.gzip && isGzipSupported();
  const suggestedName = `pretendata.${opts.format}${gzip ? '.gz' : ''}`;
  const file = await openSink(suggestedName, opts.format, gzip);
  const sink = gzip ? gzipped(file) : file;
  const totalChunks = Math.ceil(opts.rowCount / STREAM_CHUNK_ROWS);
  const poolSize = Math.min(totalChunks, streamPoolSize());
  const workers = Array.from({ length: poolSize }, newWorker);
  let written = 0;
  let stopped = false;

  try {
    const cols = AVAILABLE_COLUMNS.filter(c => opts.columnIds.includes(c.id));
    const head = opts.format === 'csv' ? UTF8_BOM + headersFor(cols, opts.headers).map(csvEscape).join(',') + '\n'
      : opts.format === 'sql' ? sqlCreateTable(cols, opts.headers)
      : '';
    if (head) await sink.write(new TextEncoder().encode(head));
    await new Promise<void>((resolve, reject) => {
      const ready = new Map<number, Uint8Array>(); // finished chunks waiting for their turn
      const idle = [...workers];
      let nextJob = 0;
      let nextWrite = 0;
      let writing = false;

      // Backpressure: chunks generated but not yet on disk never exceed 2× the pool, so
      // memory stays flat no matter how slow the disk is.
      const dispatch = () => {
        while (!stopped && idle.length && nextJob < totalChunks && nextJob - nextWrite < poolSize * 2) {
          const chunk = nextJob++;
          const rows = Math.min(STREAM_CHUNK_ROWS, opts.rowCount - chunk * STREAM_CHUNK_ROWS);
          idle.pop()!.postMessage({ type: 'job', chunk, rows });
        }
      };
      const drain = async () => {
        if (writing) return;
        writing = true;
        try {
          for (let bytes; !stopped && (bytes = ready.get(nextWrite)); ) {
            ready.delete(nextWrite);
            await sink.write(bytes);
            nextWrite++;
            written = Math.min(opts.rowCount, nextWrite * STREAM_CHUNK_ROWS);
            opts.onProgress?.(written, opts.rowCount);
            dispatch();
          }
          if (nextWrite === totalChunks) resolve();
        } catch (err) {
          reject(err as Error);
        } finally {
          writing = false;
        }
      };

      if (opts.signal?.aborted) return reject(new Error('Cancelled'));
      opts.signal?.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
      for (const w of workers) {
        w.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'chunk') {
            ready.set(m.chunk, m.bytes);
            idle.push(w);
            dispatch();
            void drain();
          } else if (m.type === 'error') {
            reject(new Error(m.message));
          }
        };
        w.onerror = (e) => reject(new Error(e.message));
        w.postMessage({
          type: 'init',
          columnIds: opts.columnIds,
          sparsity: opts.sparsity,
          seed: opts.seed,
          format: opts.format,
          locale: opts.locale,
          density: opts.density,
          formatting: opts.formatting,
          uniqueness: opts.uniqueness,
          headers: opts.headers,
        });
      }
      dispatch();
    });
  } catch (err) {
    stopped = true;
    workers.forEach(w => w.terminate());
    await sink.close().catch(() => {}); // keep what was written; report the original error
    throw err;
  }
  workers.forEach(w => w.terminate());
  await sink.close();
  return { written };
}

// ---------- self-check (run via `npm test`) ----------
// Drives the real pool/ordering/checkpoint code against a fake picker and fake workers.
// The fake file only shows data once its writable is closed, like Chrome's swap file.
export async function _selfCheck() {
  const g = globalThis as any;
  const saved = { window: g.window, Worker: g.Worker, now: performance.now };
  const dec = new TextDecoder('utf-8', { ignoreBOM: true }); // keep the BOM: the file must be compared byte for byte
  const join = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
  const opts = { columnIds: ['firstName', 'ssn'], rowCount: STREAM_CHUNK_ROWS * 12 + 123, sparsity: 10, seed: 9, format: 'csv' as const, locale: 'mix' as const };
  const cols = AVAILABLE_COLUMNS.filter(c => opts.columnIds.includes(c.id));
  let expected = UTF8_BOM + 'First Name,SSN\n';
  for (let chunk = 0; chunk < 13; chunk++) expected += generateChunkText(cols, { ...opts, chunk, rows: chunk < 12 ? STREAM_CHUNK_ROWS : 123 });

  // Workers answer out of order (later chunks sooner) so the writer has to reorder them.
  g.Worker = class {
    onmessage: ((e: any) => void) | null = null;
    dead = false;
    postMessage(m: any) {
      if (m.type !== 'job') return;
      const bytes = new TextEncoder().encode(generateChunkText(cols, { ...opts, chunk: m.chunk, rows: m.rows }));
      setTimeout(() => { if (!this.dead) this.onmessage?.({ data: { type: 'chunk', chunk: m.chunk, bytes } }); }, 6 - (m.chunk % 6));
    }
    terminate() { this.dead = true; }
  };
  const fakeFile = (onClose: (n: number) => void) => {
    const file = { bytes: new Uint8Array(0), get text() { return dec.decode(this.bytes); }, open: 0, closes: 0 };
    g.window = { showSaveFilePicker: async () => ({
      async createWritable(o?: { keepExistingData?: boolean }) {
        const swap: Uint8Array[] = o?.keepExistingData ? [file.bytes] : [];
        const size = () => swap.reduce((n, p) => n + p.length, 0);
        let closed = false;
        file.open++;
        return {
          async write(b: Uint8Array) { swap.push(b.slice()); },
          async seek(pos: number) { if (pos !== size()) throw new Error('seek is not at the end of the file'); },
          async close() {
            if (closed) throw new TypeError('writable already closed');
            closed = true;
            onClose(++file.closes);
            await new Promise(r => setTimeout(r, 5));
            file.bytes = join(swap);
            file.open--;
          },
        };
      },
    }) };
    return file;
  };
  // Fake clock: every look at it is 40s later, so periodic saves happen within a 13-chunk run.
  let clock = 0;
  performance.now = () => (clock += 40_000);
  try {
    const full = fakeFile(() => {});
    const res = await streamGenerateToFile(opts);
    if (res.written !== opts.rowCount) throw new Error('FAIL: stream row count');
    if (full.text !== expected) throw new Error('FAIL: streamed file differs from in-order chunks');
    if (full.closes < 3 || full.open !== 0) throw new Error(`FAIL: checkpoints (${full.closes} closes, ${full.open} left open)`);

    // Cancel in the middle of a periodic save: what was saved stays, nothing is left open.
    clock = 0;
    const ac = new AbortController();
    const cut = fakeFile(n => { if (n === 2) ac.abort(); });
    const err = await streamGenerateToFile({ ...opts, signal: ac.signal }).then(() => null, e => e);
    await new Promise(r => setTimeout(r, 50));
    if (err?.message !== 'Cancelled') throw new Error('FAIL: cancel should reject with Cancelled');
    if (cut.open !== 0) throw new Error('FAIL: cancel during a save left a writable open');
    if (cut.text.length < 1000 || !expected.startsWith(cut.text)) throw new Error('FAIL: cancelled file is not a clean prefix');

    // Gzip: smaller on disk, and decompresses to exactly the same file — periodic saves included.
    clock = 0;
    const packed = fakeFile(() => {});
    await streamGenerateToFile({ ...opts, gzip: true });
    const unpacked = await new Response(new Blob([packed.bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    if (dec.decode(unpacked) !== expected) throw new Error('FAIL: gzipped stream does not decompress to the same file');
    if (packed.bytes.length > expected.length * 0.7 || packed.open !== 0) throw new Error(`FAIL: gzip should shrink this file well below 70% (got ${Math.round(100 * packed.bytes.length / expected.length)}%) and leave nothing open`);
  } finally {
    g.window = saved.window; g.Worker = saved.Worker; performance.now = saved.now;
    applySeed(null);
  }
  console.log('streaming: all self-checks passed');
}
