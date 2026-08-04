import type { LocaleId } from './locale';

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

/** Stream-generate to a user-picked file. Worker generates+serializes; main thread writes. */
export async function streamGenerateToFile(opts: StreamOptions): Promise<{ written: number }> {
  if (!isStreamingSupported()) {
    throw new Error(
      'Your browser does not support the File System Access API. Use Chrome/Edge for >100k rows, or lower the count.'
    );
  }

  const suggestedName = opts.format === 'csv' ? 'privacy_test_data.csv' : 'privacy_test_data.ndjson';
  const fileHandle = await (window as any).showSaveFilePicker({
    suggestedName,
    types: [
      opts.format === 'csv'
        ? { description: 'CSV', accept: { 'text/csv': ['.csv'] } }
        : { description: 'NDJSON', accept: { 'application/x-ndjson': ['.ndjson', '.jsonl'] } },
    ],
  });

  const writable = await fileHandle.createWritable();
  const encoder = new TextEncoder();
  const worker = newWorker();
  const detach = wireAbort(worker, opts.signal);
  let written = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      worker.onmessage = async (e) => {
        const m = e.data;
        try {
          if (m.type === 'header' || m.type === 'chunk') {
            await writable.write(encoder.encode(m.text));
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
    await writable.close();
  }
  return { written };
}
