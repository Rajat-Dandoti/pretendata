import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Download, Upload, Settings, RefreshCw, FileJson, FileSpreadsheet, ShieldAlert, Database, CheckSquare, Square, Library, Sliders, Link2, ChevronDown, ChevronRight, Search, Info, Globe, X, Menu, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { AVAILABLE_COLUMNS, CATEGORY_COLORS, PrivacyCategory, ColumnDef, PRESETS } from './data/schema';
import { cn } from './lib/utils';
import { Button, Chip, T, ICON, Dropdown, TIER_CHIP } from './lib/ui';
import { exportCSV, exportJSON, exportPresetConfig, downloadManifest } from './lib/exporters';
import { JsonStructure } from './lib/nesting';
import { RunMeta, GenMode } from './lib/manifest';
import { triggeredFrameworks, frameworkBreakdown, valueTier, FRAMEWORK_NOTES } from './lib/frameworks';
import { streamGenerateToFile, isStreamingSupported, StreamFormat, generateInWorker } from './lib/streaming';
import { encode as encodeShare, decode as decodeShare, SHARE_VERSION } from './lib/share';
import { LOCALES, LocaleId, getFaker } from './lib/locale';
import ColumnReference from './components/ColumnReference';

// ponytail: no more per-row left border — accent moved to a card around the whole category.
// Kept the map deleted; category color still comes from CATEGORY_COLORS.

// ponytail: native title — CSS tooltip was clipping under sibling components/z-index and needed
// per-side collision logic. `title=` is boring but bulletproof.
function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return <span title={text} className="inline-flex">{children}</span>;
}

const MIN_ROWS = 10;
const MAX_ROWS = 10_000_000;
const IN_MEMORY_THRESHOLD = 100_000;

// ponytail: pure log10 range 10..10M → slider 0..600. Every decade = 100 slider units,
// so 10, 1k, 100k, 10M land at exactly 0/200/400/600 (0%, 33%, 66%, 100%).
const SLIDER_MAX = 600; // 6 decades × 100
function sliderToRows(v: number): number {
  const raw = Math.pow(10, 1 + v / 100);
  // Snap to 1/2/5 × 10^n for readable round values.
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const snaps = [1, 2, 5, 10];
  let best = 1, bd = Infinity;
  for (const s of snaps) { const d = Math.abs(s - norm); if (d < bd) { bd = d; best = s; } }
  return Math.max(10, Math.min(10_000_000, Math.round(best * mag)));
}
function rowsToSlider(rows: number): number {
  const clamped = Math.max(10, Math.min(10_000_000, rows));
  return Math.round(100 * (Math.log10(clamped) - 1));
}
function formatRows(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(n);
}

