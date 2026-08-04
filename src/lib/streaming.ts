import streamSaver from 'streamsaver';
import type { LocaleId } from './locale';

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
  write(text: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Open a streaming write target for one file. Chrome/Edge get a native save-location
 * picker (File System Access API). Everywhere else falls back to streamsaver — still a
 * single streamed file (never buffered in full, never split into chunks), just delivered
 * to the browser's default downloads folder instead of a chosen path.
 */
async function openSink(suggestedName: string, format: StreamFormat): Promise<Sink> {
  const encoder = new TextEncoder();
  if (isStreamingSupported()) {
    const fileHandle = await (window as any).showSaveFilePicker({
      suggestedName,
      types: [
        format === 'csv'
          ? { description: 'CSV', accept: { 'text/csv': ['.csv'] } }
          : { description: 'NDJSON', accept: { 'application/x-ndjson': ['.ndjson', '.jsonl'] } },
      ],
    });
    const writable = await fileHandle.createWritable();
    return {
      write: (text) => writable.write(encoder.encode(text)),
      close: () => writable.close(),
    };
  }
  const writer = streamSaver.createWriteStream(suggestedName).getWriter();
  return {
    write: (text) => writer.write(encoder.encode(text)),
    close: () => writer.close(),
  };
}

/** Stream-generate to a single file. Worker generates+serializes; main thread writes. */
export async function streamGenerateToFile(opts: StreamOptions): Promise<{ written: number }> {
  const suggestedName = opts.format === 'csv' ? 'privacy_test_data.csv' : 'privacy_test_data.ndjson';
  const sink = await openSink(suggestedName, opts.format);
  const worker = newWorker();
  const detach = wireAbort(worker, opts.signal);
  let written = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = async (e) => {
        const m = e.data;
        try {
          if (m.type === 'header' || m.type === 'chunk') {
            await sink.write(m.text);
          } else if (m.type === 'progress') {
            written = m.done;
            opts.onProgress?.(m.done, m.total);
          } else if (m.type === 'done') {
            resolve();
          } else if (m.type === 'cancelled') {
            reject(new Error('Cancelled'));
          } else if (m.type === 'error') {
            reject(new Error(m.message));
          }
        } catch (err) {
          reject(err as Error);
        }
      };
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage({
        type: 'stream',
        columnIds: opts.columnIds,
        rowCount: opts.rowCount,
        sparsity: opts.sparsity,
        seed: opts.seed,
        format: opts.format,
        locale: opts.locale,
      });
    });
  } finally {
    detach();
    worker.terminate();
    await sink.close();
  }
  return { written };
}
