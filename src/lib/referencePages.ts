// Static reference pages: one per column, plus an index. Plain HTML with no script, so they
// work under the site's content security policy, load without JavaScript, and can be read by
// search engines. Everything on a page comes from the schema, so it cannot drift from the app.
import { AVAILABLE_COLUMNS, CATEGORY_COLORS, ColumnDef, EXPECTATION_LABELS, PrivacyCategory, expectationFor } from '../data/schema';
import { FRAMEWORKS, frameworksFor, VALUE_LABELS } from './frameworks';
import { generateRows } from './generate';
import { describeValidation, patternFor } from './reference';
import { encode, SHARE_VERSION } from './share';

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const file = (id: string) => `${id}.html`;

const EXPECTATION_TEXT = {
  detect: 'A detector should flag this column. Missing it is a false negative.',
  ignore: 'A detector should leave this column alone. Flagging it is a false positive.',
  context: 'Sensitive only in combination with other columns, or by policy. It is reported but never scored.',
} as const;

const STYLE = `
  body { font: 16px/1.55 system-ui, sans-serif; color: #0f172a; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; }
  a { color: #4f46e5; } h1 { font-size: 1.6rem; margin-bottom: .2rem; } h2 { font-size: 1.05rem; margin-top: 1.8rem; }
  code, pre { font: 14px ui-monospace, monospace; background: #f1f5f9; border-radius: 6px; }
  code { padding: .1rem .35rem; } pre { padding: .7rem .9rem; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  .meta { color: #64748b; font-size: .9rem; } .tag { display: inline-block; font-size: .75rem; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 999px; padding: .05rem .6rem; margin-right: .3rem; }
  table { border-collapse: collapse; width: 100%; font-size: .92rem; } td, th { text-align: left; padding: .3rem .6rem .3rem 0; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  .button { display: inline-block; background: #4f46e5; color: #fff; text-decoration: none; padding: .5rem .9rem; border-radius: 8px; font-weight: 600; }
`;

// Same icon as index.html: the header logo, inline so a page needs no second file.
const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%234f39f6'/%3E%3Cg transform='translate(6 6) scale(.8333)' fill='none' stroke='%23fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'/%3E%3Cpath d='M12 8v4'/%3E%3Cpath d='M12 16h.01'/%3E%3C/g%3E%3C/svg%3E";

function shell(title: string, description: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Pretendata</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="${ICON}">
<style>${STYLE}</style>
</head>
<body>
${body}
<p class="meta" style="margin-top:3rem">Generated from the Pretendata column catalog. Every example on this page is synthetic and randomly generated; any resemblance to a real identifier is coincidence.</p>
</body>
</html>
`;
}

function columnPage(c: ColumnDef, appUrl: string): string {
  const check = describeValidation(c.validation);
  const pattern = patternFor(c.id);
  const expectation = expectationFor(c);
  const origin = c.validation?.startsWith('near-miss-of:') ? AVAILABLE_COLUMNS.find(x => x.id === c.validation!.slice('near-miss-of:'.length)) : undefined;
  const siblings = AVAILABLE_COLUMNS.filter(x => x.validation === `near-miss-of:${c.id}`);
  const examples = generateRows({ columnIds: [c.id], rowCount: 5, seed: 1 }).map(r => r[c.id]);
  const tags = Object.entries(frameworksFor(c)).map(([fw, value]) => `<span class="tag">${esc(FRAMEWORKS.find(f => f.id === fw)?.label ?? fw)}: ${esc(VALUE_LABELS[value] ?? value)}</span>`).join('');
  const link = `${appUrl}#${encode({ v: SHARE_VERSION, p: 'Custom', c: [c.id], r: 100, s: '42', sp: 0, f: 'csv' })}`;
  const summary = `${c.name}: format${pattern ? ', pattern' : ''}, ${check.label.toLowerCase()} check and synthetic examples for testing data-loss-prevention and classification tools.`;
  return shell(c.name, summary, `
<p class="meta"><a href="index.html">All columns</a></p>
<h1>${esc(c.name)}</h1>
<p><span class="tag">${esc(c.category)}</span>${c.region ? `<span class="tag">${esc(c.region)}</span>` : ''}<span class="tag">${esc(EXPECTATION_LABELS[expectation])}</span></p>
<p>${esc(EXPECTATION_TEXT[expectation])}</p>
<h2>Format</h2>
<table>
<tr><th>Check</th><td>${esc(check.label)}${check.note ? ` — ${esc(check.note)}` : ''}</td></tr>
${pattern ? `<tr><th>Pattern</th><td><code>${esc(pattern)}</code></td></tr>` : ''}
<tr><th>Column id</th><td><code>${esc(c.id)}</code></td></tr>
</table>
${origin ? `<p>This is a negative control: shaped like <a href="${file(origin.id)}">${esc(origin.name)}</a> but deliberately not valid as one, or as any other identifier.</p>` : ''}
${siblings.length ? `<p>Negative controls for this column: ${siblings.map(s => `<a href="${file(s.id)}">${esc(s.name)}</a>`).join(', ')}.</p>` : ''}
<h2>Synthetic examples</h2>
<pre>${examples.map(esc).join('\n')}</pre>
${tags ? `<h2>Regulations</h2><p>${tags}</p><p class="meta">Heuristic and column-level; not legal advice.</p>` : ''}
<p style="margin-top:2rem"><a class="button" href="${esc(link)}">Generate test data with this column</a></p>`);
}

