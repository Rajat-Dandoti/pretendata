// Where generation workers come from. The normal build loads the worker as its own file; the
// offline single-file build swaps this module for workerFactory.inline.ts (see vite.offline.config.ts).
export function newWorker(): Worker {
  return new Worker(new URL('../workers/generate.worker.ts', import.meta.url), { type: 'module' });
}
