// Folds the offline build (dist-offline/index.html + one script + one stylesheet) into a single
// file, dist-offline/pretendata.html, that runs when opened from disk with no network at all.
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const dir = new URL('../dist-offline/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, dir), 'utf8');
let html = read('index.html');

const script = /<script type="module"[^>]*\ssrc="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/.exec(html);
const style = /<link rel="stylesheet"[^>]*\shref="\.\/(assets\/[^"]+\.css)"[^>]*>/.exec(html);
if (!script || !style) throw new Error('inline-offline: expected one module script and one stylesheet in dist-offline/index.html');
// A literal "</script" inside the bundle would end the inline element early.
const js = read(script[1]).replace(/<\/script/gi, '<\\/script');
// Function replacements: a "$&" inside the bundle must not be read as a replacement pattern.
html = html.replace(style[0], () => `<style>${read(style[1])}</style>`).replace(script[0], () => `<script type="module">${js}</script>`);
if (/\ssrc="\.\/assets|href="\.\/assets/.test(html)) throw new Error('inline-offline: something still points at ./assets');

writeFileSync(new URL('pretendata.html', dir), html);
for (const entry of readdirSync(dir)) if (entry !== 'pretendata.html') rmSync(new URL(entry, dir), { recursive: true });
console.log(`Wrote dist-offline/pretendata.html (${(Buffer.byteLength(html) / 1e6).toFixed(1)} MB)`);
