import { ALL_FAKERS } from './locale';

// mulberry32 — small, fast, decent-quality seedable PRNG. No deps.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let originalRandom: (() => number) | null = null;

/**
 * "Now" for seeded runs. Faker's relative dates (birthdate, recent, past, future) are
 * measured from here instead of the wall clock, so a seed gives the same dates on any day.
 * Part of the seed contract: changing it changes seeded output.
 */
export const SEED_REF_DATE = new Date('2026-01-01T00:00:00.000Z');

/**
 * Apply a seed (reproducible) or clear it (back to entropy).
 * Patches both faker AND Math.random so validators/statistics that use
 * Math.random directly also become deterministic.
 */
export function applySeed(seed: number | null): void {
  if (seed === null || seed === undefined || Number.isNaN(seed)) {
    if (originalRandom) { Math.random = originalRandom; originalRandom = null; }
    // re-randomize from entropy, dates relative to the real clock again
    ALL_FAKERS.forEach(f => { f.seed(); f.setDefaultRefDate(); });
    return;
  }
  if (!originalRandom) originalRandom = Math.random;
  Math.random = mulberry32(seed);
  ALL_FAKERS.forEach(f => { f.seed(seed); f.setDefaultRefDate(SEED_REF_DATE); });
}
