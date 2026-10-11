// Tiny headless-Chrome driver over the DevTools protocol. No dependencies.
// Serves dist/ (with the headers from dist/_headers, so the content security policy is in force),
// runs one scenario from smoke/scenarios/ against it, and fails on any console error, native
// dialog or request that leaves the origin.
// usage: node smoke/harness.mjs <scenario>      (run `npm run smoke` for all of them)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const OUT = join(HERE, '.out');
const DIST = join(REPO, 'dist');
const CHROME = process.env.CHROME ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
if (!CHROME) { console.error('No Chrome found. Set CHROME to the path of a Chrome or Chromium binary.'); process.exit(2); }
if (!existsSync(join(DIST, 'index.html'))) { console.error('dist/ is missing. Run `npm run build` first.'); process.exit(2); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

// ---- static server for dist/, optionally applying dist/_headers ("/*" block only) ----
const extra = {};
if (existsSync(join(DIST, '_headers'))) {
  let on = false;
  for (const line of readFileSync(join(DIST, '_headers'), 'utf8').split('\n')) {
    if (/^\S/.test(line)) { on = line.trim() === '/*'; continue; }
    const m = /^\s+([^:#]+):\s*(.+)$/.exec(line);
    if (on && m) extra[m[1].trim()] = m[2].trim();
  }
}
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(DIST, p === '/' ? 'index.html' : p);
  if (!existsSync(file)) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', ...extra });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- chrome ----
mkdirSync(OUT, { recursive: true });
const profile = join(OUT, 'profile'); rmSync(profile, { recursive: true, force: true });
const downloads = join(OUT, 'downloads'); rmSync(downloads, { recursive: true, force: true }); mkdirSync(downloads, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const portFile = join(profile, 'DevToolsActivePort');
for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise(r => setTimeout(r, 100));
const port = readFileSync(portFile, 'utf8').split('\n')[0];
const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let seq = 0; const pending = new Map(); const errors = []; const external = []; const downloadsDone = []; const downloadNames = new Map(); const dialogs = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('log: ' + m.params.entry.text);
  if (m.method === 'Network.requestWillBeSent') { const u = m.params.request.url; if (/^https?:/.test(u) && !u.startsWith(base)) external.push(u); }
  if (m.method === 'Page.javascriptDialogOpening') { dialogs.push(m.params.type + ': ' + m.params.message.slice(0, 80)); send('Page.handleJavaScriptDialog', { accept: true }); }
  if (m.method === 'Browser.downloadWillBegin') downloadNames.set(m.params.guid, m.params.suggestedFilename);
  if (m.method === 'Browser.downloadProgress' && m.params.state === 'completed') downloadsDone.push(m.params.guid);
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; const t = setTimeout(() => { pending.delete(id); reject(new Error('protocol timeout: ' + method)); }, 150000); pending.set(id, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } }); ws.send(JSON.stringify({ id, method, params })); });
for (const d of ['Runtime', 'Log', 'Page', 'Network', 'DOM']) await send(`${d}.enable`);
await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: base });
await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = {
  base, downloads, errors, external, dialogs, out: OUT,
  async goto(path = '/') { await send('Page.navigate', { url: base + path }); await sleep(300); await page.waitFor('document.readyState === "complete" && (!document.querySelector("#root") || !!document.querySelector("#root").firstChild)'); },
  async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text) + '\n  in: ' + expr.slice(0, 200)); return r.result.value; },
  async waitFor(expr, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { if (await page.eval(`!!(${expr})`).catch(() => false)) return; await sleep(100); } throw new Error('timeout waiting for: ' + expr); },
  // click the first element matching a CSS selector, or (with text) the first such element whose text/title/aria-label contains it
  async click(selector, text) {
    const ok = await page.eval(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})]; const t = ${JSON.stringify(text ?? null)};
      const el = t === null ? els[0] : els.find(e => [e.textContent, e.title, e.getAttribute('aria-label')].some(x => (x ?? '').includes(t)));
      if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`);
    if (!ok) throw new Error(`click: nothing matches ${selector}${text ? ' with "' + text + '"' : ''}`);
    await sleep(150);
  },
  async fill(selector, value) {
    const ok = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))});
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    if (!ok) throw new Error('fill: nothing matches ' + selector);
    await sleep(150);
  },
  async key(key, code = key) { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Tab: 9 }[key] ?? 0 }); await sleep(120); },
  async upload(selector, file) { const { root } = await send('DOM.getDocument'); const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector }); if (!nodeId) throw new Error('upload: nothing matches ' + selector); await send('DOM.setFileInputFiles', { nodeId, files: [file] }); await sleep(300); },
  async screenshot(name) { const { data } = await send('Page.captureScreenshot', { format: 'png' }); const f = join(OUT, name); writeFileSync(f, Buffer.from(data, 'base64')); return f; },
  async viewport(width, height) { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 }); await sleep(200); },
  async download(trigger, ms = 20000) { const before = downloadsDone.length; await trigger(); const t = Date.now(); while (downloadsDone.length === before) { if (Date.now() - t > ms) throw new Error('download did not complete'); await sleep(100); } await sleep(100); const guid = downloadsDone.at(-1); return { path: join(downloads, guid), name: downloadNames.get(guid) }; },
  async reload() { await send('Page.reload'); await sleep(400); await page.waitFor('document.readyState === "complete" && !!document.querySelector("#root")?.firstChild'); },
  async init(source) { await send('Page.addScriptToEvaluateOnNewDocument', { source }); },
  sleep,
};

let failed = false;
const check = (cond, label) => { console.log(`${cond ? '  ok  ' : '  FAIL'} ${label}`); if (!cond) failed = true; };
try {
  const scenario = (await import(pathToFileURL(join(HERE, 'scenarios', process.argv[2] + '.mjs')).href)).default;
  await scenario(page, check);
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''}`);
  check(dialogs.length === 0, `no native dialogs${dialogs.length ? ': ' + dialogs.join(' | ') : ''}`);
  check(external.length === 0, `no requests leave the origin${external.length ? ': ' + [...new Set(external)].slice(0, 4).join(', ') : ''}`);
} catch (e) { console.log('  FAIL scenario threw: ' + e.message); failed = true; if (errors.length) console.log('  console: ' + errors.slice(0, 4).join(' | ')); }
ws.close(); chrome.kill(); server.close();
console.log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED');
process.exit(failed ? 1 : 0);