/** Every page, as path (relative to the reference directory) → HTML. `appUrl` is where the app lives, e.g. "../". */
export function referencePages(appUrl = '../'): Map<string, string> {
  const pages = new Map<string, string>();
  for (const c of AVAILABLE_COLUMNS) pages.set(file(c.id), columnPage(c, appUrl));
  const groups = Object.keys(CATEGORY_COLORS) as PrivacyCategory[];
  pages.set('index.html', shell('Column reference', `Format, check algorithm and synthetic examples for ${AVAILABLE_COLUMNS.length} kinds of sensitive and look-alike data.`, `
<h1>Column reference</h1>
<p>${AVAILABLE_COLUMNS.length} kinds of sensitive, and deliberately almost-sensitive, data that <a href="${esc(appUrl)}">Pretendata</a> generates: what each looks like, how it is checked, and what a detector should do with it.</p>
${groups.map(g => `<h2>${esc(g)}</h2>
<table>${AVAILABLE_COLUMNS.filter(c => c.category === g).map(c => `<tr><td><a href="${file(c.id)}">${esc(c.name)}</a></td><td>${esc(describeValidation(c.validation).label)}</td><td>${esc(EXPECTATION_LABELS[expectationFor(c)])}</td></tr>`).join('\n')}</table>`).join('\n')}`));
  return pages;
}

// ---------- self-check (run via `npm test`) ----------
export function _selfCheck() {
  const pages = referencePages();
  if (pages.size !== AVAILABLE_COLUMNS.length + 1) throw new Error('FAIL: one reference page per column, plus the index');
  // hostile example values are shown, never executed: no page may contain markup that came from data
  for (const [path, html] of pages) {
    // ("onerror=" may appear as text; without a tag in front of it, it is inert)
    if (/<script|<img|<svg|<iframe/i.test(html)) throw new Error(`FAIL: ${path} contains unescaped markup`);
    for (const m of html.matchAll(/href="([\w]+\.html)"/g)) if (!pages.has(m[1])) throw new Error(`FAIL: ${path} links to a missing page ${m[1]}`);
  }
  if (!pages.get('chaosXss.html')!.includes('&lt;script&gt;')) throw new Error('FAIL: the XSS column should show its payloads escaped');
  const aadhaar = pages.get('aadhaar.html')!;
  if (!aadhaar.includes('Verhoeff') || !aadhaar.includes('<code>\\d{12}</code>') || !aadhaar.includes('href="aadhaar_invalid.html"') || !/<pre>[2-9]\d{11}\n/.test(aadhaar)) throw new Error('FAIL: Aadhaar reference page');
  if (!pages.get('aadhaar_invalid.html')!.includes('href="aadhaar.html"')) throw new Error('FAIL: a near-miss page links to its origin');
  if (pages.get('aadhaar.html') !== referencePages().get('aadhaar.html')) throw new Error('FAIL: reference pages must be reproducible');
  console.log('reference pages: all self-checks passed');
}
