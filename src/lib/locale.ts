// MVP locale support: a small fixed set of pre-built Faker singletons.
// ponytail: locale only affects the obviously-localized fields (names, address,
// phone, jobs). Region-specific identifiers (Aadhaar, NHS, SSN…) keep their
// fixed locale by design. Add more locales when a real consumer asks.

import { faker, fakerDE, fakerES, fakerFR, fakerJA, fakerEN_IN, Faker } from '@faker-js/faker';

export const LOCALES = [
  { id: 'en',    name: 'English (US)' },
  { id: 'en_IN', name: 'English (India)' },
  { id: 'de',    name: 'German' },
  { id: 'es',    name: 'Spanish' },
  { id: 'fr',    name: 'French' },
  { id: 'ja',    name: 'Japanese' },
  { id: 'mix',   name: 'Random Mix' },
] as const;

export type LocaleId = typeof LOCALES[number]['id'];

const FAKERS: Record<Exclude<LocaleId, 'mix'>, Faker> = {
  en: faker, en_IN: fakerEN_IN, de: fakerDE, es: fakerES, fr: fakerFR, ja: fakerJA,
};

/** All non-mix Faker instances — used by seed.ts to keep every locale deterministic. */
export const ALL_FAKERS: Faker[] = Object.values(FAKERS);

const NON_MIX_IDS = Object.keys(FAKERS) as Exclude<LocaleId, 'mix'>[];

/** Resolves 'mix' to a concrete locale (random per call); everything else passes through. */
export function resolveLocale(locale: LocaleId): Exclude<LocaleId, 'mix'> {
  if (locale === 'mix') return NON_MIX_IDS[Math.floor(Math.random() * NON_MIX_IDS.length)];
  return locale;
}

/** Returns the Faker instance for a locale. For 'mix', picks one at random per call. */
export function getFaker(locale: LocaleId): Faker {
  return FAKERS[resolveLocale(locale)] ?? faker;
}
