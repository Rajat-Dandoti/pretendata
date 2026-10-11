// Shareable seed URL: encode generation params into the location hash, hydrate on load.
// ponytail: base64url(JSON) — round-trips through paste/clipboard, no escaping headaches,
// short enough for our state. Bump VERSION if the shape changes incompatibly.

import type { StreamFormat } from './streaming';
import type { LocaleId } from './locale';
import type { HeaderMode } from './generate';
import type { Formatting } from './variants';

export const SHARE_VERSION = 1;

export interface ShareState {
  v: number;          // version
  p: string;          // preset
  c: string[];        // selected column ids
  r: number;          // rowCount
  s: string;          // seed (raw input — empty string = unset)
  sp: number;         // sparsity %
  f: StreamFormat;    // stream format
  l?: LocaleId;       // locale (added v1.1, optional for backward-compat)
  h?: HeaderMode;     // header mode (optional; absent = descriptive)
  d?: number;         // density % (optional; absent = 100)
  fm?: Formatting;    // formatting (optional; absent = canonical)
}

// UTF-8 bytes through btoa/atob, which only take Latin-1: an imported preset can be named anything.
function b64urlEncode(s: string): string {
  const bin = String.fromCharCode(...new TextEncoder().encode(s));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
}

export function encode(state: ShareState): string {
  return b64urlEncode(JSON.stringify(state));
}

export function decode(hash: string): ShareState | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  try {
    const obj = JSON.parse(b64urlDecode(raw));
    if (!obj || typeof obj !== 'object' || obj.v !== SHARE_VERSION) return null;
    if (!Array.isArray(obj.c)) return null;
    return obj as ShareState;
  } catch {
    return null;
  }
}

// ponytail: self-check — encode→decode round-trips. Real tests when a 2nd consumer appears.
export function _selfCheck() {
  const s: ShareState = {
    v: SHARE_VERSION, p: 'HR / Employees', c: ['firstName', 'ssn'],
    r: 500, s: '42', sp: 5, f: 'csv',
  };
  const d = decode(encode(s));
  if (!d || d.p !== s.p || d.c.length !== 2 || d.r !== 500) {
    throw new Error('share self-check: round-trip failed');
  }
  if (decode(encode({ ...s, p: 'Kunden – Österreich ✓' }))?.p !== 'Kunden – Österreich ✓') {
    throw new Error('share self-check: non-Latin-1 preset name failed');
  }
  if (decode('') !== null || decode('not-base64!!') !== null) {
    throw new Error('share self-check: bad input should return null');
  }
}
