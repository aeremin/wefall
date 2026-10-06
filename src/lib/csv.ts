import Papa from 'papaparse';
import { pad, parseTime } from './format';
import type { Jump, JumpInput } from './types';

export type ImportField = keyof JumpInput;
export type DateFormat = 'dmy' | 'mdy';
export type AltitudeUnit = 'm' | 'ft';
export type ColumnMapping = Partial<Record<ImportField, string>>;

export const IMPORT_FIELDS: { field: ImportField; label: string; required?: boolean }[] = [
  { field: 'jumpNumber', label: 'Jump number', required: true },
  { field: 'date', label: 'Date', required: true },
  { field: 'time', label: 'Time' },
  { field: 'dropzone', label: 'Dropzone' },
  { field: 'aircraft', label: 'Aircraft' },
  { field: 'jumpType', label: 'Jump type' },
  { field: 'exitAltitude', label: 'Exit altitude' },
  { field: 'deploymentAltitude', label: 'Deployment altitude' },
  { field: 'freefallTime', label: 'Freefall time' },
  { field: 'canopy', label: 'Canopy' },
  { field: 'notes', label: 'Notes' },
];

const FIELD_SYNONYMS: Record<ImportField, string[]> = {
  jumpNumber: ['jump number', 'jump #', 'jump no', 'jump nr', 'number', 'jump', '#', 'no', 'nr'],
  date: ['date', 'jump date'],
  time: ['time', 'jump time', 'exit time'],
  dropzone: ['dropzone', 'drop zone', 'dz', 'location', 'place'],
  aircraft: ['aircraft', 'plane', 'airplane'],
  jumpType: ['jump type', 'type', 'discipline'],
  exitAltitude: ['exit altitude', 'exit alt', 'altitude', 'exit', 'alt'],
  deploymentAltitude: [
    'deployment altitude',
    'deploy altitude',
    'opening altitude',
    'pull altitude',
    'deployment',
    'opening',
    'pull',
  ],
  freefallTime: ['freefall time', 'freefall', 'free fall', 'ff time', 'delay', 'ff'],
  canopy: ['canopy', 'main', 'parachute'],
  notes: ['notes', 'note', 'comments', 'comment', 'description', 'remarks'],
};

const EXPORT_HEADERS: Record<ImportField, string> = {
  jumpNumber: 'Jump number',
  date: 'Date',
  time: 'Time',
  dropzone: 'Dropzone',
  aircraft: 'Aircraft',
  jumpType: 'Jump type',
  exitAltitude: 'Exit altitude (m)',
  deploymentAltitude: 'Deployment altitude (m)',
  freefallTime: 'Freefall time (s)',
  canopy: 'Canopy',
  notes: 'Notes',
};

function normalizeHeader(header: string) {
  return header
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCsvFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (result) => resolve({ headers: result.meta.fields ?? [], rows: result.data }),
      error: reject,
    });
  });
}

export function guessMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const { field } of IMPORT_FIELDS) {
    for (const synonym of FIELD_SYNONYMS[field]) {
      const idx = normalized.findIndex((h, i) => h === synonym && !used.has(i));
      if (idx !== -1) {
        mapping[field] = headers[idx];
        used.add(idx);
        break;
      }
    }
  }
  return mapping;
}

export function guessAltitudeUnit(mapping: ColumnMapping): AltitudeUnit {
  const header = (mapping.exitAltitude ?? mapping.deploymentAltitude ?? '').toLowerCase();
  return /\b(ft|feet)\b/.test(header) ? 'ft' : 'm';
}

/** Two-part dates where the first part exceeds 12 must be day-first, and vice versa. */
export function guessDateFormat(values: string[]): DateFormat {
  for (const v of values) {
    const parts = v.trim().split(/\D+/).filter(Boolean);
    if (parts.length < 3 || parts[0].length === 4) continue;
    if (Number(parts[0]) > 12) return 'dmy';
    if (Number(parts[1]) > 12) return 'mdy';
  }
  return 'dmy';
}

