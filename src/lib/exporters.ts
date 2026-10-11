import { AVAILABLE_COLUMNS } from '../data/schema';
import { buildManifest, RunMeta } from './manifest';
import { nestRows, JsonStructure, DEFAULT_DEPTH } from './nesting';
import { HeaderMode, rekeyRows, rowsToCSV, rowsToSQL, UTF8_BOM } from './generate';

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

export { downloadBlob };

export function downloadText(text: string, filename: string, mime: string) {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

/** The answer key: what the dataset holds and what a detector should do with each column. */
export function downloadAnswerKey(selectedColumns: Set<string>, meta: RunMeta) {
  downloadBlob(
    new Blob([JSON.stringify(buildManifest(selectedColumns, meta), null, 2)], { type: 'application/json' }),
    'pretendata.answer-key.json'
  );
}

export function exportCSV(data: any[], selectedColumns: Set<string>, headers: HeaderMode = 'descriptive') {
  if (data.length === 0) return;
  const activeCols = AVAILABLE_COLUMNS.filter(c => selectedColumns.has(c.id));
  // Same bytes as the streamed CSV: BOM, header, one line per row, trailing newline.
  downloadBlob(new Blob([UTF8_BOM + rowsToCSV(data, activeCols, headers)], { type: 'text/csv;charset=utf-8' }), 'pretendata.csv');
}

export function exportSQL(data: any[], selectedColumns: Set<string>, headers: HeaderMode = 'descriptive') {
  if (data.length === 0) return;
  const activeCols = AVAILABLE_COLUMNS.filter(c => selectedColumns.has(c.id));
  downloadBlob(new Blob([rowsToSQL(data, activeCols, headers)], { type: 'application/sql' }), 'pretendata.sql');
}

/** Header modes apply to flat JSON only: the nested structures are named after what they hold. */
export function exportJSON(data: any[], selectedColumns: Set<string>, structure: JsonStructure = 'flat', depth = DEFAULT_DEPTH, headers: HeaderMode = 'descriptive') {
  if (data.length === 0) return;
  const activeCols = AVAILABLE_COLUMNS.filter(c => selectedColumns.has(c.id));
  const rows = structure === 'flat' ? rekeyRows(data, activeCols, headers) : nestRows(data, structure, depth);
  const json = JSON.stringify(rows, null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), 'pretendata.json');
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
    `pretendata_preset_${Date.now()}.json`
  );
}