export default function App() {
  const [rowCount, setRowCount] = useState<number>(100);
  const [selectedPreset, setSelectedPreset] = useState<string>('Common Users');
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    new Set(PRESETS['Common Users'])
  );
  const [generatedData, setGeneratedData] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [sparsity, setSparsity] = useState<number>(0);
  const [lastRunMeta, setLastRunMeta] = useState<RunMeta | null>(null);
  const [includeManifest, setIncludeManifest] = useState(false);
  const [streamFormat, setStreamFormat] = useState<StreamFormat>('csv');
  const [jsonStructure, setJsonStructure] = useState<JsonStructure>('flat');
  const [nestDepth, setNestDepth] = useState<number>(3);
  const [locale, setLocale] = useState<LocaleId>('en');
  const [streamProgress, setStreamProgress] = useState<{ written: number; total: number } | null>(null);
  const [seedStr, setSeedStr] = useState<string>('42');
  const [columnSearch, setColumnSearch] = useState<string>('');
  const [showReference, setShowReference] = useState(false);
  const [showSelectedOnly, setShowSelectedOnly] = useState<boolean>(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    const preset = new Set(PRESETS['Common Users']);
    for (const cat of Object.keys(CATEGORY_COLORS)) {
      const hasSelected = AVAILABLE_COLUMNS.some(c => c.category === cat && preset.has(c.id));
      if (!hasSelected) initial.add(cat);
    }
    return initial;
  });
  const [toast, setToast] = useState<string | null>(null);
  // ponytail: single slot, not two booleans — only one off-canvas drawer can be open at a time on mobile.
  const [mobileDrawer, setMobileDrawer] = useState<'settings' | 'columns' | null>(null);
  // Independent of mobileDrawer — at lg+ each sidebar can be collapsed to reclaim width for the table.
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const [columnsCollapsed, setColumnsCollapsed] = useState(false);
  const [showCompliance, setShowCompliance] = useState(false);
  const [complianceEnabled, setComplianceEnabled] = useState(true);
  const complianceRef = useRef<HTMLDivElement>(null);
  const streamSupported = isStreamingSupported();
  const isLarge = rowCount > IN_MEMORY_THRESHOLD;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  // Auto-dismiss the post-generate toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Close the compliance popover on outside click.
  useEffect(() => {
    if (!showCompliance) return;
    const h = (e: MouseEvent) => { if (complianceRef.current && !complianceRef.current.contains(e.target as Node)) setShowCompliance(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showCompliance]);

  // Hydrate from #hash on mount (shareable seed URL).
  useEffect(() => {
    const s = decodeShare(window.location.hash);
    if (!s) return;
    if (s.p && PRESETS[s.p]) setSelectedPreset(s.p);
    else setSelectedPreset('Custom');
    setSelectedColumns(new Set(s.c));
    setRowCount(s.r);
    setSeedStr(s.s);
    setSparsity(s.sp);
    setStreamFormat(s.f);
    if (s.l) setLocale(s.l);
  }, []);

  const handleCopyShareLink = async () => {
    const hash = encodeShare({
      v: SHARE_VERSION,
      p: selectedPreset,
      c: Array.from(selectedColumns),
      r: rowCount,
      s: seedStr,
      sp: sparsity,
      k: '1',
      f: streamFormat,
      l: locale,
    });
    const url = `${window.location.origin}${window.location.pathname}#${hash}`;
    try {
      await navigator.clipboard.writeText(url);
      window.history.replaceState(null, '', `#${hash}`);
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  const seedNum = (() => {
    const t = seedStr.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? Math.floor(n) : null;
  })();

  const buildRunMeta = (mode: GenMode, effectiveRowCount: number): RunMeta => ({
    seed: seedNum,
    rowCount: effectiveRowCount,
    sparsityPct: sparsity,
    kAnonymity: null,
    mode,
  });

  // Group columns by category
  const columnsByCategory = useMemo(() => {
    const grouped: Record<string, ColumnDef[]> = {};
    AVAILABLE_COLUMNS.forEach(col => {
      if (!grouped[col.category]) grouped[col.category] = [];
      grouped[col.category].push(col);
    });
    return grouped;
  }, []);

  // Filter by search + optional selected-only toggle.
  const filteredColumnsByCategory = useMemo(() => {
    const q = columnSearch.trim().toLowerCase();
    if (!q && !showSelectedOnly) return columnsByCategory;
    const out: Record<string, ColumnDef[]> = {};
    for (const [cat, cols] of Object.entries(columnsByCategory)) {
      const matches = cols.filter(c => {
        if (showSelectedOnly && !selectedColumns.has(c.id)) return false;
        if (!q) return true;
        return c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
      });
      if (matches.length > 0) out[cat] = matches;
    }
    return out;
  }, [columnSearch, columnsByCategory, showSelectedOnly, selectedColumns]);

  // Select-all / clear over the currently-visible (filtered) columns.
  const filteredIds = useMemo(() => Object.values(filteredColumnsByCategory).flat().map(c => c.id), [filteredColumnsByCategory]);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selectedColumns.has(id));
  const toggleSelectAllFiltered = () => {
    const next = new Set(selectedColumns);
    if (allFilteredSelected) filteredIds.forEach(id => next.delete(id));
    else filteredIds.forEach(id => next.add(id));
    setSelectedColumns(next);
    setSelectedPreset('Custom');
    setGeneratedData([]);
  };

  // ponytail: sync 5-row live preview. Small enough to run on every state change without a worker.
  const livePreview = useMemo(() => {
    if (selectedColumns.size === 0) return [];
    const cols = AVAILABLE_COLUMNS.filter(c => selectedColumns.has(c.id));
    const f = getFaker(locale);
    if (seedNum !== null) f.seed(seedNum);
    const rows: any[] = [];
    for (let i = 0; i < 5; i++) {
      const dob = f.date.birthdate({ min: 18, max: 80, mode: 'age' });
      const fctx: any = {
        firstName: f.person.firstName(),
        lastName: f.person.lastName(),
        gender: f.person.sex(),
        dob,
        age: new Date().getFullYear() - dob.getFullYear(),
        faker: f,
      };
      const row: Record<string, any> = {};
      for (const col of cols) {
        row[col.id] = sparsity > 0 && Math.random() < sparsity / 100 ? null : col.generate(fctx);
      }
      rows.push(row);
    }
    return rows;
  }, [selectedColumns, locale, sparsity, seedNum]);

  // ponytail: crude est ≈ cols × 22 B/cell for CSV, worker throughput ≈ 60k rows/s. Good enough.
  const estimate = useMemo(() => {
    const cells = rowCount * selectedColumns.size;
    const bytes = cells * 22;
    const sizeStr = bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB`
      : bytes > 1_000 ? `${(bytes / 1_000).toFixed(0)} KB`
      : `${bytes} B`;
    const secs = rowCount / 60_000;
    const timeStr = secs < 1 ? '<1s' : secs < 60 ? `~${Math.ceil(secs)}s` : `~${(secs / 60).toFixed(1)}m`;
    return { sizeStr, timeStr };
  }, [rowCount, selectedColumns.size]);

  const toggleCategoryCollapsed = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleToggleColumn = (id: string) => {
    const newSet = new Set(selectedColumns);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedColumns(newSet);
    setSelectedPreset('Custom');
    setGeneratedData([]); // column shape changed — stale rows would render `undefined`; fall back to live preview
  };

  const handlePresetChange = (presetName: string) => {
    setSelectedPreset(presetName);
    if (presetName !== 'Custom' && PRESETS[presetName]) {
      setSelectedColumns(new Set(PRESETS[presetName]));
      setGeneratedData([]);
    }
  };

  const generateData = async () => {
    const columnIds = AVAILABLE_COLUMNS.filter(c => selectedColumns.has(c.id)).map(c => c.id);

    if (isLarge) {
      setIsGenerating(true);
      setStreamProgress({ written: 0, total: rowCount });
      const ac = new AbortController();
      streamAbortRef.current = ac;
      try {
        await streamGenerateToFile({
          columnIds,
          rowCount,
          sparsity,
          seed: seedNum,
          format: streamFormat,
          locale,
          signal: ac.signal,
          onProgress: (written, total) => setStreamProgress({ written, total }),
        });
        setGeneratedData([]);
        const meta = buildRunMeta('offline', rowCount);
        setLastRunMeta(meta);
        setToast(`Streamed ${rowCount.toLocaleString()} rows to file · ${streamFormat.toUpperCase()}${includeManifest ? ' · manifest included' : ''}`);
        if (includeManifest) downloadManifest(`privacy_test_data.${streamFormat}`, selectedColumns, meta);
      } catch (err: any) {
        if (err?.name !== 'AbortError' && err?.message !== 'Cancelled') {
          alert(err?.message || 'Streaming generation failed.');
        }
      } finally {
        setIsGenerating(false);
        setStreamProgress(null);
        streamAbortRef.current = null;
      }
      return;
    }

    setIsGenerating(true);
    setStreamProgress({ written: 0, total: rowCount });
    const ac = new AbortController();
    streamAbortRef.current = ac;
    try {
      const rows = await generateInWorker({
        columnIds,
        rowCount,
        sparsity,
        seed: seedNum,
        locale,
        signal: ac.signal,
        onProgress: (done, total) => setStreamProgress({ written: done, total }),
      });
      setGeneratedData(rows);
      setLastRunMeta(buildRunMeta('offline', rows.length));
      setToast(`Generated ${rows.length.toLocaleString()} rows · ${estimate.sizeStr}${seedNum != null ? ` · seed ${seedNum}` : ''}`);
    } catch (err: any) {
      if (err?.message !== 'Cancelled') alert(err?.message || 'Generation failed.');
    } finally {
      setIsGenerating(false);
      setStreamProgress(null);
      streamAbortRef.current = null;
    }
  };

  const cancelGeneration = () => {
    streamAbortRef.current?.abort();
  };

  const handleExportPreset = () => {
    exportPresetConfig(selectedPreset, selectedColumns, rowCount, sparsity);
  };

  const importPreset = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const config = JSON.parse(event.target?.result as string);
        if (config.columns && Array.isArray(config.columns)) {
          setSelectedColumns(new Set(config.columns));
          if (config.rowCount) setRowCount(config.rowCount);
          if (config.sparsity !== undefined) setSparsity(config.sparsity);
          setSelectedPreset(config.presetName || 'Custom');
        }
      } catch (err) {
        alert("Invalid preset file.");
      }
    };
    reader.readAsText(file);
    // Reset file input so same file can be selected again
    e.target.value = '';
  };

  const activeCols = AVAILABLE_COLUMNS.filter(c => selectedColumns.has(c.id));

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* Below lg, both sidebars go off-canvas — 320px + 288px can't share a phone screen with the table. */}
      {mobileDrawer && (
        <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setMobileDrawer(null)} />
      )}

      {/* Sidebar */}
      <div className={cn(
        "w-80 bg-white border-r border-slate-200 flex flex-col h-full shadow-sm shrink-0",
        "fixed inset-y-0 left-0 z-40 transition-all duration-200 lg:static lg:translate-x-0 lg:z-10",
        mobileDrawer === 'settings' ? "translate-x-0" : "-translate-x-full",
        // ponytail: collapsed panel is width-0 + overflow-hidden rather than unmounted — simplest way
        // to keep its internal state (scroll position, open <details>) intact across toggles.
        settingsCollapsed ? "lg:w-0 lg:border-r-0 lg:overflow-hidden" : "lg:w-80"
      )}>
        <div className="p-5 border-b border-slate-200 flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg text-white">
            <ShieldAlert size={20} />
          </div>
          <div>
            <h1 className="font-semibold text-slate-900 leading-tight">Pretendata</h1>
            <p className="text-xs text-slate-500">Synthetic test data for QA &amp; DLP</p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsCollapsed(true)}
            className="hidden lg:inline-flex ml-auto p-1.5 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100"
            aria-label="Collapse settings panel"
            title="Collapse panel"
          >
            <PanelLeftClose size={16} />
          </button>
          <button
            type="button"
            onClick={() => setMobileDrawer(null)}
            className="ml-auto lg:hidden p-1.5 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100"
            aria-label="Close settings"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Row Count */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                <Database size={16} className="text-slate-400" />
                Dataset Size
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={MIN_ROWS}
                  max={MAX_ROWS}
                  value={rowCount}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n)) setRowCount(n);
                  }}
                  onBlur={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isNaN(n)) setRowCount(MIN_ROWS);
                    else setRowCount(Math.min(MAX_ROWS, Math.max(MIN_ROWS, n)));
                  }}
                  className="w-24 text-xs font-mono bg-white border border-slate-300 rounded px-2 py-1 text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  title={`Exact row count (${MIN_ROWS.toLocaleString()}–${MAX_ROWS.toLocaleString()})`}
                />
                <span className="text-xs text-slate-500">rows</span>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={SLIDER_MAX}
              step={1}
              value={rowsToSlider(rowCount)}
              onChange={(e) => setRowCount(sliderToRows(parseInt(e.target.value)))}
              className="w-full accent-indigo-600"
            />
            <div className="relative h-4 text-xs text-slate-400 font-mono">
              <span className="absolute left-0">10</span>
              <span className="absolute left-1/3 -translate-x-1/2">1k</span>
              <span className="absolute left-2/3 -translate-x-1/2">100k</span>
              <span className="absolute right-0">10M</span>
            </div>
            {isLarge && (
              <div className="mt-2 space-y-2 p-2.5 rounded-md bg-amber-50 border border-amber-200">
                <p className="text-[11px] text-amber-800 leading-snug">
                  <strong>Large dataset:</strong> {streamSupported
                    ? "Will stream directly to a file you pick."
                    : "Will stream straight to your downloads folder (your browser can't prompt for a save location)."} Live preview is disabled above {formatRows(IN_MEMORY_THRESHOLD)} rows.
                </p>
                <div className="flex gap-1">
                  <Button
                    variant={streamFormat === 'csv' ? 'primary' : 'outline'}
                    onClick={() => setStreamFormat('csv')}
                    className="flex-1"
                  >CSV</Button>
                  <Button
                    variant={streamFormat === 'ndjson' ? 'primary' : 'outline'}
                    onClick={() => setStreamFormat('ndjson')}
                    className="flex-1"
                  >NDJSON</Button>
                </div>
              </div>
            )}
          </div>

          <div className="h-px bg-slate-100"></div>

          {/* Preset Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
              <Library size={16} className="text-slate-400" />
              Dataset Preset
            </label>
            <Dropdown
              value={selectedPreset}
              onChange={handlePresetChange}
              options={[
                ...Object.keys(PRESETS).map(p => ({ value: p, label: p })),
                { value: 'Custom', label: 'Custom Selection' },
              ]}
            />
          </div>

          {/* Locale Selection */}
          <div className="space-y-2">
            <label className={cn(T.label, 'flex items-center gap-2')}>
              <Globe size={ICON.label} className="text-slate-400" />
              Locale
              <Tip text="Affects names, addresses, phone, and job-related fields. Region-specific identifiers (Aadhaar, NHS, SSN…) keep their fixed locale.">
                <Info size={ICON.micro} className="text-slate-400" />
              </Tip>
            </label>
            <Dropdown
              value={locale}
              onChange={(v) => setLocale(v as LocaleId)}
              options={LOCALES.map(l => ({ value: l.id, label: l.name }))}
            />
          </div>

          <div className="h-px bg-slate-100"></div>

          {/* Advanced fold — sparsity, seed, k-anon, config I/O, cloning */}
          <details className="group" open>
            <summary className="cursor-pointer flex items-center justify-between text-sm font-medium text-slate-700 hover:text-slate-900 list-none [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <Sliders size={16} className="text-slate-400" />
                Advanced
              </span>
              <ChevronRight size={14} className="text-slate-400 transition-transform group-open:rotate-90" />
            </summary>
            <div className="mt-4 space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className={cn(T.body, 'font-medium flex items-center gap-1.5')}>
                    Data Sparsity (Nulls)
                    <Tip text="Fraction of cells set to null/empty. Use to test how downstream systems handle missing values without changing row count.">
                      <Info size={ICON.micro} className="text-slate-400" />
                    </Tip>
                  </span>
                  <span className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-600">{sparsity}%</span>
                </div>
                <input type="range" min="0" max="90" step="5" value={sparsity}
                  onChange={(e) => setSparsity(parseInt(e.target.value))}
                  className="w-full accent-indigo-600" />
              </div>
              <div className="space-y-2">
                <span className={cn(T.body, 'font-medium block')}>Seed <span className="font-normal text-slate-400">(optional)</span></span>
                <input type="text" inputMode="numeric" value={seedStr}
                  onChange={(e) => setSeedStr(e.target.value.replace(/[^\d-]/g, ''))}
                  placeholder="e.g. 42 — leave blank for random"
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                {seedStr && seedNum === null && (
                  <p className={cn(T.meta, 'text-rose-600')}>Not a valid integer.</p>
                )}
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" checked={complianceEnabled}
                  onChange={(e) => setComplianceEnabled(e.target.checked)}
                  className="mt-0.5 accent-indigo-600" />
                <span>
                  <span className={cn(T.body, 'font-medium flex items-center gap-1.5')}>
                    Compliance tags
                    <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">beta</span>
                  </span>
                  <span className={cn(T.meta, 'leading-tight block mt-0.5')}>Show which regulations (GDPR / HIPAA / DPDP) the selected columns fall under. Classification is heuristic and column-level.</span>
                </span>
              </label>
              <div className="space-y-2">
                <span className={cn(T.body, 'font-medium flex items-center gap-1.5')}>
                  JSON structure
                  <Tip text="Shape of the JSON/NDJSON export: Flat rows, Grouped by category, Semantic nested record, or Deep-nested N levels (buries the record to test whether a detector traverses nested JSON).">
                    <Info size={ICON.micro} className="text-slate-400" />
                  </Tip>
                </span>
                <div className="flex items-center gap-2">
                  <Dropdown<JsonStructure>
                    className="flex-1"
                    value={jsonStructure}
                    onChange={setJsonStructure}
                    options={[
                      { value: 'flat', label: 'Flat' },
                      { value: 'grouped', label: 'Grouped by category' },
                      { value: 'semantic', label: 'Semantic nested' },
                      { value: 'deep', label: 'Deep nested' },
                    ]}
                  />
                  {jsonStructure === 'deep' && (
                    <input
                      type="number" min={1} max={10} value={nestDepth}
                      onChange={e => setNestDepth(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                      title="Nesting depth"
                      className="w-14 px-2 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <span className={cn(T.body, 'font-medium block')}>Preset Config</span>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={handleExportPreset} className="flex-1">
                    <Download size={ICON.body} /> Export
                  </Button>
                  <Button variant="ghost" onClick={() => fileInputRef.current?.click()} className="flex-1">
                    <Upload size={ICON.body} /> Import
                  </Button>
                  <input type="file" accept=".json" className="hidden" ref={fileInputRef} onChange={importPreset} />
                </div>
                <p className={cn(T.meta, 'leading-tight')}>Save this column selection + settings as a JSON file, or load a previously exported config.</p>
              </div>
            </div>
          </details>

        </div>

      </div>

      {/* Columns Column */}
      <aside className={cn(
        "w-72 bg-white border-r border-slate-200 flex flex-col h-full shadow-sm shrink-0",
        "fixed inset-y-0 left-0 z-40 transition-all duration-200 lg:static lg:translate-x-0 lg:z-10",
        mobileDrawer === 'columns' ? "translate-x-0" : "-translate-x-full",
        columnsCollapsed ? "lg:w-0 lg:border-r-0 lg:overflow-hidden" : "lg:w-72"
      )}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
          <Settings size={16} className="text-slate-400" />
          <h2 className="text-sm font-medium text-slate-700">Configure Columns</h2>
          <button
            type="button"
            onClick={() => setShowSelectedOnly(v => !v)}
            title={showSelectedOnly ? 'Show all columns' : 'Show only selected columns'}
            className={cn(
              "ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors cursor-pointer",
              showSelectedOnly
                ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            )}
          >
            {selectedColumns.size} / {AVAILABLE_COLUMNS.length}{showSelectedOnly ? ' •' : ''}
          </button>
          <button
            type="button"
            onClick={() => setShowReference(true)}
            title="Column reference — patterns, algorithms & examples"
            className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100 transition-colors"
          >
            <Library size={15} />
          </button>
          <button
            type="button"
            onClick={() => setColumnsCollapsed(true)}
            className="hidden lg:inline-flex p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100"
            aria-label="Collapse columns panel"
            title="Collapse panel"
          >
            <PanelRightClose size={15} />
          </button>
          <button
            type="button"
            onClick={() => setMobileDrawer(null)}
            className="lg:hidden p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100"
            aria-label="Close columns"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={columnSearch}
              onChange={(e) => setColumnSearch(e.target.value)}
              placeholder="Search columns…"
              className="w-full pl-8 pr-2 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <button
            type="button"
            onClick={toggleSelectAllFiltered}
            disabled={filteredIds.length === 0}
            title={allFilteredSelected ? 'Deselect all shown columns' : 'Select all shown columns'}
            className="flex-shrink-0 p-1.5 text-slate-500 hover:text-slate-700 rounded hover:bg-slate-100 transition-colors disabled:opacity-40"
          >
            {allFilteredSelected ? <CheckSquare size={14} className="text-indigo-600" /> : <Square size={14} />}
          </button>
          <button
            type="button"
            onClick={() => {
              const allCats = Object.keys(columnsByCategory);
              setCollapsedCategories(prev => prev.size === allCats.length ? new Set() : new Set(allCats));
            }}
            title={collapsedCategories.size === Object.keys(columnsByCategory).length ? 'Expand all categories' : 'Collapse all categories'}
            className="flex-shrink-0 p-1.5 text-slate-500 hover:text-slate-700 rounded hover:bg-slate-100 transition-colors"
          >
            {collapsedCategories.size === Object.keys(columnsByCategory).length
              ? <ChevronDown size={14} />
              : <ChevronRight size={14} />}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {Object.entries(filteredColumnsByCategory).map(([category, cols]) => {
            const colArr = cols as ColumnDef[];
            const selectedInCat = colArr.filter(c => selectedColumns.has(c.id)).length;
            const isCollapsed = columnSearch.trim() === '' && collapsedCategories.has(category);
            return (
              <div key={category} className="border border-slate-200 rounded-lg bg-white overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleCategoryCollapsed(category)}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-2 py-1.5 hover:bg-slate-50 group",
                    !isCollapsed && "border-b border-slate-100"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {isCollapsed
                      ? <ChevronRight size={14} className="text-slate-400 group-hover:text-slate-600" />
                      : <ChevronDown size={14} className="text-slate-500" />}
                    <Chip className={CATEGORY_COLORS[category as PrivacyCategory]}>{category}</Chip>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">
                    {selectedInCat} / {colArr.length}
                  </span>
                </button>
                {!isCollapsed && (() => {
                  // Sub-group DL by region. dl* ids → nested under "Driver's License".
                  const dlCols = colArr.filter(c => /^dl[A-Z]/.test(c.id));
                  const normalCols = colArr.filter(c => !/^dl[A-Z]/.test(c.id));
                  const renderBtn = (col: ColumnDef) => {
                    const isSelected = selectedColumns.has(col.id);
                    return (
                      <button
                        key={col.id}
                        onClick={() => handleToggleColumn(col.id)}
                        className="w-full flex items-center gap-3 px-2 py-2 lg:py-1.5 rounded-md hover:bg-slate-50 transition-colors text-left group"
                      >
                        <div className={cn("flex-shrink-0", isSelected ? "text-indigo-600" : "text-slate-300 group-hover:text-slate-400")}>
                          {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                        </div>
                        <span className={cn("text-sm truncate", isSelected ? "text-slate-700" : "text-slate-500")}>
                          {col.name}
                        </span>
                      </button>
                    );
                  };
                  return (
                    <div className="space-y-1 p-1.5">
                      {normalCols.map(renderBtn)}
                      {dlCols.length > 0 && (
                        <div className="ml-2 pl-2 border-l border-slate-200 space-y-0.5 mt-1">
                          <div className="flex items-center justify-between px-2 pt-1.5 pb-0.5">
                            <span className={T.micro}>Driver's License</span>
                            <span className="text-[10px] font-mono text-slate-400">
                              {dlCols.filter(c => selectedColumns.has(c.id)).length} / {dlCols.length}
                            </span>
                          </div>
                          {dlCols.map(renderBtn)}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
          {Object.keys(filteredColumnsByCategory).length === 0 && (
            <p className="text-xs text-slate-400 italic px-2 py-3">No columns match "{columnSearch}".</p>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col h-full bg-slate-50/50">
        {/* Header */}
        <header className="min-h-16 lg:h-16 border-b border-slate-200 bg-white flex items-center justify-between px-4 lg:px-8 py-2 lg:py-0 flex-wrap gap-y-2 flex-shrink-0">
          <div className="flex items-center gap-2 lg:gap-3">
            <button
              type="button"
              onClick={() => setMobileDrawer('settings')}
              className="lg:hidden p-1.5 -ml-1 text-slate-500 hover:text-slate-700 rounded hover:bg-slate-100"
              aria-label="Open settings"
              title="Settings"
            >
              <Menu size={18} />
            </button>
            <button
              type="button"
              onClick={() => setMobileDrawer('columns')}
              className="lg:hidden p-1.5 text-slate-500 hover:text-slate-700 rounded hover:bg-slate-100"
              aria-label="Open column picker"
              title="Columns"
            >
              <Settings size={18} />
            </button>
            {settingsCollapsed && (
              <button
                type="button"
                onClick={() => setSettingsCollapsed(false)}
                className="hidden lg:inline-flex p-1.5 -ml-1 text-slate-500 hover:text-slate-700 rounded hover:bg-slate-100"
                aria-label="Show settings panel"
                title="Show settings panel"
              >
                <PanelLeftOpen size={18} />
              </button>
            )}
            {columnsCollapsed && (
              <button
                type="button"
                onClick={() => setColumnsCollapsed(false)}
                className="hidden lg:inline-flex p-1.5 text-slate-500 hover:text-slate-700 rounded hover:bg-slate-100"
                aria-label="Show columns panel"
                title="Show columns panel"
              >
                <PanelRightOpen size={18} />
              </button>
            )}
            <h2 className="text-lg font-medium text-slate-800">
              {generatedData.length > 0 ? 'Generated Data' : 'Live Preview'}
            </h2>
            {generatedData.length > 0 && (
              <>
                <span className="text-xs font-mono bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full border border-indigo-100">
                  {generatedData.length.toLocaleString()} rows
                </span>
                {seedNum !== null && (
                  <span className="text-xs font-mono text-slate-500 px-2 py-1">seed: {seedNum}</span>
                )}
              </>
            )}
          </div>
          
          <div className="flex items-center gap-2 lg:gap-3 flex-wrap">
            <Button
              size="md"
              onClick={handleCopyShareLink}
              title="Copy a URL that reproduces this exact config (preset, columns, rows, seed, sparsity, stream format)"
              aria-label="Copy link"
            >
              <Link2 size={ICON.label} />
              <span className="hidden lg:inline">Copy link</span>
            </Button>
            <label
              title="Bundle a sidecar manifest describing columns/categories/regions next to the data, packed as a zip"
              className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none px-3 py-2 rounded-lg border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={includeManifest}
                onChange={e => setIncludeManifest(e.target.checked)}
                className="accent-slate-700"
              />
              <span className="hidden lg:inline">DLP manifest (.zip)</span>
              <span className="lg:hidden">ZIP</span>
            </label>
            <Button
              size="md"
              onClick={() => exportCSV(generatedData, selectedColumns, includeManifest ? (lastRunMeta ?? undefined) : undefined)}
              disabled={generatedData.length === 0}
              aria-label="Export CSV"
            >
              <FileSpreadsheet size={ICON.label} />
              <span className="hidden lg:inline">CSV</span>
            </Button>
            <Button
              size="md"
              onClick={() => exportJSON(generatedData, selectedColumns, includeManifest ? (lastRunMeta ?? undefined) : undefined, jsonStructure, nestDepth)}
              disabled={generatedData.length === 0}
              title={jsonStructure === 'flat' ? 'Export JSON (flat)' : `Export JSON (${jsonStructure}${jsonStructure === 'deep' ? ` ×${nestDepth}` : ''})`}
              aria-label="Export JSON"
            >
              <FileJson size={ICON.label} />
              <span className="hidden lg:inline">JSON</span>
            </Button>
          </div>
        </header>

        {/* Stats Bar */}
        <div className="bg-white border-b border-slate-200 px-4 lg:px-8 py-3 flex items-center gap-6 flex-shrink-0">
          <div className="flex items-center gap-6 overflow-x-auto min-w-0 flex-1">
            {Object.entries(CATEGORY_COLORS).map(([cat, colorClass]) => {
              const count = activeCols.filter(c => c.category === cat).length;
              if (count === 0) return null;
              return (
                <div key={cat} className="flex items-center gap-2 whitespace-nowrap">
                  <div className={cn("w-2 h-2 rounded-full", colorClass.split(' ')[0])}></div>
                  <span className="text-xs font-medium text-slate-600">{cat}:</span>
                  <span className="text-xs font-mono text-slate-900">{count} cols</span>
                </div>
              );
            })}
          </div>
          {activeCols.length > 0 && (() => {
            // ponytail: severity by category presence — highest wins. Refine to weighted scoring if a real risk model is needed.
            const cats = new Set(activeCols.map(c => c.category));
            const high = ['PII', 'PHI', 'PCI', 'Secrets', 'Biometric'].some(c => cats.has(c as any));
            const med = ['Quasi-Identifier', 'Network'].some(c => cats.has(c as any));
            const level = high ? 'HIGH' : med ? 'MEDIUM' : 'LOW';
            const color = high ? 'bg-red-100 text-red-800 border-red-200'
              : med ? 'bg-amber-100 text-amber-800 border-amber-200'
              : 'bg-green-100 text-green-800 border-green-200';
            const fws = triggeredFrameworks(activeCols);
            return (
              <div ref={complianceRef} className="flex items-center gap-4 whitespace-nowrap shrink-0 relative">
                {complianceEnabled && fws.length > 0 && (
                  <button onClick={() => setShowCompliance(v => !v)}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 -mx-1.5 hover:bg-slate-50">
                    <span className="text-xs font-medium text-slate-600">Regulated:</span>
                    <div className="flex items-center gap-1">
                      {fws.slice(0, 4).map(f => (
                        <span key={f.id}
                          className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded border', TIER_CHIP[f.tier])}>
                          {f.label}
                        </span>
                      ))}
                      {fws.length > 4 && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-slate-100 text-slate-500 border-slate-200">
                          +{fws.length - 4}
                        </span>
                      )}
                    </div>
                    <ChevronDown size={13} className={cn('text-slate-400 transition-transform', showCompliance && 'rotate-180')} />
                  </button>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-600">Risk:</span>
                  <Chip className={color}>{level}</Chip>
                </div>
                {complianceEnabled && showCompliance && fws.length > 0 && (
                  <div className="absolute right-0 top-full mt-2 z-40 w-96 max-h-[70vh] overflow-y-auto whitespace-normal bg-white border border-slate-200 rounded-lg shadow-xl p-4">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-sm font-semibold text-slate-800">Compliance footprint</h3>
                      <span className="text-[10px] text-slate-400">{activeCols.length} columns</span>
                    </div>
                    <p className="text-xs text-slate-500 mb-2">Regulations this dataset falls under, and which selected columns trigger each.</p>
                    <div className="flex items-center gap-3 mb-3 text-[10px] text-slate-500">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-300" />Sensitive</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-300" />Identifier</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-slate-300" />Personal</span>
                    </div>
                    <div className="space-y-3">
                      {frameworkBreakdown(activeCols).map(fw => (
                        <div key={fw.id} className="border-t border-slate-100 pt-2.5">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-xs font-semibold text-slate-700">{fw.label}</span>
                            <span className="text-[10px] text-slate-400">{fw.region}</span>
                          </div>
                          {FRAMEWORK_NOTES[fw.id] && (
                            <p className="text-[10px] text-slate-400 italic mb-1.5">{FRAMEWORK_NOTES[fw.id]}</p>
                          )}
                          <div className="space-y-1.5">
                            {fw.groups.map(g => (
                              <div key={g.value} className="text-xs leading-relaxed">
                                <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded border mr-1.5 whitespace-nowrap', TIER_CHIP[valueTier(g.value)])}>
                                  {g.label}
                                </span>
                                <span className="text-slate-600">{g.columns.join(', ')}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Table Area */}
        <div className="flex-1 overflow-hidden p-4 lg:p-8 flex flex-col">
          {selectedColumns.size === 0 ? (
            <div className="h-full flex flex-col items-center justify-center space-y-5 text-center px-8">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
                <Database size={32} className="text-slate-300" />
              </div>
              <p className="text-sm text-slate-600">Select at least one column to preview.</p>
            </div>
          ) : (() => {
            const isLive = generatedData.length === 0;
            const rows = isLive ? livePreview : generatedData;
            return (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col h-full">
                {isLive && (
                  <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100 text-indigo-800 text-xs flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                    <span><strong>Live sample</strong> — 5 preview rows update as you change columns/locale/seed. Hit <strong>Generate</strong> for {formatRows(rowCount)} rows.</span>
                  </div>
                )}
                <div className="overflow-auto flex-1 min-h-0">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead className="sticky top-0 bg-slate-50 z-10 shadow-sm">
                      <tr>
                        <th className="px-4 py-3 border-b border-slate-200 font-medium text-slate-500 w-16 text-center sticky left-0 bg-slate-50 z-20">#</th>
                        {activeCols.map(col => (
                          <th key={col.id} className="px-4 py-3 border-b border-slate-200 font-medium text-slate-700 whitespace-nowrap">
                            <div className="flex flex-col gap-1">
                              <span>{col.name}</span>
                              <Chip className={cn("w-fit", CATEGORY_COLORS[col.category])}>{col.category}</Chip>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.slice(0, 100).map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-2.5 text-slate-400 font-mono text-xs text-center border-r border-slate-50 sticky left-0 bg-white z-10">
                            {i + 1}
                          </td>
                          {activeCols.map(col => (
                            <td key={col.id} className="px-4 py-2.5 text-slate-600 whitespace-nowrap" title={String(row[col.id])}>
                              {String(row[col.id])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!isLive && generatedData.length > 100 && (
                  <div className="bg-slate-50 border-t border-slate-200 p-3 text-center text-xs text-slate-500 font-medium">
                    Showing first 100 of {generatedData.length} records. Export to see all.
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Sticky action footer — Generate button + progress/estimate, deduped from sidebar */}
        <div className="border-t border-slate-200 bg-white px-4 lg:px-6 py-3 flex items-center gap-2 lg:gap-3 flex-wrap flex-shrink-0 shadow-[0_-1px_2px_rgba(0,0,0,0.03)]">
          <Button
            variant="primary"
            size="md"
            onClick={generateData}
            disabled={isGenerating || selectedColumns.size === 0}
          >
            <RefreshCw size={ICON.label} className={isGenerating ? 'animate-spin' : ''} />
            {isGenerating
              ? streamProgress
                ? `Streaming ${formatRows(streamProgress.written)} / ${formatRows(streamProgress.total)}`
                : 'Generating…'
              : isLarge
                ? `Stream ${formatRows(rowCount)} → ${streamFormat.toUpperCase()}`
                : `Generate ${formatRows(rowCount)} rows`}
          </Button>
          {selectedColumns.size > 0 && !streamProgress && (
            <div className="hidden sm:flex items-center gap-4 text-xs">
              <div className="flex flex-col leading-tight">
                <span className={T.micro}>Est. Size</span>
                <span className={T.mono}>{estimate.sizeStr}</span>
              </div>
              <div className="flex flex-col leading-tight">
                <span className={T.micro}>Est. Time</span>
                <span className={T.mono}>{estimate.timeStr}</span>
              </div>
            </div>
          )}
          {streamProgress && (
            <>
              <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden max-w-xs">
                <div
                  className="h-full bg-indigo-600 transition-[width] duration-150"
                  style={{ width: `${(streamProgress.written / streamProgress.total) * 100}%` }}
                />
              </div>
              <button onClick={cancelGeneration} className="text-xs text-rose-600 hover:text-rose-700 hover:underline">Cancel</button>
            </>
          )}
        </div>
      </div>

      {showReference && <ColumnReference onClose={() => setShowReference(false)} locale={locale} />}

      {toast && (
        <div className="fixed bottom-6 left-4 right-4 sm:left-auto sm:right-6 sm:w-auto z-50 flex items-center gap-3 bg-slate-900 text-white text-sm px-4 py-3 rounded-lg shadow-lg">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="text-slate-400 hover:text-white ml-1" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