export function parseDate(raw: string, format: DateFormat): string | null {
  const parts = raw.trim().split(/\D+/).filter(Boolean);
  if (parts.length < 3) return null;
  let [y, m, d] = [0, 0, 0];
  if (parts[0].length === 4) {
    [y, m, d] = parts.slice(0, 3).map(Number);
  } else if (format === 'mdy') {
    [m, d, y] = parts.slice(0, 3).map(Number);
  } else {
    [d, m, y] = parts.slice(0, 3).map(Number);
  }
  if (y < 100) {
    const currentYY = new Date().getFullYear() % 100;
    y += y <= currentYY ? 2000 : 1900;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/[\s']/g, '').replace(/[a-z]+$/i, '');
  if (!s) return null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Accepts "45", "45s", or "1:05". */
export function parseSeconds(raw: string): number | null {
  const s = raw.trim();
  const mmss = /^(\d+):(\d{1,2})$/.exec(s);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const n = parseNumber(s);
  return n == null ? null : Math.round(n);
}

export interface ImportRow {
  line: number;
  /** Where the row came from, shown in error messages; defaults to the line number. */
  source?: string;
  jump?: JumpInput;
  error?: string;
  duplicate?: boolean;
}

/** Flags rows whose jump number is in `existingNumbers` or appeared on an earlier row. */
export function markDuplicates(rows: ImportRow[], existingNumbers: Set<number>): ImportRow[] {
  const seen = new Set(existingNumbers);
  return rows.map((row) => {
    if (!row.jump) return row;
    if (seen.has(row.jump.jumpNumber)) return { ...row, duplicate: true };
    seen.add(row.jump.jumpNumber);
    return row;
  });
}

export function convertRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  options: { dateFormat: DateFormat; altitudeUnit: AltitudeUnit },
): ImportRow[] {
  const get = (row: Record<string, string>, field: ImportField) =>
    mapping[field] ? (row[mapping[field]!] ?? '').trim() : '';
  const altitude = (raw: string) => {
    const n = parseNumber(raw);
    if (n == null || n < 0) return null;
    return Math.round(options.altitudeUnit === 'ft' ? n * 0.3048 : n);
  };

  return rows.map((row, i) => {
    const line = i + 2;
    const jumpNumber = parseNumber(get(row, 'jumpNumber'));
    if (jumpNumber == null || !Number.isInteger(jumpNumber) || jumpNumber <= 0) {
      return { line, error: `Invalid jump number "${get(row, 'jumpNumber')}"` };
    }
    const date = parseDate(get(row, 'date'), options.dateFormat);
    if (!date) return { line, error: `Invalid date "${get(row, 'date')}"` };

    const freefall = parseSeconds(get(row, 'freefallTime'));
    const jump: JumpInput = {
      jumpNumber,
      date,
      time: parseTime(get(row, 'time')) ?? '',
      dropzone: get(row, 'dropzone').slice(0, 200),
      aircraft: get(row, 'aircraft').slice(0, 200),
      jumpType: get(row, 'jumpType').slice(0, 100),
      exitAltitude: altitude(get(row, 'exitAltitude')),
      deploymentAltitude: altitude(get(row, 'deploymentAltitude')),
      freefallTime: freefall != null && freefall >= 0 ? freefall : null,
      canopy: get(row, 'canopy').slice(0, 200),
      notes: get(row, 'notes').slice(0, 10000),
    };
    return { line, jump };
  });
}

export function jumpsToCsv(jumps: Jump[]) {
  const fields = IMPORT_FIELDS.map((f) => f.field);
  const sorted = [...jumps].sort((a, b) => a.jumpNumber - b.jumpNumber);
  return Papa.unparse({
    fields: fields.map((f) => EXPORT_HEADERS[f]),
    data: sorted.map((j) => fields.map((f) => j[f] ?? '')),
  });
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
