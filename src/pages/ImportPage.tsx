import { useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import { useCurrentUser } from '../context/AuthContext';
import { useJumps } from '../context/JumpsContext';
import {
  IMPORT_FIELDS,
  convertRows,
  guessAltitudeUnit,
  guessDateFormat,
  guessMapping,
  markDuplicates,
  parseCsvFile,
  type AltitudeUnit,
  type ColumnMapping,
  type DateFormat,
  type ImportRow,
} from '../lib/csv';
import { isProTrackFile, parseProTrackFile, type ProTrackJump } from '../lib/protrack';
import { importJumps, reimportJumps } from '../lib/jumps';
import { formatAltitude, formatDate, formatSeconds } from '../lib/format';
import { JUMP_TYPES, type Jump, type JumpInput } from '../lib/types';

interface ProTrackFile {
  name: string;
  jump?: ProTrackJump;
  error?: string;
}

type Source =
  | { kind: 'csv'; name: string; headers: string[]; rows: Record<string, string>[] }
  | { kind: 'protrack'; files: ProTrackFile[] };

const DETAIL_FIELDS = ['dropzone', 'aircraft', 'jumpType', 'canopy'] as const;
type Details = Record<(typeof DETAIL_FIELDS)[number], string>;
const DETAIL_LABELS: Details = { dropzone: 'Dropzone', aircraft: 'Aircraft', jumpType: 'Jump type', canopy: 'Canopy' };
const EMPTY_DETAILS: Details = { dropzone: '', aircraft: '', jumpType: '', canopy: '' };

async function readProTrackFile(f: File): Promise<ProTrackFile> {
  try {
    return { name: f.name, jump: parseProTrackFile(await f.text()) };
  } catch (err) {
    return { name: f.name, error: err instanceof Error ? err.message : String(err) };
  }
}

export default function ImportPage() {
  const user = useCurrentUser();
  const { jumps } = useJumps();
  const navigate = useNavigate();

  const [source, setSource] = useState<Source | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [dateFormat, setDateFormat] = useState<DateFormat>('dmy');
  const [altitudeUnit, setAltitudeUnit] = useState<AltitudeUnit>('m');
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [total, setTotal] = useState(0);

  const existingNumbers = useMemo(() => new Set(jumps.map((j) => j.jumpNumber)), [jumps]);
  const existingByNumber = useMemo(() => {
    const byNumber = new Map<number, Jump>();
    for (const j of jumps) if (!byNumber.has(j.jumpNumber)) byNumber.set(j.jumpNumber, j);
    return byNumber;
  }, [jumps]);

  const suggestions = useMemo(() => {
    const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
    return {
      dropzone: unique(jumps.map((j) => j.dropzone)),
      aircraft: unique(jumps.map((j) => j.aircraft)),
      jumpType: [...new Set([...JUMP_TYPES, ...jumps.map((j) => j.jumpType).filter(Boolean)])],
      canopy: unique(jumps.map((j) => j.canopy)),
    };
  }, [jumps]);

  const trimmedDetails = useMemo(
    () => Object.fromEntries(DETAIL_FIELDS.map((f) => [f, details[f].trim()])) as Details,
    [details],
  );

  const parsed = useMemo((): ImportRow[] => {
    if (!source) return [];
    if (source.kind === 'csv') return convertRows(source.rows, mapping, { dateFormat, altitudeUnit });
    return source.files.map(({ name, jump, error }, i) => ({
      line: i + 1,
      source: name,
      error,
      jump: jump && { ...trimmedDetails, notes: '', ...jump },
    }));
  }, [source, mapping, dateFormat, altitudeUnit, trimmedDetails]);

  const results = useMemo(() => markDuplicates(parsed, existingNumbers), [parsed, existingNumbers]);
  const ready = results.filter((r) => r.jump && !r.duplicate);
  const duplicates = results.filter((r) => r.duplicate).length;
  const errors = results.filter((r) => r.error);

  const reimport = useMemo(
    () =>
      markDuplicates(parsed, new Set())
        .filter((r) => r.jump && !r.duplicate)
        .map((r): JumpInput & { id?: string } => {
          const existing = existingByNumber.get(r.jump!.jumpNumber);
          if (!existing) return r.jump!;
          if (source?.kind !== 'protrack') return { ...r.jump!, id: existing.id };
          // ProTrack files don't record these details, so keep the logbook's values unless overridden.
          const overrides = Object.fromEntries(DETAIL_FIELDS.filter((f) => trimmedDetails[f]).map((f) => [f, trimmedDetails[f]]));
          return { ...existing, ...overrides, ...source.files[r.line - 1].jump! };
        }),
    [parsed, source, existingByNumber, trimmedDetails],
  );
  const overwriteCount = reimport.filter((j) => j.id).length;

  async function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    if (files.length === 0) return;
    setError(null);
    try {
      const texts = await Promise.all(files.map((f) => f.text()));
      if (texts.every(isProTrackFile)) {
        const read = await Promise.all(files.map(readProTrackFile));
        read.sort((a, b) => (a.jump?.jumpNumber ?? Infinity) - (b.jump?.jumpNumber ?? Infinity));
        setSource({ kind: 'protrack', files: read });
        return;
      }
      if (files.length > 1) throw new Error('Select a single CSV file, or one or more ProTrack jump files.');
      const { headers, rows } = await parseCsvFile(files[0]);
      if (rows.length === 0) throw new Error('The file contains no rows.');
      const guessed = guessMapping(headers);
      setMapping(guessed);
      setAltitudeUnit(guessAltitudeUnit(guessed));
      setDateFormat(guessed.date ? guessDateFormat(rows.map((r) => r[guessed.date!] ?? '')) : 'dmy');
      setSource({ kind: 'csv', name: files[0].name, headers, rows });
    } catch (err) {
      setSource(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function run(count: number, write: () => Promise<void>) {
    setError(null);
    setTotal(count);
    setProgress(0);
    try {
      await write();
      navigate('/');
    } catch (err) {
      setError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      setProgress(null);
    }
  }

  function handleImport() {
    return run(ready.length, () => importJumps(user.uid, ready.map((r) => r.jump!), setProgress));
  }

  function handleReimport() {
    const added = reimport.length - overwriteCount;
    const from = source!.kind === 'csv' ? source!.name : `${source!.files.length} ProTrack files`;
    const message =
      `Re-import ${reimport.length} jumps from ${from}?\n\n` +
      `${overwriteCount} existing jumps with the same jump number will be OVERWRITTEN ` +
      `with the data from the file` +
      (added > 0 ? `, and ${added} new jumps will be added.` : '.') +
      `\n\nThis cannot be undone.`;
    if (!confirm(message)) return;
    return run(reimport.length, () => reimportJumps(user.uid, reimport, setProgress));
  }

  const importing = progress != null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Import jumps</h1>
        <p className="text-sm text-slate-500">
          Upload a CSV file with one jump per row and a header row. Columns are matched
          automatically; you can adjust the mapping before importing.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          You can also select one or more ProTrack jump files (<code>.txt</code>, one jump per file).
        </p>
      </div>

      <div className="card">
        <input type="file" multiple accept=".csv,text/csv,.txt,text/plain" onChange={handleFiles} disabled={importing} className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-4 file:py-2 file:font-medium file:text-sky-700 hover:file:bg-sky-100" />
        {source?.kind === 'csv' && <p className="mt-2 text-sm text-slate-500">{source.name}: {source.rows.length} rows</p>}
        {source?.kind === 'protrack' && <p className="mt-2 text-sm text-slate-500">{source.files.length} ProTrack files</p>}
      </div>

      {error && <div className="card border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      {source?.kind === 'csv' && (
        <div className="card space-y-4">
          <h2 className="font-semibold">Column mapping</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {IMPORT_FIELDS.map(({ field, label, required }) => (
              <div key={field}>
                <label className="label" htmlFor={`map-${field}`}>
                  {label} {required && <span className="text-red-500">*</span>}
                </label>
                <select
                  id={`map-${field}`}
                  className="input"
                  value={mapping[field] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value || undefined }))}
                >
                  <option value="">(none)</option>
                  {source.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label" htmlFor="dateFormat">Date format</label>
              <select id="dateFormat" className="input" value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
                <option value="dmy">Day / Month / Year</option>
                <option value="mdy">Month / Day / Year</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">YYYY-MM-DD dates are always recognized.</p>
            </div>
            <div>
              <label className="label" htmlFor="altUnit">Altitudes in file are in</label>
              <select id="altUnit" className="input" value={altitudeUnit} onChange={(e) => setAltitudeUnit(e.target.value as AltitudeUnit)}>
                <option value="m">Meters</option>
                <option value="ft">Feet (convert to meters)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {source?.kind === 'protrack' && (
        <div className="card space-y-4">
          <div>
            <h2 className="font-semibold">Jump details</h2>
            <p className="text-sm text-slate-500">
              ProTrack records the jump number, date, altitudes and freefall time. Anything entered
              here is applied to all imported jumps. When re-importing, existing jumps keep their
              current values for fields left empty.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {DETAIL_FIELDS.map((field) => (
              <div key={field}>
                <label className="label" htmlFor={`detail-${field}`}>{DETAIL_LABELS[field]}</label>
                <input
                  id={`detail-${field}`}
                  list={`detail-${field}-list`}
                  className="input"
                  value={details[field]}
                  onChange={(e) => setDetails((d) => ({ ...d, [field]: e.target.value }))}
                />
                <datalist id={`detail-${field}-list`}>
                  {suggestions[field].map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
            ))}
          </div>
        </div>
      )}

      {source && (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium text-green-700">{ready.length} ready to import</span>
            {duplicates > 0 && <span className="text-amber-700">{duplicates} skipped (jump number already exists)</span>}
            {errors.length > 0 && <span className="text-red-600">{errors.length} with errors</span>}
          </div>

          {errors.length > 0 && (
            <ul className="max-h-32 overflow-y-auto text-xs text-red-600">
              {errors.slice(0, 50).map((r) => (
                <li key={r.line}>{r.source ?? `Line ${r.line}`}: {r.error}</li>
              ))}
            </ul>
          )}

          {ready.length > 0 && (
            <div className="overflow-x-auto">
              <p className="mb-2 text-xs text-slate-500">Preview of the first {Math.min(10, ready.length)} jumps:</p>
              <table className="w-full text-left text-xs">
                <thead className="border-b text-slate-500">
                  <tr>
                    <th className="py-1 pr-3">#</th>
                    <th className="py-1 pr-3">Date</th>
                    <th className="py-1 pr-3">Dropzone</th>
                    <th className="py-1 pr-3">Aircraft</th>
                    <th className="py-1 pr-3">Type</th>
                    <th className="py-1 pr-3">Exit</th>
                    <th className="py-1 pr-3">Deploy</th>
                    <th className="py-1 pr-3">Freefall</th>
                    <th className="py-1 pr-3">Canopy</th>
                  </tr>
                </thead>
                <tbody>
                  {ready.slice(0, 10).map(({ line, jump }) => (
                    <tr key={line} className="border-b border-slate-100">
                      <td className="py-1 pr-3 font-medium">{jump!.jumpNumber}</td>
                      <td className="whitespace-nowrap py-1 pr-3">{formatDate(jump!.date)}</td>
                      <td className="py-1 pr-3">{jump!.dropzone}</td>
                      <td className="py-1 pr-3">{jump!.aircraft}</td>
                      <td className="py-1 pr-3">{jump!.jumpType}</td>
                      <td className="whitespace-nowrap py-1 pr-3">{formatAltitude(jump!.exitAltitude)}</td>
                      <td className="whitespace-nowrap py-1 pr-3">{formatAltitude(jump!.deploymentAltitude)}</td>
                      <td className="py-1 pr-3">{formatSeconds(jump!.freefallTime)}</td>
                      <td className="py-1 pr-3">{jump!.canopy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {importing ? (
            <button className="btn btn-primary" disabled>Importing… {progress} / {total}</button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn btn-primary" disabled={ready.length === 0} onClick={handleImport}>
                Import {ready.length} jumps
              </button>
              <button
                className="btn btn-danger"
                disabled={overwriteCount === 0}
                onClick={handleReimport}
                title="Import all jumps from the file, overwriting existing jumps with the same jump number"
              >
                Re-import and overwrite {overwriteCount} existing jumps
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
