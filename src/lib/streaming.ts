import streamSaver from 'streamsaver';
import type { LocaleId } from './locale';
import { AVAILABLE_COLUMNS } from '../data/schema';
import { csvEscape, STREAM_CHUNK_ROWS } from './generate';

// Self-hosted mitm+service-worker (public/mitm.html, public/sw.js — vendored from the
// streamsaver package) instead of its default third-party GitHub Pages iframe: keeps the
// fallback download path same-origin, consistent with "nothing leaves your machine".
streamSaver.mitm = '/mitm.html';

export type StreamFormat = 'csv' | 'ndjson';

export interface StreamOptions {
  columnIds: string[];
  rowCount: number;
  sparsity: number;
  seed: number | null;
  format: StreamFormat;
  locale?: LocaleId;
  onProgress?: (written: number, total: number) => void;
  signal?: AbortSignal;
}

export interface MemoryOptions {
  columnIds: string[];
  rowCount: number;
  sparsity: number;
  seed: number | null;
  locale?: LocaleId;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export function isStreamingSupported(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

function newWorker(): Worker {
  return new Worker(new URL('../workers/generate.worker.ts', import.meta.url), { type: 'module' });
}

function wireAbort(worker: Worker, signal?: AbortSignal): () => void {
  if (!signal) return () => {};
  const handler = () => worker.postMessage({ type: 'cancel' });
  signal.addEventListener('abort', handler);
  return () => signal.removeEventListener('abort', handler);
}

/** Generate rows in a Worker, return the full array to the main thread. */
export function generateInWorker(opts: MemoryOptions): Promise<any[]> {
  const worker = newWorker();
  const detach = wireAbort(worker, opts.signal);
  return new Promise<any[]>((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') opts.onProgress?.(m.done, m.total);
      else if (m.type === 'done') resolve(m.rows ?? []);
      else if (m.type === 'cancelled') reject(new Error('Cancelled'));
      else if (m.type === 'error') reject(new Error(m.message));
    };
    worker.onerror = (e) => reject(new Error(e.message));
    worker.postMessage({
      type: 'memory',
      columnIds: opts.columnIds,
      rowCount: opts.rowCount,
      sparsity: opts.sparsity,
      seed: opts.seed,
      locale: opts.locale,
    });
  }).finally(() => { detach(); worker.terminate(); });
}

interface Sink {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
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
async function openSink(suggestedName: string, format: StreamFormat): Promise<Sink> {
  if (isStreamingSupported()) {
    const fileHandle = await (window as any).showSaveFilePicker({
      suggestedName,
      types: [
        format === 'csv'
          ? { description: 'CSV', accept: { 'text/csv': ['.csv'] } }
          : { description: 'NDJSON', accept: { 'application/x-ndjson': ['.ndjson', '.jsonl'] } },
      ],
    });
    let writable = await fileHandle.createWritable();
    let size = 0;
    let lastCheckpoint = performance.now();
    let checkpointCost = 0;
    return {
      async write(bytes) {
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
      },
      close: () => writable.close(),
    };
  }
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
  const suggestedName = opts.format === 'csv' ? 'privacy_test_data.csv' : 'privacy_test_data.ndjson';
  const sink = await openSink(suggestedName, opts.format);
  const totalChunks = Math.ceil(opts.rowCount / STREAM_CHUNK_ROWS);
  const poolSize = Math.min(totalChunks, streamPoolSize());
  const workers = Array.from({ length: poolSize }, newWorker);
  let written = 0;
  let stopped = false;

  try {
    if (opts.format === 'csv') {
      const cols = AVAILABLE_COLUMNS.filter(c => opts.columnIds.includes(c.id));
      await sink.write(new TextEncoder().encode(cols.map(c => csvEscape(c.name)).join(',') + '\n'));
    }
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
