/// <reference types="vite/client" />
// Offline single-file build: the worker is embedded in the bundle and started from a blob, so the
// page needs no second file. Aliased in place of workerFactory.ts by vite.offline.config.ts.
import InlineWorker from '../workers/generate.worker.ts?worker&inline';

export function newWorker(): Worker {
  return new InlineWorker();
}
