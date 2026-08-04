import { AVAILABLE_COLUMNS } from '../data/schema';
import { buildManifest, manifestFilename, RunMeta } from './manifest';
import { nestRows, JsonStructure, DEFAULT_DEPTH } from './nesting';
import { makeZip } from './zip';

const UTF8_BOM = '﻿';

function csvCell(val: any): string {
  if (val === null || val === undefined) return '';
  const s = val instanceof Date ? val.toISOString() : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Centralized export utilities — extracted from App.tsx to keep the main component clean.
 */

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Drop a `<dataFilename>.manifest.json` next to the data file. */
export function downloadManifest(dataFilename: string, selectedColumns: Set<string>, meta: RunMeta) {
  const manifest = buildManifest(selectedColumns, meta);
  downloadBlob(
    new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
    manifestFilename(dataFilename)
  );
}

/** When meta is passed → ship data+manifest in a zip. Otherwise just the data file. */
function shipWithOptionalManifest(
  filename: string,
  body: string,
  mime: string,
  selectedColumns: Set<string>,
  meta?: RunMeta,
) {
  if (!meta) {
    downloadBlob(new Blob([body], { type: mime }), filename);
    return;
  }
  const manifest = JSON.stringify(buildManifest(selectedColumns, meta), null, 2);
  const zipName = filename.replace(/\.[^.]+$/, '') + '.zip';
  const blob = makeZip([
    { name: filename, data: body },
    { name: manifestFilename(filename), data: manifest },
  ]);
  downloadBlob(blob, zipName);
}

export function exportCSV(data: any[], selectedColumns: Set<string>, meta?: RunMeta) {
  if (data.length === 0) return;
  const activeCols = AVAILABLE_COLUMNS.filter(c => selectedColumns.has(c.id));
  const headers = activeCols.map(c => csvCell(c.name)).join(',');
  const rows = data.map(row => activeCols.map(c => csvCell(row[c.id])).join(','));
  const csv = UTF8_BOM + [headers, ...rows].join('\n');
  shipWithOptionalManifest('privacy_test_data.csv', csv, 'text/csv;charset=utf-8', selectedColumns, meta);
}

export function exportJSON(data: any[], selectedColumns?: Set<string>, meta?: RunMeta, structure: JsonStructure = 'flat', depth = DEFAULT_DEPTH) {
  if (data.length === 0) return;
  const json = JSON.stringify(nestRows(data, structure, depth), null, 2);
  const filename = 'privacy_test_data.json';
  if (meta && selectedColumns) {
    shipWithOptionalManifest(filename, json, 'application/json', selectedColumns, meta);
  } else {
    downloadBlob(new Blob([json], { type: 'application/json' }), filename);
  }
}

export function exportPresetConfig(selectedPreset: string, selectedColumns: Set<string>, rowCount: number, sparsity: number) {
  const config = {
    presetName: selectedPreset,
    columns: Array.from(selectedColumns),
    rowCount,
    sparsity,
  };
  downloadBlob(
    new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' }),
    `privacy_preset_${Date.now()}.json`
  );
}
