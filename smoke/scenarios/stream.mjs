// Large-run paths in a real browser: File System Access (backed by OPFS) and the streamsaver fallback.
import { readFileSync } from 'node:fs';
export default async (page, check) => {
  // --- 1. File System Access path: the picker is replaced by a real OPFS file handle ---
  await page.init(`if (!window.__mode) window.__mode = sessionStorage.getItem('mode') || 'fsa';
    if (window.__mode === 'fsa') window.showSaveFilePicker = async (o) => { const d = await navigator.storage.getDirectory(); window.__picked = o.suggestedName; return d.getFileHandle('out.csv', { create: true }); };
    else delete window.showSaveFilePicker;`);
  await page.goto('/');
  await page.fill('input[type="number"]', 200000);
  await page.waitFor('[...document.querySelectorAll("button")].some(b => b.textContent.includes("Stream 200k"))');
  await page.click('button', 'Stream 200k');
  await page.waitFor('[...document.querySelectorAll("div")].some(d => d.textContent.startsWith("Streamed 200,000 rows"))', 120000);
  const fsa = await page.eval(`(async () => { const d = await navigator.storage.getDirectory(); const f = await (await d.getFileHandle('out.csv')).getFile(); const u = new Uint8Array(await f.arrayBuffer()); const t = new TextDecoder('utf-8', { ignoreBOM: true }).decode(u); const lines = t.split('\\n'); return { name: window.__picked, size: f.size, bom: u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF, lines: lines.length, header: lines[0].slice(1, 40), last: lines.at(-1) === '', cols: lines[1000].split(',').length }; })()`);
  check(fsa.name === 'pretendata.csv', `picker suggested ${fsa.name}`);
  check(fsa.bom && fsa.lines === 200002 && fsa.last, `File System Access: BOM + header + 200,000 rows + trailing newline (${fsa.lines - 2} rows)`);
  check(fsa.header.startsWith('First Name,Last Name'), 'File System Access: header row');

  // --- 1b. the same run, gzip-compressed: decompress in the page and compare line counts ---
  await page.click('input[type="checkbox"].accent-indigo-600');
  await page.click('button', 'Stream 200k');
  await page.waitFor('[...document.querySelectorAll("div")].some(d => d.textContent.includes("(gzip)"))', 120000);
  const gz = await page.eval(`(async () => { const f = await (await (await navigator.storage.getDirectory()).getFileHandle('out.csv')).getFile(); const head = new Uint8Array(await f.slice(0, 2).arrayBuffer()); const text = await new Response(f.stream().pipeThrough(new DecompressionStream('gzip'))).text(); return { magic: head[0] === 0x1f && head[1] === 0x8b, size: f.size, lines: text.split('\\n').length, name: window.__picked }; })()`);
  check(gz.magic && gz.lines === 200002 && gz.name === 'pretendata.csv.gz', `gzip: a real .gz of ${Math.round(gz.size / 1e6 * 10) / 10} MB that decompresses to 200,000 rows (${gz.name})`);
  check(gz.size < fsa.size * 0.7, `gzip: ${Math.round(100 * gz.size / fsa.size)}% of the uncompressed ${Math.round(fsa.size / 1e6 * 10) / 10} MB`);

  // --- 2. streamsaver fallback (what Firefox and Safari use): no picker available ---
  await page.eval(`sessionStorage.setItem('mode', 'fallback')`);
  await page.goto('/');
  check(await page.eval('!("showSaveFilePicker" in window)'), 'fallback: picker removed');
  await page.fill('input[type="number"]', 200000);
  await page.waitFor('[...document.querySelectorAll("button")].some(b => b.textContent.includes("Stream 200k"))');
  const file = await page.download(() => page.click('button', 'Stream 200k'), 120000);
  const text = readFileSync(file.path, 'utf8');
  check(file.name === 'pretendata.csv', `fallback: downloaded as ${file.name}`);
  check(text.charCodeAt(0) === 0xFEFF && text.split('\n').length === 200002, `fallback: BOM + header + 200,000 rows (${text.split('\n').length - 2} rows)`);
};
